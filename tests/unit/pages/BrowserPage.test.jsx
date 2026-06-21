import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockAlbumRefreshTargets = [];

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useLocation: jest.fn(),
    useNavigate: jest.fn(),
    useParams: jest.fn()
  };
});

jest.mock('../../../src/renderer/pages/HomePage', () =>
  jest.fn((props) => {
    const React = require('react');
    const { useContext, useEffect, useMemo, useRef } = React;
    const { useLocation } = require('react-router-dom');
    const { ScrollPositionContext } = require('../../../src/renderer/App');

    function MockHomePage() {
      const location = useLocation();
      const scrollContext = useContext(ScrollPositionContext);
      const scrollContainerRef = useRef(null);
      const scrollPositionKey = useMemo(
        () => `${props.tabScrollKey || '__missing__'}::${location.pathname}${location.search}`,
        [props.tabScrollKey, location.pathname, location.search]
      );

      useEffect(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContext.getPosition(scrollPositionKey);
        }
      }, [scrollContext, scrollPositionKey]);

      return (
        <div data-testid="home-page">
          {props.tabsHeaderContent}
          <div
            ref={scrollContainerRef}
            className="scroll-container"
            data-testid="mock-scroll-container"
          />
          <button
            type="button"
            onClick={() => props.onOpenFavoritesInNewTab?.()}
          >
            模拟打开收藏
          </button>
        </div>
      );
    }

    return <MockHomePage />;
  })
);

jest.mock('../../../src/renderer/pages/AlbumPage', () =>
  jest.fn((props) => (
    <div data-testid="album-page">
      {props.tabsHeaderContent}
      <div data-testid="mock-album-path">{props.albumPath}</div>
      <button
        type="button"
        onClick={() => props.onAlbumClick?.('/albums/random', 'random', null)}
      >
        模拟随机相簿
      </button>
      <button
        type="button"
        onClick={() => mockAlbumRefreshTargets.push(props.albumPath)}
      >
        模拟刷新当前相簿
      </button>
      <button
        type="button"
        onClick={() => props.onOpenFavoritesInNewTab?.()}
      >
        模拟打开收藏
      </button>
    </div>
  ))
);

jest.mock('../../../src/renderer/pages/FavoritesPage', () =>
  jest.fn((props) => <div data-testid="favorites-page">{props.tabsHeaderContent}</div>)
);

jest.mock('../../../src/renderer/utils/navigation', () => {
  const actual = jest.requireActual('../../../src/renderer/utils/navigation');
  return {
    ...actual,
    withLastPathTracking: jest.fn((navigate) => navigate),
    getLastPath: jest.fn(() => ''),
    setLastPath: jest.fn()
  };
});

const HomePage = require('../../../src/renderer/pages/HomePage');
const AlbumPage = require('../../../src/renderer/pages/AlbumPage');
const FavoritesPage = require('../../../src/renderer/pages/FavoritesPage');
const { ScrollPositionContext } = require('../../../src/renderer/App');
const navigationUtils = require('../../../src/renderer/utils/navigation');
const reactRouter = require('react-router-dom');
const CHANNELS = require('../../../src/common/ipc-channels');
const ipcRenderer = global.electronMock.ipcRenderer;

const setupRouterMocks = ({
  pathname = '/',
  search = '',
  params = {},
  state = null
} = {}) => {
  const navigateMock = jest.fn();

  reactRouter.useLocation.mockReturnValue({ pathname, search, state });
  reactRouter.useNavigate.mockReturnValue(navigateMock);
  reactRouter.useParams.mockReturnValue(params);

  return navigateMock;
};

