import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../src/renderer/pages/BrowserPage', () => () => <div>browser-page</div>);
jest.mock('../../src/renderer/pages/TestPage', () => () => <div>test-page</div>);
jest.mock('../../src/renderer/pages/SettingsPage', () => () => <div>settings-page</div>);
jest.mock('../../src/renderer/pages/CosLibraryPage', () => () => <div>cos-library-route</div>);

const App = require('../../src/renderer/App').default;

test('routes /cos to the dedicated Cos library page', () => {
  render(
    <MemoryRouter initialEntries={['/cos']}>
      <App />
    </MemoryRouter>
  );

  expect(screen.getByText('cos-library-route')).toBeInTheDocument();
});
