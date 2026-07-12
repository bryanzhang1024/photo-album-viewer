import React from 'react';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: jest.fn(),
    useLocation: jest.fn()
  };
});

jest.mock('react-virtuoso', () => {
  const React = require('react');
  return {
    Virtuoso: ({ data = [], itemContent, rangeChanged }) => {
      React.useEffect(() => {
        rangeChanged?.({ startIndex: 0, endIndex: Math.max(0, data.length - 1) });
      }, [data, rangeChanged]);

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

jest.mock('../../../src/renderer/components/AlbumCard', () =>
  jest.fn(({ node }) => <div data-testid="album-card">{node?.name || 'node'}</div>)
);

jest.mock('../../../src/renderer/components/ImageCard', () =>
  jest.fn(({ image, onClick }) => (
    <div data-testid="image-card" onClick={onClick}>{image?.name || 'image'}</div>
  ))
);

jest.mock('../../../src/renderer/components/ImageViewer', () =>
  jest.fn(() => <div data-testid="image-viewer" />)
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
  useFavorites: jest.fn(() => ({
    favorites: { folders: [], albums: [], images: [], collections: [] },
    isFolderFavorited: jest.fn(() => false),
    isAlbumFavorited: jest.fn(() => false),
    toggleFolderFavorite: jest.fn(),
    toggleAlbumFavorite: jest.fn()
  }))
}));

jest.mock('../../../src/renderer/contexts/SettingsContext', () => ({
  useSettings: jest.fn(() => ({
    settings: { homeSortGrouping: 'mixed' }
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

jest.mock('../../../src/renderer/hooks/useShuffleBag', () => jest.fn());

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
const { useSettings } = require('../../../src/renderer/contexts/SettingsContext');
const useShuffleBag = require('../../../src/renderer/hooks/useShuffleBag');
const HomePage = require('../../../src/renderer/pages/HomePage').default;
const BreadcrumbNavigation = require('../../../src/renderer/components/BreadcrumbNavigation');
const CHANNELS = require('../../../src/common/ipc-channels');
const ipcRenderer = global.electronMock.ipcRenderer;

let drawRandomAlbum;
let resetRandomBag;

beforeEach(() => {
  drawRandomAlbum = jest.fn();
  resetRandomBag = jest.fn();
  useShuffleBag.mockReturnValue({
    drawNext: drawRandomAlbum,
    resetBag: resetRandomBag
  });
});

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

describe('HomePage refresh button', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    window.history.pushState({}, '', '/');
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse/%2Fphotos',
      search: '',
      state: null
    });
    imageCache.get.mockReturnValue(null);
    useSettings.mockReturnValue({
      settings: { homeSortGrouping: 'mixed' }
    });
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [],
      directImages: [],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 0,
        totalNodes: 0,
        directImageCount: 0
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

  test('routes the toolbar random action through the canonical coordinator without local navigation', async () => {
    const onRandomBrowse = jest.fn().mockResolvedValue(undefined);
    const onAlbumClick = jest.fn();
    drawRandomAlbum.mockReturnValue({ path: '/photos/local', name: 'local' });
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          path: '/photos/local',
          name: 'local',
          imageCount: 1,
          samples: ['/photos/local/1.jpg']
        }
      ],
      directImages: [],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 1,
        totalNodes: 1,
        directImageCount: 0
      }
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          onAlbumClick={onAlbumClick}
          onRandomBrowse={onRandomBrowse}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    expect(await screen.findByText('local')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }));
    fireEvent.click(screen.getByRole('button', { name: '随机当前文件夹 (E)' }));

    await waitFor(() => {
      expect(onRandomBrowse).toHaveBeenCalledTimes(1);
    });
    expect(onRandomBrowse.mock.calls).toEqual([[]]);
    expect(onAlbumClick).not.toHaveBeenCalled();
  });

  test('invalidates the canonical random scope before refreshing the current folder', async () => {
    const onRandomBrowse = jest.fn().mockResolvedValue(undefined);
    const onRandomScopeRefresh = jest.fn();

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          onRandomBrowse={onRandomBrowse}
          onRandomScopeRefresh={onRandomScopeRefresh}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        '/photos'
      );
    });
    ipcRenderer.invoke.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '刷新当前文件夹' }));

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        '/photos'
      );
    });
    expect(onRandomScopeRefresh).toHaveBeenCalledTimes(1);
    expect(onRandomScopeRefresh.mock.invocationCallOrder[0])
      .toBeLessThan(ipcRenderer.invoke.mock.invocationCallOrder[0]);
    expect(resetRandomBag).not.toHaveBeenCalled();
    expect(onRandomBrowse).not.toHaveBeenCalled();
  });

  test.each([
    ['loading', { randomBrowseLoading: true }],
    ['disabled', { randomBrowseDisabled: true }]
  ])('disables canonical random browsing while it is %s', async (_state, randomProps) => {
    const onRandomBrowse = jest.fn().mockResolvedValue(undefined);
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          path: '/photos/local',
          name: 'local',
          imageCount: 1,
          samples: ['/photos/local/1.jpg']
        }
      ],
      directImages: [],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 1,
        totalNodes: 1,
        directImageCount: 0
      }
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          onRandomBrowse={onRandomBrowse}
          urlMode={true}
          {...randomProps}
        />
      </ScrollPositionContext.Provider>
    );

    expect(await screen.findByText('local')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }));
    const randomButton = screen.getByRole('button', { name: '随机当前文件夹 (E)' });

    expect(randomButton).toBeDisabled();
    fireEvent.click(randomButton);
    expect(onRandomBrowse).not.toHaveBeenCalled();
  });

  test('keeps the page-local random adapter when the canonical coordinator is absent', async () => {
    const onAlbumClick = jest.fn();
    drawRandomAlbum.mockReturnValue({ path: '/photos/local', name: 'local' });
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          path: '/photos/local',
          name: 'local',
          imageCount: 1,
          samples: ['/photos/local/1.jpg']
        }
      ],
      directImages: [],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 1,
        totalNodes: 1,
        directImageCount: 0
      }
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          onAlbumClick={onAlbumClick}
          onRandomBrowse={null}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    expect(await screen.findByText('local')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '视图选项' }));
    fireEvent.click(screen.getByRole('button', { name: '随机当前文件夹 (E)' }));

    expect(onAlbumClick).toHaveBeenCalledWith('/photos/local', 'local');
  });

  test('leaves page random refresh and navigation callbacks untouched while the viewer owns E and R', async () => {
    const onRandomBrowse = jest.fn().mockResolvedValue(undefined);
    const onRandomScopeRefresh = jest.fn();
    const onAlbumClick = jest.fn();
    const onNavigate = jest.fn();
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [],
      directImages: [
        {
          path: '/photos/1.jpg',
          name: '1.jpg',
          size: 1,
          lastModified: 1
        }
      ],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 0,
        totalNodes: 0,
        directImageCount: 1
      }
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          onAlbumClick={onAlbumClick}
          onNavigate={onNavigate}
          onRandomBrowse={onRandomBrowse}
          onRandomScopeRefresh={onRandomScopeRefresh}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    fireEvent.click(await screen.findByText('1.jpg'));
    expect(screen.getByTestId('image-viewer')).toBeInTheDocument();
    ipcRenderer.invoke.mockClear();
    imageCache.clearType.mockClear();

    await act(async () => {
      ['e', 'E', 'r', 'R'].forEach((key) => fireEvent.keyDown(window, { key }));
      await Promise.resolve();
    });

    expect(onRandomBrowse).not.toHaveBeenCalled();
    expect(onRandomScopeRefresh).not.toHaveBeenCalled();
    expect(onAlbumClick).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(resetRandomBag).not.toHaveBeenCalled();
    expect(imageCache.clearType).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('does not decode an already-decoded initialPath percent sequence twice', async () => {
    const currentPath = '/photos/100%done';
    window.history.pushState({}, '', '/?initialPath=%2Fphotos%2F100%25done');

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath={currentPath}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        currentPath
      );
    });
  });

  test.each(SOURCE_BOUNDARY_CASES)(
    'renders %s breadcrumbs from the SourceRoot boundary while keeping legacy content scan',
    async (_name, sourceBoundary, currentPath, sourceBreadcrumbs) => {
      ipcRenderer.invoke.mockImplementation((channel, targetPath) => {
        if (channel === CHANNELS.SCAN_NAVIGATION_LEVEL) {
          return Promise.resolve({
            success: true,
            currentPath: targetPath,
            nodes: [],
            directImages: [],
            breadcrumbs: [
              { name: '/', path: '/' },
              { name: 'OS root', path: currentPath }
            ],
            metadata: {
              folderCount: 0,
              albumCount: 0,
              totalNodes: 0,
              directImageCount: 0
            }
          });
        }
        return Promise.resolve(undefined);
      });

      render(
        <ScrollPositionContext.Provider
          value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
        >
          <HomePage
            colorMode={{ mode: 'light' }}
            currentPath={currentPath}
            sourceBoundary={sourceBoundary}
            sourceBreadcrumbs={sourceBreadcrumbs}
            urlMode={true}
          />
        </ScrollPositionContext.Provider>
      );

      await waitFor(() => {
        expect(ipcRenderer.invoke).toHaveBeenCalledWith(
          CHANNELS.SCAN_NAVIGATION_LEVEL,
          currentPath
        );
        const breadcrumbProps = BreadcrumbNavigation.mock.calls[
          BreadcrumbNavigation.mock.calls.length - 1
        ][0];
        expect(breadcrumbProps.breadcrumbs).toEqual(sourceBreadcrumbs);
      });
      expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
        CHANNELS.GET_DIRECTORY_LEVEL_V1,
        expect.anything()
      );
    }
  );

  test.each([
    ['POSIX', '/Volumes/NAS/Photos', '/Volumes/NAS/Photos'],
    ['Windows drive', 'D:\\Pictures', 'D:/Pictures'],
    ['UNC', '\\\\NAS\\Photos', '//NAS/Photos']
  ])('uses the %s SourceRoot as the canonical go-up boundary', async (
    _name,
    rootPath,
    currentPath
  ) => {
    const sourceBoundary = {
      sourceId: SOURCE_ID,
      label: '家庭照片',
      rootPath,
      relativePath: ''
    };
    const sourceBreadcrumbs = [
      { name: '家庭照片', path: rootPath }
    ];
    const onNavigate = jest.fn();
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath,
      nodes: [],
      directImages: [],
      breadcrumbs: [{ name: 'Photos', path: currentPath }],
      metadata: {
        folderCount: 0,
        albumCount: 0,
        totalNodes: 0,
        directImageCount: 0
      }
    });

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath={currentPath}
          sourceBoundary={sourceBoundary}
          sourceBreadcrumbs={sourceBreadcrumbs}
          onNavigate={onNavigate}
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SCAN_NAVIGATION_LEVEL,
        currentPath
      );
    });
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  test('renders folder cards and direct images on the same folder page', async () => {
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'folder',
          path: '/photos/child',
          name: 'child',
          childFolders: 0,
          imageCount: 0,
          samples: []
        }
      ],
      directImages: [
        {
          path: '/photos/root.jpg',
          name: 'root.jpg',
          size: 10,
          lastModified: new Date('2024-01-01T00:00:00.000Z')
        }
      ],
      breadcrumbs: [],
      metadata: {
        folderCount: 1,
        albumCount: 0,
        totalNodes: 1,
        directImageCount: 1
      }
    });

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
      expect(screen.getByText('child')).toBeInTheDocument();
      expect(screen.getByText('root.jpg')).toBeInTheDocument();
    });

    expect(screen.getAllByTestId('virtuoso')).toHaveLength(1);
    expect(screen.getAllByTestId('album-card')).toHaveLength(1);
    expect(screen.getAllByTestId('image-card')).toHaveLength(1);
    expect(screen.queryByTestId('direct-images-section')).not.toBeInTheDocument();
    expect(screen.getByText('共 0 个相簿, 1 张照片')).toBeInTheDocument();
    expect(screen.queryByText(/个文件夹/)).not.toBeInTheDocument();
  });

  test('mixes folders albums and direct images in one name-sorted grid', async () => {
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          path: '/photos/b-album',
          name: 'b-album',
          imageCount: 2,
          samples: ['/photos/b-album/1.jpg'],
          lastModified: new Date('2024-01-02T00:00:00.000Z')
        },
        {
          type: 'folder',
          path: '/photos/c-folder',
          name: 'c-folder',
          childFolders: 3,
          imageCount: 0,
          samples: ['/photos/c-folder/nested.jpg'],
          lastModified: new Date('2024-01-03T00:00:00.000Z')
        }
      ],
      directImages: [
        {
          path: '/photos/a-photo.jpg',
          name: 'a-photo.jpg',
          size: 10,
          lastModified: new Date('2024-01-01T00:00:00.000Z')
        }
      ],
      breadcrumbs: [],
      metadata: {
        folderCount: 1,
        albumCount: 1,
        totalNodes: 2,
        directImageCount: 1
      }
    });

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
      expect(screen.getByText('a-photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('b-album')).toBeInTheDocument();
      expect(screen.getByText('c-folder')).toBeInTheDocument();
    });

    const cards = [
      ...screen.getAllByTestId('album-card'),
      ...screen.getAllByTestId('image-card')
    ];
    const content = screen.getByText('a-photo.jpg').closest('[data-testid="virtuoso"]');

    expect(screen.getAllByTestId('virtuoso')).toHaveLength(1);
    expect(content).toHaveTextContent(/a-photo\.jpg.*b-album.*c-folder/s);
    expect(cards).toHaveLength(3);
  });

  test('keeps folders before albums and albums before direct images when configured', async () => {
    useSettings.mockReturnValue({
      settings: { homeSortGrouping: 'containersFirst' }
    });
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          path: '/photos/b-album',
          name: 'b-album',
          imageCount: 2,
          samples: ['/photos/b-album/1.jpg']
        },
        {
          type: 'folder',
          path: '/photos/c-folder',
          name: 'c-folder',
          childFolders: 3,
          imageCount: 0,
          samples: ['/photos/c-folder/nested.jpg']
        }
      ],
      directImages: [
        {
          path: '/photos/a-photo.jpg',
          name: 'a-photo.jpg',
          size: 10,
          lastModified: new Date('2024-01-01T00:00:00.000Z')
        }
      ],
      breadcrumbs: [],
      metadata: {
        folderCount: 1,
        albumCount: 1,
        totalNodes: 2,
        directImageCount: 1
      }
    });

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
      expect(screen.getByText('a-photo.jpg')).toBeInTheDocument();
      expect(screen.getByText('b-album')).toBeInTheDocument();
      expect(screen.getByText('c-folder')).toBeInTheDocument();
    });

    const content = screen.getByText('c-folder').closest('[data-testid="virtuoso"]');

    expect(screen.getAllByTestId('virtuoso')).toHaveLength(1);
    expect(content).toHaveTextContent(/c-folder.*b-album.*a-photo\.jpg/s);
  });

  test('opens image viewer from a direct image inside the mixed grid', async () => {
    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          path: '/photos/album',
          name: 'album',
          imageCount: 2,
          samples: ['/photos/album/1.jpg']
        }
      ],
      directImages: [
        {
          path: '/photos/a.jpg',
          name: 'a.jpg',
          size: 10,
          lastModified: new Date('2024-01-01T00:00:00.000Z')
        },
        {
          path: '/photos/z.jpg',
          name: 'z.jpg',
          size: 10,
          lastModified: new Date('2024-01-02T00:00:00.000Z')
        }
      ],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 1,
        totalNodes: 1,
        directImageCount: 2
      }
    });

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
      expect(screen.getByText('z.jpg')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('z.jpg'));

    expect(screen.getByTestId('image-viewer')).toBeInTheDocument();
  });

  test('routes hybrid nodes to album view on primary click', async () => {
    const onFolderClick = jest.fn();
    const onAlbumClick = jest.fn();

    ipcRenderer.invoke.mockResolvedValue({
      success: true,
      currentPath: '/photos',
      nodes: [
        {
          type: 'album',
          contentKind: 'hybrid',
          canViewAsPhotoSet: true,
          canBrowseChildren: true,
          path: '/photos/coser',
          name: 'coser',
          imageCount: 12,
          childFolders: 1,
          samples: ['/photos/coser/001.jpg']
        }
      ],
      directImages: [],
      breadcrumbs: [],
      metadata: {
        folderCount: 0,
        albumCount: 1,
        totalNodes: 1,
        directImageCount: 0
      }
    });

    const AlbumCardMock = require('../../../src/renderer/components/AlbumCard');
    AlbumCardMock.mockImplementation(({ node, onClick }) => (
      <button type="button" data-testid="album-card" onClick={onClick}>{node?.name}</button>
    ));

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos"
          urlMode={true}
          onFolderClick={onFolderClick}
          onAlbumClick={onAlbumClick}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(screen.getByText('coser')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('coser'));

    expect(onAlbumClick).toHaveBeenCalledWith('/photos/coser', 'coser');
    expect(onFolderClick).not.toHaveBeenCalled();
  });
});

