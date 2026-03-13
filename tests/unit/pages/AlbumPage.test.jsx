import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: jest.fn(),
    useLocation: jest.fn(),
    useParams: jest.fn()
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

jest.mock('../../../src/renderer/components/BreadcrumbNavigation', () =>
  jest.fn(() => <div data-testid="breadcrumbs" />)
);

jest.mock('../../../src/renderer/components/ImageCard', () =>
  jest.fn(({ image }) => <div data-testid="image-card">{image?.name || 'image'}</div>)
);

jest.mock('../../../src/renderer/components/ImageViewer', () =>
  jest.fn(() => <div data-testid="image-viewer" />)
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
  useFavorites: jest.fn(() => ({
    favorites: [],
    isAlbumFavorited: jest.fn(() => false),
    toggleAlbumFavorite: jest.fn()
  }))
}));

jest.mock('../../../src/renderer/hooks/useSorting', () =>
  jest.fn(() => ({
    sortBy: 'name',
    sortDirection: 'asc',
    handleSortChange: jest.fn(),
    handleDirectionChange: jest.fn()
  }))
);

jest.mock('../../../src/renderer/hooks/useAlbumImages', () =>
  jest.fn()
);

jest.mock('../../../src/renderer/hooks/useBreadcrumbs', () =>
  jest.fn(() => ({
    breadcrumbs: [],
    metadata: null,
    loadBreadcrumbs: jest.fn(() => Promise.resolve())
  }))
);

jest.mock('../../../src/renderer/hooks/useNeighboringAlbums', () =>
  jest.fn(() => ({
    neighboringAlbums: { prev: null, next: null, total: 0, currentIndex: 0 },
    siblingAlbums: [],
    loadNeighboringAlbums: jest.fn(() => Promise.resolve())
  }))
);

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn(),
    prefetch: jest.fn(() => Promise.resolve())
  }
}));

const reactRouter = require('react-router-dom');
const { ScrollPositionContext } = require('../../../src/renderer/App');
const useAlbumImages = require('../../../src/renderer/hooks/useAlbumImages');
const AlbumPage = require('../../../src/renderer/pages/AlbumPage').default;

describe('AlbumPage refresh button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse/%2Falbums%2Ftrip',
      search: '',
      state: null
    });
    reactRouter.useParams.mockReturnValue({});
    useAlbumImages.mockReturnValue({
      images: [{ path: '/albums/trip/1.jpg', name: '1.jpg', size: 1, lastModified: 1 }],
      loading: false,
      error: '',
      loadImages: jest.fn(() => Promise.resolve([])),
      refresh: jest.fn()
    });
  });

  test('places refresh button immediately before random album button', () => {
    const refresh = jest.fn();
    useAlbumImages.mockReturnValue({
      images: [{ path: '/albums/trip/1.jpg', name: '1.jpg', size: 1, lastModified: 1 }],
      loading: false,
      error: '',
      loadImages: jest.fn(() => Promise.resolve([])),
      refresh
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <AlbumPage
          colorMode={{ mode: 'light' }}
          albumPath="/albums/trip"
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    const refreshButton = screen.getByRole('button', { name: '刷新当前相簿' });
    const randomButton = screen.getByRole('button', { name: '随机选择相簿 (R)' });
    const actionContainer = refreshButton.closest('.MuiBox-root');
    const refreshWrapper = refreshButton.closest('span') || refreshButton;
    const randomWrapper = randomButton.closest('span') || randomButton;
    const actionChildren = Array.from(actionContainer.children);

    expect(actionChildren.indexOf(randomWrapper)).toBe(actionChildren.indexOf(refreshWrapper) + 1);

    fireEvent.click(refreshButton);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
