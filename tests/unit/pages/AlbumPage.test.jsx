import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: jest.fn(),
    useLocation: jest.fn(),
    useParams: jest.fn()
  };
});

jest.mock('react-virtuoso', () => {
  const React = require('react');
  return {
    Virtuoso: ({ data = [], itemContent, endReached, rangeChanged }) => {
      React.useEffect(() => {
        endReached?.();
        rangeChanged?.({ startIndex: 0, endIndex: Math.max(0, data.length - 1) });
      }, [data, endReached, rangeChanged]);

      return (
        <div data-testid="virtuoso">
          {data.map((item, index) => (
            <div key={index}>{itemContent(index, item)}</div>
          ))}
        </div>
      );
    }
  };
});

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
  jest.fn((albumPath, rootPath, sourceBreadcrumbs) => ({
    breadcrumbs: sourceBreadcrumbs || [],
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
const useBreadcrumbs = require('../../../src/renderer/hooks/useBreadcrumbs');
const useNeighboringAlbums = require('../../../src/renderer/hooks/useNeighboringAlbums');
const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;
const BreadcrumbNavigation = require('../../../src/renderer/components/BreadcrumbNavigation');
const AlbumPage = require('../../../src/renderer/pages/AlbumPage').default;
const CHANNELS = require('../../../src/common/ipc-channels');
const ipcRenderer = global.electronMock.ipcRenderer;

const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

const SOURCE_BOUNDARY_CASES = [
  [
    'POSIX',
    {
      sourceId: SOURCE_ID,
      label: '家庭照片',
      rootPath: '/Volumes/NAS/Photos',
      relativePath: '2026/旅行'
    },
    '/Volumes/NAS/Photos/2026/旅行',
    [
      { name: '家庭照片', path: '/Volumes/NAS/Photos' },
      { name: '2026', path: '/Volumes/NAS/Photos/2026' },
      { name: '旅行', path: '/Volumes/NAS/Photos/2026/旅行' }
    ]
  ],
  [
    'Windows drive',
    {
      sourceId: SOURCE_ID,
      label: 'Windows 照片',
      rootPath: 'D:\\Pictures',
      relativePath: '2026/Trip'
    },
    'D:/Pictures/2026/Trip',
    [
      { name: 'Windows 照片', path: 'D:\\Pictures' },
      { name: '2026', path: 'D:/Pictures/2026' },
      { name: 'Trip', path: 'D:/Pictures/2026/Trip' }
    ]
  ],
  [
    'UNC',
    {
      sourceId: SOURCE_ID,
      label: 'NAS 照片',
      rootPath: '\\\\NAS\\Photos',
      relativePath: 'Family/Trip'
    },
    '//NAS/Photos/Family/Trip',
    [
      { name: 'NAS 照片', path: '\\\\NAS\\Photos' },
      { name: 'Family', path: '//NAS/Photos/Family' },
      { name: 'Trip', path: '//NAS/Photos/Family/Trip' }
    ]
  ]
];

describe('AlbumPage refresh button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse/%2Falbums%2Ftrip',
      search: '',
      state: null
    });
    reactRouter.useParams.mockReturnValue({});
    useAlbumImages.mockReturnValue({
      images: [{ path: '/albums/trip/1.jpg', name: '1.jpg', size: 1, lastModified: 1 }],
      totalCount: 1,
      hasMore: false,
      loading: false,
      loadingMore: false,
      error: '',
      queryKey: '{}',
      loadImages: jest.fn(() => Promise.resolve([])),
      loadMore: jest.fn(),
      ensureImageLoaded: jest.fn(() => Promise.resolve({ images: [], globalIndex: -1, offset: 0 })),
      refresh: jest.fn(),
      removeImage: jest.fn()
    });
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/albums/trip',
      nodes: [],
      directImages: [],
      breadcrumbs: [],
      metadata: { totalNodes: 0 }
    });
  });

  test('places refresh first and random lives in tune popover', async () => {
    const refresh = jest.fn();
    useAlbumImages.mockReturnValue({
      images: [{ path: '/albums/trip/1.jpg', name: '1.jpg', size: 1, lastModified: 1 }],
      totalCount: 1,
      hasMore: false,
      loading: false,
      loadingMore: false,
      error: '',
      queryKey: '{}',
      loadImages: jest.fn(() => Promise.resolve([])),
      loadMore: jest.fn(),
      ensureImageLoaded: jest.fn(() => Promise.resolve({ images: [], globalIndex: -1, offset: 0 })),
      refresh,
      removeImage: jest.fn()
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

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        '/albums/trip'
      );
    });

    const toolbar = screen.getByTestId('grid-page-toolbar');
    const refreshButton = screen.getByRole('button', { name: '刷新当前相簿' });
    const tuneButton = screen.getByRole('button', { name: '视图选项' });
    const children = Array.from(toolbar.children);
    const refreshIndex = children.findIndex((node) => node.contains(refreshButton));
    const tuneIndex = children.findIndex((node) => node.contains(tuneButton));

    expect(refreshIndex).toBe(0);
    expect(tuneIndex).toBeGreaterThan(refreshIndex);
    expect(screen.queryByRole('button', { name: '随机选择相簿 (E)' })).not.toBeInTheDocument();

    fireEvent.click(tuneButton);
    fireEvent.click(screen.getByRole('button', { name: '随机选择相簿 (E)' }));

    fireEvent.click(refreshButton);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('loads the legacy root key without decoding initialPath percent twice', async () => {
    const initialPath = '/photos/100%done';
    const storageKey = `lastRootPath_${btoa(initialPath).replace(/[+/=]/g, '')}`;
    window.history.pushState({}, '', '/?initialPath=%2Fphotos%2F100%25done');
    localStorage.setItem(storageKey, '/photos');

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <AlbumPage
          colorMode={{ mode: 'light' }}
          albumPath={initialPath}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(useBreadcrumbs).toHaveBeenCalledWith(initialPath, '/photos', null);
    });
  });

  test.each(SOURCE_BOUNDARY_CASES)(
    'forwards %s SourceRoot breadcrumbs without switching album content APIs',
    async (_name, sourceBoundary, albumPath, sourceBreadcrumbs) => {
      imageCache.get.mockReturnValue(null);
      ipcRenderer.invoke.mockImplementation((channel, targetPath) => {
        if (channel === CHANNELS.SCAN_NAVIGATION_LEVEL) {
          return Promise.resolve({
            success: true,
            currentPath: targetPath,
            nodes: [],
            directImages: [],
            breadcrumbs: [
              { name: '/', path: '/' },
              { name: 'OS root', path: albumPath }
            ],
            metadata: { totalNodes: 0 }
          });
        }
        return Promise.resolve({});
      });

      render(
        <ScrollPositionContext.Provider
          value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
        >
          <AlbumPage
            colorMode={{ mode: 'light' }}
            albumPath={albumPath}
            sourceBoundary={sourceBoundary}
            sourceBreadcrumbs={sourceBreadcrumbs}
            urlMode={true}
          />
        </ScrollPositionContext.Provider>
      );

      await waitFor(() => {
        expect(useBreadcrumbs).toHaveBeenCalledWith(
          albumPath,
          sourceBoundary.rootPath,
          sourceBreadcrumbs
        );
        const breadcrumbProps = BreadcrumbNavigation.mock.calls[
          BreadcrumbNavigation.mock.calls.length - 1
        ][0];
        expect(breadcrumbProps.breadcrumbs).toEqual(sourceBreadcrumbs);
      });
      expect(useAlbumImages).toHaveBeenCalledWith(
        albumPath,
        expect.objectContaining({ sortBy: 'name', sortDirection: 'asc' })
      );
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        albumPath
      );
      expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
        CHANNELS.GET_DIRECTORY_LEVEL_V1,
        expect.anything()
      );
    }
  );

  test('shows browse entry when photo set view has child folders', async () => {
    const onNavigate = jest.fn();
    imageCache.get.mockReturnValue(null);
    ipcRenderer.invoke.mockImplementation((channel, path) => {
      if (channel === 'scan-navigation-level' && path === '/albums/trip') {
        return Promise.resolve({
          success: true,
          currentPath: '/albums/trip',
          nodes: [
            { path: '/albums/trip/selfie', name: 'selfie', type: 'album' }
          ],
          directImages: [],
          breadcrumbs: [],
          metadata: { totalNodes: 1 }
        });
      }
      return Promise.resolve({ success: true, nodes: [], directImages: [], breadcrumbs: [], metadata: {} });
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <AlbumPage
          colorMode={{ mode: 'light' }}
          albumPath="/albums/trip"
          urlMode={true}
          onNavigate={onNavigate}
        />
      </ScrollPositionContext.Provider>
    );

    expect(await screen.findByText('该目录还有 1 个子文件夹')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '进入浏览' }));

    expect(onNavigate).toHaveBeenCalledWith('/albums/trip', 'folder', null, false);
  });

  test('calls loadMore when virtuoso reaches end and more pages exist', async () => {
    const loadMore = jest.fn();
    useAlbumImages.mockReturnValue({
      images: [{ path: '/albums/trip/1.jpg', name: '1.jpg', size: 1, lastModified: 1 }],
      totalCount: 500,
      hasMore: true,
      loading: false,
      loadingMore: false,
      error: '',
      queryKey: '{}',
      loadImages: jest.fn(() => Promise.resolve([])),
      loadMore,
      ensureImageLoaded: jest.fn(() => Promise.resolve({ images: [], globalIndex: -1, offset: 0 })),
      refresh: jest.fn(),
      removeImage: jest.fn()
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

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        '/albums/trip'
      );
    });

    expect(screen.getByText('共 500 张照片')).toBeInTheDocument();
    expect(loadMore).toHaveBeenCalled();
  });

  test('triggers batch thumbnail prefetch for visible album rows', async () => {
    useAlbumImages.mockReturnValue({
      images: [
        { path: '/albums/trip/1.jpg', name: '1.jpg', size: 1, lastModified: 1 },
        { path: '/albums/trip/2.jpg', name: '2.jpg', size: 1, lastModified: 1 }
      ],
      totalCount: 2,
      hasMore: false,
      loading: false,
      loadingMore: false,
      error: '',
      queryKey: '{}',
      loadImages: jest.fn(() => Promise.resolve([])),
      loadMore: jest.fn(),
      ensureImageLoaded: jest.fn(() => Promise.resolve({ images: [], globalIndex: -1, offset: 0 })),
      refresh: jest.fn(),
      removeImage: jest.fn()
    });

    ipcRenderer.invoke.mockImplementation((channel, ...args) => {
      if (channel === 'get-batch-thumbnails') {
        return Promise.resolve({
          '/albums/trip/1.jpg': '1.webp',
          '/albums/trip/2.jpg': '2.webp'
        });
      }
      if (channel === 'scan-navigation-level') {
        return Promise.resolve({ success: true, nodes: [], directImages: [], metadata: { totalNodes: 0 } });
      }
      return Promise.resolve({});
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

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-batch-thumbnails',
        expect.arrayContaining(['/albums/trip/1.jpg', '/albums/trip/2.jpg']),
        expect.any(Number)
      );
    });
  });
});

