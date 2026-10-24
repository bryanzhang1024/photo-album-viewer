import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

jest.mock('../../src/renderer/pages/BrowserPage', () => () => <div>browser-page</div>);
jest.mock('../../src/renderer/pages/SettingsPage', () => () => <div>settings-page</div>);
jest.mock('../../src/renderer/pages/CosLibraryPage', () => () => <div>cos-library-route</div>);

const App = require('../../src/renderer/App').default;
function RouteProbe() { const location = useLocation(); return <output data-testid="mode-route">{location.pathname}{location.search}</output>; }

test('routes /cos to the dedicated Cos library page', () => {
  render(
    <MemoryRouter initialEntries={['/cos']}>
      <App />
    </MemoryRouter>
  );

  expect(screen.getByText('cos-library-route')).toBeInTheDocument();
});

test('侧栏提供文件夹与 Cos 图库入口，并可切回文件夹', () => {
  render(<MemoryRouter initialEntries={['/cos/characters']}><App /><RouteProbe /></MemoryRouter>);
  expect(screen.getByText('cos-library-route')).toBeInTheDocument();

  const sidebar = screen.getByRole('navigation', { name: '侧栏' });
  fireEvent.click(within(sidebar).getByRole('button', { name: '文件夹' }));
  expect(screen.getByText('browser-page')).toBeInTheDocument();
  expect(screen.getByTestId('mode-route')).toHaveTextContent(/^\/$/);

  fireEvent.click(within(sidebar).getByRole('button', { name: '按角色' }));
  expect(screen.getByText('cos-library-route')).toBeInTheDocument();
  expect(screen.getByTestId('mode-route')).toHaveTextContent('/cos/characters');
});

test('macOS 窗口工具栏提供后退与前进按钮，初始不可用', () => {
  const previousPlatform = window.electronAPI.platform;
  window.electronAPI.platform = 'darwin';
  try {
    render(<MemoryRouter initialEntries={['/cos/sets?context=coser&coser=coser%3AAlice']}><App /><RouteProbe /></MemoryRouter>);
    const toolbar = screen.getByRole('banner', { name: '窗口工具栏' });
    expect(toolbar).toHaveStyle({ height: '32px' });
    expect(within(toolbar).getByText('照片相簿浏览器')).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '后退' })).toBeDisabled();
    expect(within(toolbar).getByRole('button', { name: '前进' })).toBeDisabled();
  } finally {
    if (previousPlatform === undefined) delete window.electronAPI.platform;
    else window.electronAPI.platform = previousPlatform;
  }
});