describe('HomePage scan progress', () => {
  let progressListener;
  let resolveScan;

  beforeEach(() => {
    jest.clearAllMocks();
    progressListener = null;
    resolveScan = null;
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse/%2Fphotos%2Flarge',
      search: '',
      state: null
    });
    imageCache.get.mockReturnValue(null);
    useSettings.mockReturnValue({
      settings: { homeSortGrouping: 'mixed' }
    });
    ipcRenderer.on.mockImplementation((channel, listener) => {
      if (channel === 'scan-navigation-progress') {
        progressListener = listener;
      }
    });
    ipcRenderer.invoke.mockImplementation((channel, targetPath) => {
      if (channel !== 'scan-navigation-level') {
        return Promise.resolve({});
      }

      return new Promise((resolve) => {
        resolveScan = () => resolve({
          success: true,
          currentPath: targetPath,
          nodes: [
            { path: `${targetPath}/album-1`, name: 'album-1', type: 'album', imageCount: 1 }
          ],
          directImages: [],
          breadcrumbs: [],
          metadata: {
            folderCount: 0,
            albumCount: 1,
            totalNodes: 1,
            directImageCount: 0
          }
        });
      });
    });
  });

  test('shows progress bar with scanned counts during navigation scan', async () => {
    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <HomePage
          colorMode={{ mode: 'light' }}
          currentPath="/photos/large"
          urlMode={true}
        />
      </ScrollPositionContext.Provider>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('scan-navigation-level', '/photos/large');
      expect(progressListener).toBeTruthy();
    });

    act(() => {
      progressListener({}, {
        targetPath: '/photos/large',
        processed: 2,
        total: 5,
        done: false
      });
    });

    expect(screen.getByText('正在扫描 2 / 5 项…')).toBeInTheDocument();

    await act(async () => {
      resolveScan();
    });
    await waitFor(() => {
      expect(screen.queryByText('正在扫描 2 / 5 项…')).not.toBeInTheDocument();
    });
    expect(await screen.findByTestId('album-card')).toBeInTheDocument();
  });
});
