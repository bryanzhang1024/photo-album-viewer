import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  HashRouter,
  Route,
  Routes,
  useLocation
} from 'react-router-dom';

import {
  createNavigationTargetV1
} from '../helpers/sourceRootFixtures';

jest.mock('electron', () => ({
  app: {},
  BrowserWindow: jest.fn()
}));
jest.mock('electron-is-dev', () => false);
jest.mock('http', () => ({ get: jest.fn() }));

const { buildWindowUrl } = require('../../src/main/services/WindowService');

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-search">
      {location.search}
    </output>
  );
}

function renderGeneratedHash(windowUrl) {
  window.history.replaceState({}, '', '/');
  window.location.hash = new URL(windowUrl).hash;
  render(
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/browse" element={<LocationProbe />} />
      </Routes>
    </HashRouter>
  );
}

describe('window HashRouter bootstrap', () => {
  test('exposes a generated legacy initialPath through useLocation.search', () => {
    const legacyPath = '/Photos/旅行 100%';
    const windowUrl = buildWindowUrl('http://localhost:3000/', legacyPath);

    renderGeneratedHash(windowUrl);

    const search = screen.getByTestId('location-search').textContent;
    expect(search).toContain('initialPath=');
    expect(new URLSearchParams(search).get('initialPath')).toBe(legacyPath);
  });

  test('exposes a generated canonical sourceId through useLocation.search', () => {
    const target = createNavigationTargetV1({
      relativePath: '2026/旅行 100%',
      initialMediaRelativePath: null
    });
    const windowUrl = buildWindowUrl('http://localhost:3000/', target);

    renderGeneratedHash(windowUrl);

    const search = screen.getByTestId('location-search').textContent;
    expect(search).toContain('sourceId=');
    expect(new URLSearchParams(search).get('sourceId')).toBe(target.sourceId);
  });
});
