import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

jest.mock('../../src/renderer/pages/BrowserPage', () => () => <div>browser-page</div>);
jest.mock('../../src/renderer/pages/TestPage', () => () => <div>test-page</div>);
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

test('offers permanent mode tabs in both browser and Cos routes and remembers the last Cos route', () => {
  const leave = jest.fn();
  window.addEventListener('browse-mode-leave', leave);
  render(<MemoryRouter initialEntries={['/cos/sets?context=coser&coser=coser%3AAlice']}><App /><RouteProbe /></MemoryRouter>);
  expect(screen.getByRole('tab', { name: 'Cos 图库' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: '文件夹浏览' }));
  expect(screen.getByText('browser-page')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Cos 图库' }));
  expect(leave).toHaveBeenCalledTimes(2);
  window.removeEventListener('browse-mode-leave', leave);
  expect(screen.getByText('cos-library-route')).toBeInTheDocument();
  expect(screen.getByTestId('mode-route')).toHaveTextContent('/cos/sets?context=coser&coser=coser%3AAlice');
});

test('places compact mode controls in the macOS window titlebar and retains the last route', () => {
  const previousPlatform = window.electronAPI.platform;
  window.electronAPI.platform = 'darwin';
  try {
    render(<MemoryRouter initialEntries={['/cos/sets?context=coser&coser=coser%3AAlice']}><App /><RouteProbe /></MemoryRouter>);
    const titlebar = screen.getByRole('banner', { name: '窗口标题栏' });
    expect(titlebar).toHaveStyle({ height: '32px' });
    expect(within(titlebar).getByText('照片相簿浏览器')).toBeInTheDocument();
    expect(within(titlebar).getByText('文件夹', { exact: true })).toBeInTheDocument();
    fireEvent.click(within(titlebar).getByRole('tab', { name: '文件夹浏览' }));
    expect(screen.getByText('browser-page')).toBeInTheDocument();
    fireEvent.click(within(titlebar).getByRole('tab', { name: 'Cos 图库' }));
    expect(screen.getByTestId('mode-route')).toHaveTextContent('/cos/sets?context=coser&coser=coser%3AAlice');
    expect(screen.getAllByRole('navigation', { name: '浏览方式' })).toHaveLength(1);
  } finally {
    if (previousPlatform === undefined) delete window.electronAPI.platform;
    else window.electronAPI.platform = previousPlatform;
  }
});
