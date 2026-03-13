import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: jest.fn(),
    useLocation: jest.fn()
  };
});

jest.mock('react-virtuoso', () => ({
  Virtuoso: ({ data = [], itemContent }) => (
    <div data-testid="virtuoso">
      {data.map((item, index) => (
        <div key={index}>{itemContent(index, item)}</div>
      ))}
    </div>
  )
}));

jest.mock('../../../src/renderer/components/AlbumCard', () =>
  jest.fn(({ node }) => <div data-testid="album-card">{node?.name || 'node'}</div>)
);

jest.mock('../../../src/renderer/components/BreadcrumbNavigation', () =>
  jest.fn(() => <div data-testid="breadcrumbs" />)
);

jest.mock('../../../src/renderer/components/PageLayout', () =>
  jest.fn(({ headerContent, children }) => (
    <div>
      <div data-testid="page-header">{headerContent}</div>
      <div>{children}</div>
    </div>
  ))
);

jest.mock('../../../src/renderer/contexts/FavoritesContext', () => ({
  useFavorites: jest.fn(() => ({ favorites: [] }))
}));

jest.mock('../../../src/renderer/hooks/useSorting', () =>
  jest.fn(() => ({
    sortBy: 'name',
    sortDirection: 'asc',
    handleSortChange: jest.fn(),
    handleDirectionChange: jest.fn()
  }))
);

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    clearType: jest.fn()
  }
}));

const reactRouter = require('react-router-dom');
const { ScrollPositionContext } = require('../../../src/renderer/App');
const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;
const HomePage = require('../../../src/renderer/pages/HomePage').default;
const ipcRenderer = global.electronMock.ipcRenderer;

describe('HomePage refresh button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse/%2Fphotos',
      search: '',
      state: null
    });
    imageCache.get.mockReturnValue(null);
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 0,
        totalNodes: 0
      }
    });
  });

  test('refreshes current folder in url mode', async () => {
    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('scan-navigation-level', '/photos');
    });

    fireEvent.click(screen.getByRole('button', { name: '刷新当前文件夹' }));

    await waitFor(() => {
      expect(imageCache.clearType).toHaveBeenCalledWith('navigation');
      expect(ipcRenderer.invoke).toHaveBeenCalledTimes(2);
    });

    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('scan-navigation-level', '/photos');
  });
});
