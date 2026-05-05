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
});