describe('BrowserPage', () => {
  const browserPageModule = require('../../../src/renderer/pages/BrowserPage');
  const BrowserPage = browserPageModule.default;
  const { reorderTabsById } = browserPageModule;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockAlbumRefreshTargets.length = 0;
    navigationUtils.getLastPath.mockReturnValue('');
    window.electronAPI.getPathForFile = jest.fn((file) => file?.mockPath || '');
    ipcRenderer.invoke.mockResolvedValue(undefined);
  });

  test('renders HomePage for root folder view', () => {
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(HomePage).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPath: '',
        urlMode: true
      }),
      {}
    );
    expect(AlbumPage).not.toHaveBeenCalled();
  });

  test('renders AlbumPage when viewMode=album in URL', () => {
    setupRouterMocks({
      pathname: '/browse/%2Fphotos',
      search: '?view=album&image=cover.jpg'
    });

    render(<BrowserPage colorMode="light" />);

    expect(screen.getByTestId('album-page')).toBeInTheDocument();
    expect(AlbumPage).toHaveBeenCalledWith(
      expect.objectContaining({
        albumPath: '/photos',
        initialImage: 'cover.jpg',
        urlMode: true
      }),
      {}
    );
    expect(HomePage).not.toHaveBeenCalled();
  });

  test('renders FavoritesPage when viewMode=favorites in URL', () => {
    setupRouterMocks({
      pathname: '/browse',
      search: '?view=favorites'
    });

    render(<BrowserPage colorMode="light" />);

    expect(screen.getByTestId('favorites-page')).toBeInTheDocument();
    expect(FavoritesPage).toHaveBeenCalledWith(
      expect.objectContaining({
        urlMode: true
      }),
      {}
    );
    expect(HomePage).not.toHaveBeenCalled();
    expect(AlbumPage).not.toHaveBeenCalled();
  });

  test('restores last path when no target specified', () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    navigationUtils.getLastPath.mockReturnValue('/previous/path');

    render(<BrowserPage colorMode="light" />);

    expect(navigateMock).toHaveBeenCalledWith('/previous/path', {
      initialImage: null,
      replace: true,
      viewMode: 'folder'
    });
  });

  test('restores tabs session with album view mode', () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    localStorage.setItem('browser_tabs_session_v1', JSON.stringify({
      tabs: [
        {
          id: 'tab_album_1',
          targetPath: '/albums/wedding',
          viewMode: 'album',
          initialImage: 'cover.jpg'
        }
      ],
      activeTabId: 'tab_album_1'
    }));

    render(<BrowserPage colorMode="dark" />);

    expect(navigateMock).toHaveBeenCalledWith('/albums/wedding', {
      viewMode: 'album',
      initialImage: 'cover.jpg',
      replace: true
    });
  });

  test('restores full tabs when current URL matches a saved tab', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Fwedding',
      search: '?view=album&image=cover.jpg'
    });

    localStorage.setItem('browser_tabs_session_v1', JSON.stringify({
      tabs: [
        {
          id: 'tab-folder',
          targetPath: '/albums/trip',
          viewMode: 'folder',
          initialImage: null
        },
        {
          id: 'tab-album',
          targetPath: '/albums/wedding',
          viewMode: 'album',
          initialImage: 'cover.jpg'
        }
      ],
      activeTabId: 'tab-folder'
    }));

    render(<BrowserPage colorMode="dark" />);

    expect(screen.getByRole('tab', { name: /trip/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wedding/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wedding/i })).toHaveAttribute('aria-selected', 'true');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('keeps deep link as single tab when URL does not match saved session tabs', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Fnew%2Fpath',
      search: '?view=folder'
    });

    localStorage.setItem('browser_tabs_session_v1', JSON.stringify({
      tabs: [
        {
          id: 'tab-old',
          targetPath: '/albums/wedding',
          viewMode: 'album',
          initialImage: null
        },
        {
          id: 'tab-other',
          targetPath: '/albums/trip',
          viewMode: 'folder',
          initialImage: null
        }
      ],
      activeTabId: 'tab-old'
    }));

    render(<BrowserPage colorMode="dark" />);

    expect(screen.getByRole('tab', { name: /path/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wedding/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /trip/i })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('keeps favorites deep link as single tab when URL does not match saved session tabs', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: '?view=favorites'
    });

    localStorage.setItem('browser_tabs_session_v1', JSON.stringify({
      tabs: [
        {
          id: 'tab-old',
          targetPath: '/albums/wedding',
          viewMode: 'album',
          initialImage: null
        }
      ],
      activeTabId: 'tab-old'
    }));

    render(<BrowserPage colorMode="dark" />);

    expect(screen.getByRole('tab', { name: /我的收藏/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wedding/i })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('tracks last path for non-root navigation', () => {
    setupRouterMocks({
      pathname: '/browse/%2Fphotos',
      search: ''
    });

    render(<BrowserPage colorMode="dark" />);

    expect(navigationUtils.setLastPath).toHaveBeenCalledWith('/photos');
  });

  test('falls back to default root directory when no tabs session and no last path', () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    localStorage.setItem('lastRootPath_default', '/photos/default-root');

    render(<BrowserPage colorMode="light" />);

    expect(navigateMock).toHaveBeenCalledWith('/photos/default-root', {
      initialImage: null,
      replace: true,
      viewMode: 'folder'
    });
  });

  test('opens favorites from home in a new active tab without replacing current tab', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Ftrip',
      search: '?view=folder'
    });

    render(<BrowserPage colorMode="light" />);

    fireEvent.click(screen.getByText('模拟打开收藏'));

    expect(screen.getByRole('tab', { name: /trip/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /trip/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /我的收藏/i })).toHaveAttribute('aria-selected', 'true');
    expect(navigateMock).toHaveBeenLastCalledWith('', {
      viewMode: 'favorites',
      initialImage: null,
      replace: false
    });
  });

  test('opens favorites from album in a new active tab without replacing current tab', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Fwedding',
      search: '?view=album'
    });

    render(<BrowserPage colorMode="dark" />);

    fireEvent.click(screen.getByText('模拟打开收藏'));

    expect(screen.getByRole('tab', { name: /wedding/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wedding/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /我的收藏/i })).toHaveAttribute('aria-selected', 'true');
    expect(navigateMock).toHaveBeenLastCalledWith('', {
      viewMode: 'favorites',
      initialImage: null,
      replace: false
    });
  });

  test('saves current tabs snapshot from tabs menu', () => {
    setupRouterMocks({
      pathname: '/browse/%2Falbums%2Ftrip',
      search: '?view=folder'
    });

    render(<BrowserPage colorMode="light" />);

    fireEvent.click(screen.getByLabelText('标签页列表'));
    fireEvent.click(screen.getByText('保存当前标签组'));

    const savedRaw = localStorage.getItem('browser_tabs_snapshot_v1');
    expect(savedRaw).toBeTruthy();

    const savedSnapshot = JSON.parse(savedRaw);
    expect(savedSnapshot.tabs).toEqual([
      expect.objectContaining({
        targetPath: '/albums/trip',
        viewMode: 'folder',
        initialImage: null
      })
    ]);
    expect(savedSnapshot.activeTabId).toBeTruthy();
  });

  test('restores saved tabs snapshot from tabs menu', () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    localStorage.setItem('browser_tabs_snapshot_v1', JSON.stringify({
      tabs: [
        {
          id: 'tab-album-restore',
          targetPath: '/albums/wedding',
          viewMode: 'album',
          initialImage: 'cover.jpg'
        }
      ],
      activeTabId: 'tab-album-restore'
    }));

    render(<BrowserPage colorMode="dark" />);

    fireEvent.click(screen.getByLabelText('标签页列表'));
    fireEvent.click(screen.getByText('恢复已保存标签组'));

    expect(navigateMock).toHaveBeenCalledWith('/albums/wedding', {
      viewMode: 'album',
      initialImage: 'cover.jpg',
      replace: true
    });
  });

  test('opens every dropped Finder folder in a new tab and activates the last one', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel, paths) => {
      if (channel === CHANNELS.RESOLVE_DROPPED_FOLDERS) {
        return Promise.resolve({
          folders: paths,
          rejected: []
        });
      }
      return Promise.resolve();
    });

    render(<BrowserPage colorMode="dark" />);

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [
          { name: 'trip', mockPath: '/photos/trip' },
          { name: 'family', mockPath: '/photos/family' }
        ]
      }
    });

    await screen.findByRole('tab', { name: /trip/i });
    expect(screen.getByRole('tab', { name: /family/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /family/i })).toHaveAttribute('aria-selected', 'true');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.RESOLVE_DROPPED_FOLDERS,
      ['/photos/trip', '/photos/family']
    );
    expect(navigateMock).toHaveBeenLastCalledWith('/photos/family', {
      viewMode: 'folder',
      initialImage: null,
      replace: false
    });
  });

  test('shows an error and keeps tabs unchanged when dropped items are not folders', async () => {
    setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.RESOLVE_DROPPED_FOLDERS) {
        return Promise.resolve({
          folders: [],
          rejected: ['/photos/image.jpg']
        });
      }
      return Promise.resolve();
    });

    render(<BrowserPage colorMode="dark" />);

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'image.jpg', mockPath: '/photos/image.jpg' }]
      }
    });

    expect(await screen.findByText('只支持拖入文件夹')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /image\.jpg/i })).not.toBeInTheDocument();
  });

  test('redirects legacy route with album path to new browse url', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/album',
      search: '?image=image.jpg',
      params: { albumPath: 'old%2Falbum' },
      state: { from: 'legacy' }
    });

    render(<BrowserPage colorMode="dark" redirectFromOldRoute />);

    expect(navigateMock).toHaveBeenCalledWith('old/album', {
      initialImage: 'image.jpg',
      replace: true,
      state: { from: 'legacy' },
      viewMode: 'album'
    });
  });

  test('redirects legacy route without album path back to root', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/album',
      search: '',
      params: {}
    });

    render(<BrowserPage colorMode="dark" redirectFromOldRoute />);

    expect(navigateMock).toHaveBeenCalledWith('/', {
      replace: true,
      state: null
    });
  });

  test('reorderTabsById moves dragged tab before target tab', () => {
    const tabs = [
      { id: 'tab-a', title: 'A' },
      { id: 'tab-b', title: 'B' },
      { id: 'tab-c', title: 'C' },
      { id: 'tab-d', title: 'D' }
    ];

    const reordered = reorderTabsById(tabs, 'tab-a', 'tab-c');

    expect(reordered.map((tab) => tab.id)).toEqual(['tab-b', 'tab-a', 'tab-c', 'tab-d']);
  });

  test('reorderTabsById keeps list unchanged for invalid ids', () => {
    const tabs = [
      { id: 'tab-a', title: 'A' },
      { id: 'tab-b', title: 'B' }
    ];

    expect(reorderTabsById(tabs, 'tab-x', 'tab-b')).toBe(tabs);
    expect(reorderTabsById(tabs, 'tab-a', 'tab-a')).toBe(tabs);
  });

  test('reorderTabsById supports dropping after target tab', () => {
    const tabs = [
      { id: 'tab-a', title: 'A' },
      { id: 'tab-b', title: 'B' },
      { id: 'tab-c', title: 'C' },
      { id: 'tab-d', title: 'D' }
    ];

    const reordered = reorderTabsById(tabs, 'tab-a', 'tab-c', 'after');
    expect(reordered.map((tab) => tab.id)).toEqual(['tab-b', 'tab-c', 'tab-a', 'tab-d']);
  });

  test('go back from Windows drive subpath navigates to drive root', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/C%3A%2Fphotos',
      search: '?view=album'
    });

    render(<BrowserPage colorMode="dark" />);
    const latestAlbumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
    act(() => {
      latestAlbumProps.onGoBack();
    });

    expect(navigateMock).toHaveBeenCalledWith('C:/', {
      viewMode: 'folder',
      initialImage: null,
      replace: false
    });
  });

  test('keeps album content in sync with tab state after random navigation before url catches up', () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Fold',
      search: '?view=album'
    });

    render(<BrowserPage colorMode="dark" />);

    expect(screen.getByRole('tab', { name: /old/i })).toBeInTheDocument();
    expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/albums/old');

    fireEvent.click(screen.getByText('模拟随机相簿'));

    expect(navigateMock).toHaveBeenCalledWith('/albums/random', {
      viewMode: 'album',
      initialImage: null,
      replace: false
    });
    expect(screen.getByRole('tab', { name: /random/i })).toBeInTheDocument();
    expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/albums/random');

    fireEvent.click(screen.getByText('模拟刷新当前相簿'));
    expect(mockAlbumRefreshTargets).toEqual(['/albums/random']);
  });

  test('preserves independent scroll positions when switching between same-path tabs', () => {
    const routerState = {
      pathname: '/browse/%2Falbums%2Fshared',
      search: '?view=folder',
      state: null
    };
    const navigateMock = jest.fn();
    const scrollPositions = {};
    const scrollContextValue = {
      positions: scrollPositions,
      savePosition: jest.fn((key, position) => {
        scrollPositions[key] = position;
      }),
      getPosition: jest.fn((key) => scrollPositions[key] || 0)
    };

    reactRouter.useLocation.mockImplementation(() => routerState);
    reactRouter.useNavigate.mockReturnValue(navigateMock);
    reactRouter.useParams.mockReturnValue({});

    localStorage.setItem('browser_tabs_session_v1', JSON.stringify({
      tabs: [
        {
          id: 'tab-a',
          targetPath: '/albums/shared',
          viewMode: 'folder',
          initialImage: null
        },
        {
          id: 'tab-b',
          targetPath: '/albums/shared',
          viewMode: 'folder',
          initialImage: null
        }
      ],
      activeTabId: 'tab-a'
    }));

    render(
      <ScrollPositionContext.Provider value={scrollContextValue}>
        <BrowserPage colorMode="dark" scrollContext={scrollContextValue} />
      </ScrollPositionContext.Provider>
    );

    let scrollContainer = screen.getByTestId('mock-scroll-container');
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0
    });

    scrollContainer.scrollTop = 240;
    act(() => {
      fireEvent.click(screen.getAllByRole('tab')[1]);
    });

    expect(scrollContextValue.savePosition).toHaveBeenCalled();
    scrollContainer = screen.getByTestId('mock-scroll-container');

    scrollContainer.scrollTop = 40;
    act(() => {
      fireEvent.click(screen.getAllByRole('tab')[0]);
    });

    scrollContainer = screen.getByTestId('mock-scroll-container');
    expect(scrollContainer.scrollTop).toBe(240);
  });
});