describe('AlbumPage sibling album keyboard navigation', () => {
  const siblingAlbums = [
    { path: '/photos/A1', name: 'A1' },
    { path: '/photos/A2', name: 'A2' },
    { path: '/photos/A3', name: 'A3' }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse/%2Fphotos%2FA2',
      search: '',
      state: null
    });
    reactRouter.useParams.mockReturnValue({});
    useAlbumImages.mockReturnValue({
      images: [{ path: '/photos/A2/1.jpg', name: '1.jpg', size: 1, lastModified: 1 }],
      totalCount: 1,
      hasMore: false,
      loading: false,
      loadingMore: false,
      error: '',
      queryKey: '{}',
      loadImages: jest.fn(() => Promise.resolve([])),
      loadMore: jest.fn(),
      ensureImageLoaded: jest.fn(() => Promise.resolve({ images: [], globalIndex: -1, offset: 0 })),
      refresh: jest.fn(),
      removeImage: jest.fn()
    });
    useNeighboringAlbums.mockReturnValue({
      neighboringAlbums: {
        prev: siblingAlbums[0],
        next: siblingAlbums[2],
        currentIndex: 1,
        total: 3
      },
      siblingAlbums,
      loadNeighboringAlbums: jest.fn(() => Promise.resolve())
    });
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos/A2',
      nodes: [],
      directImages: [],
      breadcrumbs: [],
      metadata: { totalNodes: 0 }
    });
  });

  test('Ctrl+ArrowRight jumps to last sibling album', async () => {
    const onAlbumClick = jest.fn();

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <AlbumPage
          colorMode={{ mode: 'light' }}
          albumPath="/photos/A2"
          urlMode={true}
          onAlbumClick={onAlbumClick}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        '/photos/A2'
      );
    });

    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });

    expect(onAlbumClick).toHaveBeenCalledWith('/photos/A3', 'A3', null);
  });

  test('Ctrl+ArrowLeft jumps to first sibling album', async () => {
    const onAlbumClick = jest.fn();

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <AlbumPage
          colorMode={{ mode: 'light' }}
          albumPath="/photos/A2"
          urlMode={true}
          onAlbumClick={onAlbumClick}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        '/photos/A2'
      );
    });

    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true });

    expect(onAlbumClick).toHaveBeenCalledWith('/photos/A1', 'A1', null);
  });
});
