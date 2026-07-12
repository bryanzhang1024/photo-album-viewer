import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockAlbumRefreshTargets = [];
const mockHandleRandomBrowse = jest.fn();
const mockInvalidateRandomScope = jest.fn();
const mockClearAllRandomState = jest.fn();

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
        onClick={() => props.onAlbumClick?.('/Volumes/NAS/Photos/random', 'random', null)}
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
  jest.fn((props) => (
    <div data-testid="favorites-page">
      {props.tabsHeaderContent}
      <button type="button" onClick={() => props.onNavigate?.('/Missing/Favorite', 'album')}>
        模拟打开失联收藏
      </button>
    </div>
  ))
);

jest.mock('../../../src/renderer/hooks/useRandomNavigationCoordinator', () => ({
  useRandomNavigationCoordinator: jest.fn()
}));

const HomePage = require('../../../src/renderer/pages/HomePage');
const AlbumPage = require('../../../src/renderer/pages/AlbumPage');
const FavoritesPage = require('../../../src/renderer/pages/FavoritesPage');
const { ScrollPositionContext } = require('../../../src/renderer/App');
const navigationUtils = require('../../../src/renderer/utils/navigation');
const {
  useRandomNavigationCoordinator
} = require('../../../src/renderer/hooks/useRandomNavigationCoordinator');
const reactRouter = require('react-router-dom');
const CHANNELS = require('../../../src/common/ipc-channels');
const ipcRenderer = global.electronMock.ipcRenderer;

const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';
const SECOND_SOURCE_ID = 'src_22222222-2222-4222-8222-222222222222';

const createSource = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: SOURCE_ID,
  label: '家庭照片',
  rootPath: '/Volumes/NAS/Photos',
  sourceGeneration: 1,
  ...overrides
});

const createLoadSourcesResponse = (sources = []) => ({
  contractVersion: 1,
  ok: true,
  data: { sources }
});

const createSaveSourceResponse = (source, created = true) => ({
  contractVersion: 1,
  ok: true,
  data: { source, created }
});

const createDeferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createCanonicalLocation = (overrides = {}) => ({
  kind: 'directory',
  target: {
    sourceId: SOURCE_ID,
    relativePath: '2026/旅行',
    viewMode: 'browse',
    initialMediaRelativePath: null,
    ...overrides
  }
});

const createV3Session = ({ tabs, activeTabId = tabs[0].id }) => ({
  schemaVersion: 3,
  tabs,
  activeTabId,
  savedAt: 1783785600000
});

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
    useRandomNavigationCoordinator.mockImplementation(({ activeTab }) => ({
      available: activeTab?.location?.kind === 'directory',
      randomBrowseLoading: true,
      randomBrowseDisabled: true,
      handleRandomBrowse: mockHandleRandomBrowse,
      invalidateActiveScope: mockInvalidateRandomScope,
      clearAllRandomState: mockClearAllRandomState
    }));
    window.electronAPI.getPathForFile = jest.fn((file) => file?.mockPath || '');
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      return Promise.resolve(undefined);
    });
  });

  test('starts from landing after clearing legacy navigation state only', async () => {
    localStorage.setItem('browser_tabs_session_v1', '{"legacy":1}');
    localStorage.setItem('browser_tabs_session_v2', '{"schemaVersion":2}');
    localStorage.setItem('browser_tabs_snapshot_v1', 'legacy-snapshot');
    localStorage.setItem('lastPath', '/Old/Photos');
    localStorage.setItem('lastRootPath_default', '/Old/Root');
    localStorage.setItem('themeMode', 'dark');
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(localStorage.getItem('browser_tabs_session_v1')).toBeNull();
    expect(localStorage.getItem('browser_tabs_session_v2')).toBeNull();
    expect(localStorage.getItem('browser_tabs_snapshot_v1')).toBeNull();
    expect(localStorage.getItem('lastPath')).toBeNull();
    expect(localStorage.getItem('lastRootPath_default')).toBeNull();
    expect(localStorage.getItem('themeMode')).toBe('dark');
  });

  test('redirects a canonical deep link with a missing SourceRoot to landing with guidance', async () => {
    const url = navigationUtils.buildNavigationTargetUrl(createCanonicalLocation().target);
    const [pathname, search] = url.split('?');
    const navigateMock = setupRouterMocks({ pathname, search: `?${search}` });

    render(<BrowserPage colorMode="dark" />);

    expect(await screen.findByText('照片来源不可用，请重新打开来源目录')).toBeInTheDocument();
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  test('restores a v3 session with a missing SourceRoot as landing with guidance', async () => {
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [{ id: 'tab-missing-source', location: createCanonicalLocation() }]
    })));
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    expect(await screen.findByText('照片来源不可用，请重新打开来源目录')).toBeInTheDocument();
    expect(screen.getByTestId('home-page')).toBeInTheDocument();
    expect(navigateMock).toHaveBeenCalledWith('/', { replace: true });
  });

  test('keeps the active tab unchanged when SourceRoot registration fails', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: false, error: { message: 'failed' } });
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy());
    navigateMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));

    await waitFor(() => {
      expect(screen.getByText('无法建立照片来源，请检查目录是否可访问')).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.CREATE_NEW_INSTANCE,
      expect.anything()
    );
  });

  test('finishes SourceRoot hydration under React StrictMode remount effects', async () => {
    setupRouterMocks({ pathname: '/', search: '' });

    render(
      <React.StrictMode>
        <BrowserPage colorMode="dark" />
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.LOAD_SOURCE_ROOTS_V1,
        { contractVersion: 1 }
      );
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });
  });

  test('materializes canonical directory locations into page props', async () => {
    const source = createSource();
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [
        {
          id: 'tab-folder-v2',
          location: createCanonicalLocation({
            relativePath: '2025',
            viewMode: 'browse'
          })
        },
        {
          id: 'tab-album-v2',
          location: createCanonicalLocation({
            viewMode: 'photoSet',
            initialMediaRelativePath: '2026/旅行/001.jpg'
          })
        }
      ],
      activeTabId: 'tab-album-v2'
    })));
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const albumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
      expect(albumProps).toEqual(expect.objectContaining({
        albumPath: '/Volumes/NAS/Photos/2026/旅行',
        initialImage: '/Volumes/NAS/Photos/2026/旅行/001.jpg',
        sourceBoundary: {
          sourceId: SOURCE_ID,
          label: '家庭照片',
          rootPath: '/Volumes/NAS/Photos',
          relativePath: '2026/旅行'
        },
        sourceBreadcrumbs: [
          { name: '家庭照片', path: '/Volumes/NAS/Photos' },
          { name: '2026', path: '/Volumes/NAS/Photos/2026' },
          { name: '旅行', path: '/Volumes/NAS/Photos/2026/旅行' }
        ]
      }));
    });

    fireEvent.click(screen.getByRole('tab', { name: /2025/i }));

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.currentPath).toBe('/Volumes/NAS/Photos/2025');
      expect(homeProps.sourceBoundary).toEqual({
        sourceId: SOURCE_ID,
        label: '家庭照片',
        rootPath: '/Volumes/NAS/Photos',
        relativePath: '2025'
      });
    });
  });

  test('passes one canonical random coordinator contract to HomePage and AlbumPage', async () => {
    const source = createSource();
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [
        {
          id: 'tab-folder-random',
          location: createCanonicalLocation({
            relativePath: '2025',
            viewMode: 'browse'
          })
        },
        {
          id: 'tab-album-random',
          location: createCanonicalLocation({
            relativePath: '2026/旅行',
            viewMode: 'photoSet'
          })
        }
      ],
      activeTabId: 'tab-folder-random'
    })));
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps).toEqual(expect.objectContaining({
        onRandomBrowse: mockHandleRandomBrowse,
        onRandomScopeRefresh: mockInvalidateRandomScope,
        randomBrowseLoading: true,
        randomBrowseDisabled: true
      }));
    });
    const homeRandomHandler = HomePage.mock.calls[HomePage.mock.calls.length - 1][0]
      .onRandomBrowse;

    fireEvent.click(screen.getByRole('tab', { name: /旅行/i }));

    await waitFor(() => {
      const albumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
      expect(albumProps).toEqual(expect.objectContaining({
        onRandomBrowse: homeRandomHandler,
        onRandomScopeRefresh: mockInvalidateRandomScope,
        randomBrowseLoading: true,
        randomBrowseDisabled: true
      }));
    });
    expect(useRandomNavigationCoordinator).toHaveBeenLastCalledWith(expect.objectContaining({
      activeTabId: 'tab-album-random',
      activeSourceRoot: source,
      tabs: expect.arrayContaining([
        expect.objectContaining({ id: 'tab-folder-random' }),
        expect.objectContaining({ id: 'tab-album-random' })
      ]),
      commitTabLocation: expect.any(Function),
      ipcRenderer: window.electronAPI,
      onError: expect.any(Function)
    }));
  });

  test('restores a mixed-case v2 source id against the lowercase registry source', async () => {
    const source = createSource();
    const mixedCaseSourceId = SOURCE_ID.toUpperCase();
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [{
        id: 'tab-mixed-source',
        location: createCanonicalLocation({
          sourceId: mixedCaseSourceId,
          relativePath: '2026'
        })
      }]
    })));
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.currentPath).toBe('/Volumes/NAS/Photos/2026');
      expect(homeProps.sourceBoundary?.sourceId).toBe(SOURCE_ID);
    });

    const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
    act(() => {
      homeProps.onFolderClick('/Volumes/NAS/Photos/2026/旅行');
    });
    expect(navigateMock).toHaveBeenLastCalledWith(
      navigationUtils.buildNavigationTargetUrl({
        sourceId: mixedCaseSourceId,
        relativePath: '2026/旅行',
        viewMode: 'browse',
        initialMediaRelativePath: null
      }),
      {}
    );
  });

  test('materializes a mixed-case canonical URL against the lowercase registry source', async () => {
    const source = createSource();
    const mixedCaseSourceId = SOURCE_ID.toUpperCase();
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({
      pathname: '/browse',
      search: `?${new URLSearchParams({
        sourceId: mixedCaseSourceId,
        relativePath: '2026/旅行',
        view: 'browse'
      }).toString()}`
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.currentPath).toBe('/Volumes/NAS/Photos/2026/旅行');
      expect(homeProps.sourceBoundary?.sourceId).toBe(SOURCE_ID);
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v3'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location.target.sourceId).toBe(mixedCaseSourceId);
    });
  });

  test('keeps tabs with different source identities even when paths materialize equally', async () => {
    const sources = [
      createSource(),
      createSource({ sourceId: SECOND_SOURCE_ID, label: '备份照片' })
    ];
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [
        { id: 'tab-primary', location: createCanonicalLocation() },
        {
          id: 'tab-backup',
          location: createCanonicalLocation({ sourceId: SECOND_SOURCE_ID })
        }
      ],
      activeTabId: 'tab-primary'
    })));
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse(sources));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SECOND_SOURCE_ID}&relativePath=2026%2F%E6%97%85%E8%A1%8C&view=browse`
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const tripTabs = screen.getAllByRole('tab', { name: /旅行/i });
      expect(tripTabs).toHaveLength(2);
      expect(tripTabs[0]).toHaveAttribute('aria-selected', 'false');
      expect(tripTabs[1]).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('keeps the active sourceId for canonical child, album and breadcrumb navigation', async () => {
    const source = createSource();
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=2026&view=browse`
    });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.sourceBoundary?.sourceId).toBe(SOURCE_ID);
    });

    let homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
    act(() => {
      homeProps.onFolderClick('/Volumes/NAS/Photos/2026/旅行');
    });
    expect(navigateMock).toHaveBeenLastCalledWith(
      navigationUtils.buildNavigationTargetUrl({
        sourceId: SOURCE_ID,
        relativePath: '2026/旅行',
        viewMode: 'browse',
        initialMediaRelativePath: null
      }),
      {}
    );

    homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
    act(() => {
      homeProps.onAlbumClick(
        '/Volumes/NAS/Photos/2026/旅行/相册',
        '相册',
        '/Volumes/NAS/Photos/2026/旅行/相册/cover.jpg'
      );
    });
    expect(navigateMock).toHaveBeenLastCalledWith(
      navigationUtils.buildNavigationTargetUrl({
        sourceId: SOURCE_ID,
        relativePath: '2026/旅行/相册',
        viewMode: 'photoSet',
        initialMediaRelativePath: '2026/旅行/相册/cover.jpg'
      }),
      {}
    );

    const albumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
    act(() => {
      albumProps.onBreadcrumbNavigate('/Volumes/NAS/Photos/2026');
    });
    expect(navigateMock).toHaveBeenLastCalledWith(
      navigationUtils.buildNavigationTargetUrl({
        sourceId: SOURCE_ID,
        relativePath: '2026',
        viewMode: 'browse',
        initialMediaRelativePath: null
      }),
      {}
    );

    const callCount = navigateMock.mock.calls.length;
    homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
    act(() => {
      homeProps.onFolderClick('/Volumes/NAS/Photos-Archive/outside');
    });
    expect(navigateMock).toHaveBeenCalledTimes(callCount);
  });

  test('treats back from a canonical source root as a no-op', async () => {
    const source = createSource();
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=&view=photoSet`
    });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(screen.getByTestId('album-page')).toBeInTheDocument();
      const currentAlbumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
      expect(currentAlbumProps.sourceBoundary).toEqual({
        sourceId: SOURCE_ID,
        label: '家庭照片',
        rootPath: '/Volumes/NAS/Photos',
        relativePath: ''
      });
    });
    const albumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
    act(() => {
      albumProps.onGoBack();
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('registers a selected directory and opens the returned canonical root target', async () => {
    const selectedSource = createSource({ rootPath: '/Selected/Photos', label: 'Photos' });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve(createSaveSourceResponse(selectedSource));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.LOAD_SOURCE_ROOTS_V1,
        { contractVersion: 1 }
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: '/Selected/Photos',
        label: null
      });
      expect(navigateMock).toHaveBeenLastCalledWith(
        navigationUtils.buildNavigationTargetUrl({
          sourceId: SOURCE_ID,
          relativePath: '',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }),
        {}
      );
    });
  });

  test('opens a registered source root in a new window with the canonical target contract', async () => {
    const selectedSource = createSource({ rootPath: '/Selected/Photos', label: 'Photos' });
    setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve(createSaveSourceResponse(selectedSource));
      }
      if (channel === CHANNELS.CREATE_NEW_INSTANCE) return Promise.resolve({ success: true });
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.LOAD_SOURCE_ROOTS_V1,
        { contractVersion: 1 }
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在新窗口打开文件夹'));

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.CREATE_NEW_INSTANCE, {
        contractVersion: 1,
        target: {
          sourceId: SOURCE_ID,
          relativePath: '',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }
      });
    });
  });

  test('does not open a new window when selected directory registration fails', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Unavailable');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: false, error: { message: 'failed' } });
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy());
    navigateMock.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在新窗口打开文件夹'));

    expect(await screen.findByText('无法建立照片来源，请检查目录是否可访问')).toBeInTheDocument();
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(CHANNELS.CREATE_NEW_INSTANCE, expect.anything());
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('uses the returned canonical source when registration reports created false', async () => {
    const ancestorSource = createSource({ rootPath: '/Photos' });
    const selectedSource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/Photos/Nested',
      label: 'Nested'
    });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([ancestorSource]));
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Photos/Nested');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve(createSaveSourceResponse(selectedSource, false));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith(
        navigationUtils.buildNavigationTargetUrl({
          sourceId: SECOND_SOURCE_ID,
          relativePath: '',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }),
        {}
      );
    });
    expect(screen.queryByText('来源注册失败，已使用兼容模式打开')).not.toBeInTheDocument();
  });

  test('ignores a selected folder registration that resolves after unmount', async () => {
    const deferredSave = createDeferred();
    const selectedSource = createSource({ rootPath: '/Selected/Photos', label: 'Photos' });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) return deferredSave.promise;
      return Promise.resolve(undefined);
    });

    const { unmount } = render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, expect.anything());
    });

    unmount();
    await act(async () => {
      deferredSave.resolve(createSaveSourceResponse(selectedSource));
      await deferredSave.promise;
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('ignores an older selected folder when a newer selection finishes first', async () => {
    const firstSave = createDeferred();
    const firstSource = createSource({ rootPath: '/Selected/First', label: 'First' });
    const secondSource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/Selected/Second',
      label: 'Second'
    });
    let selectionCount = 0;
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) {
        selectionCount += 1;
        return Promise.resolve(selectionCount === 1 ? '/Selected/First' : '/Selected/Second');
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return payload.rootPath === '/Selected/First'
          ? firstSave.promise
          : Promise.resolve(createSaveSourceResponse(secondSource));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SAVE_SOURCE_ROOT_V1,
        expect.objectContaining({ rootPath: '/Selected/First' })
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));
    const secondUrl = navigationUtils.buildNavigationTargetUrl({
      sourceId: SECOND_SOURCE_ID,
      relativePath: '',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith(secondUrl, {});
    });

    await act(async () => {
      firstSave.resolve(createSaveSourceResponse(firstSource));
      await firstSave.promise;
    });

    expect(navigateMock).toHaveBeenLastCalledWith(secondUrl, {});
    expect(screen.getByRole('tab', { name: /Second/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('lets ordinary navigation supersede a pending selected folder registration', async () => {
    const deferredSave = createDeferred();
    const loadedSource = createSource();
    const selectedSource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/Selected/Slow',
      label: 'Slow'
    });
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=&view=browse`
    });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([loadedSource]));
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Slow');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) return deferredSave.promise;
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, expect.anything());
    });

    const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
    act(() => {
      homeProps.onFolderClick('/Volumes/NAS/Photos/Ordinary');
    });
    const ordinaryUrl = navigationUtils.buildNavigationTargetUrl({
      sourceId: SOURCE_ID,
      relativePath: 'Ordinary',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });
    expect(navigateMock).toHaveBeenLastCalledWith(ordinaryUrl, {});

    await act(async () => {
      deferredSave.resolve(createSaveSourceResponse(selectedSource));
      await deferredSave.promise;
    });

    expect(navigateMock).toHaveBeenLastCalledWith(ordinaryUrl, {});
    expect(screen.getByRole('tab', { name: /Ordinary/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('lets an external URL supersede a newer selection when an older pending navigation is stale', async () => {
    const deferredSave = createDeferred();
    const loadedSource = createSource();
    const selectedSource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/Selected/Slow',
      label: 'Slow'
    });
    let selectionCount = 0;
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=&view=browse`
    });
    ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([loadedSource]));
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) {
        selectionCount += 1;
        return Promise.resolve(selectionCount === 1
          ? '/Volumes/NAS/Photos'
          : '/Selected/Slow');
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return payload.rootPath === '/Volumes/NAS/Photos'
          ? Promise.resolve(createSaveSourceResponse(loadedSource, false))
          : deferredSave.promise;
      }
      return Promise.resolve(undefined);
    });

    const { rerender } = render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));
    const rootUrl = navigationUtils.buildNavigationTargetUrl({
      sourceId: SOURCE_ID,
      relativePath: '',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith(rootUrl, {});
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SAVE_SOURCE_ROOT_V1,
        expect.objectContaining({ rootPath: '/Selected/Slow' })
      );
    });

    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=External&view=browse`,
      state: null
    });
    rerender(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v3'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location).toEqual(createCanonicalLocation({ relativePath: 'External' }));
      expect(screen.getByRole('tab', { name: /External/i })).toHaveAttribute('aria-selected', 'true');
    });

    await act(async () => {
      deferredSave.resolve(createSaveSourceResponse(selectedSource));
      await deferredSave.promise;
    });

    const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v3'));
    const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
    expect(activeTab.location).toEqual(createCanonicalLocation({ relativePath: 'External' }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenLastCalledWith(rootUrl, {});
  });

  test('registers every dropped directory before opening canonical root tabs', async () => {
    const tripSource = createSource({ rootPath: '/photos/trip', label: 'trip' });
    const familySource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/photos/family',
      label: 'family'
    });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.RESOLVE_DROPPED_FOLDERS) {
        return Promise.resolve({ folders: payload, rejected: [] });
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        const source = payload.rootPath === '/photos/trip' ? tripSource : familySource;
        return Promise.resolve(createSaveSourceResponse(source));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.LOAD_SOURCE_ROOTS_V1,
        { contractVersion: 1 }
      );
    });

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [
          { name: 'trip', mockPath: '/photos/trip' },
          { name: 'family', mockPath: '/photos/family' }
        ]
      }
    });

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: '/photos/trip',
        label: null
      });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: '/photos/family',
        label: null
      });
      expect(navigateMock).toHaveBeenLastCalledWith(
        navigationUtils.buildNavigationTargetUrl({
          sourceId: SECOND_SOURCE_ID,
          relativePath: '',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }),
        {}
      );
    });
    expect(screen.getByRole('tab', { name: /trip/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /family/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps the active tab unchanged when a dropped directory cannot be registered', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.RESOLVE_DROPPED_FOLDERS) {
        return Promise.resolve({ folders: payload, rejected: [] });
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: false, error: { message: 'failed' } });
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy());
    navigateMock.mockClear();

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'unavailable', mockPath: '/photos/unavailable' }]
      }
    });

    expect(await screen.findByText('无法建立照片来源：/photos/unavailable')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /主页/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('ignores a dropped folder registration that resolves after unmount', async () => {
    const deferredSave = createDeferred();
    const droppedSource = createSource({ rootPath: '/Dropped/Slow', label: 'Slow' });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.RESOLVE_DROPPED_FOLDERS) {
        return Promise.resolve({ folders: payload, rejected: [] });
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) return deferredSave.promise;
      return Promise.resolve(undefined);
    });

    const { unmount } = render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'Slow', mockPath: '/Dropped/Slow' }]
      }
    });
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, expect.anything());
    });

    unmount();
    await act(async () => {
      deferredSave.resolve(createSaveSourceResponse(droppedSource));
      await deferredSave.promise;
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('ignores an older dropped folder when a newer drop finishes first', async () => {
    const firstSave = createDeferred();
    const firstSource = createSource({ rootPath: '/Dropped/First', label: 'First' });
    const secondSource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/Dropped/Second',
      label: 'Second'
    });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel, payload) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.RESOLVE_DROPPED_FOLDERS) {
        return Promise.resolve({ folders: payload, rejected: [] });
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return payload.rootPath === '/Dropped/First'
          ? firstSave.promise
          : Promise.resolve(createSaveSourceResponse(secondSource));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'First', mockPath: '/Dropped/First' }]
      }
    });
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.SAVE_SOURCE_ROOT_V1,
        expect.objectContaining({ rootPath: '/Dropped/First' })
      );
    });

    fireEvent.drop(document, {
      dataTransfer: {
        types: ['Files'],
        files: [{ name: 'Second', mockPath: '/Dropped/Second' }]
      }
    });
    const secondUrl = navigationUtils.buildNavigationTargetUrl({
      sourceId: SECOND_SOURCE_ID,
      relativePath: '',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });
    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith(secondUrl, {});
    });

    await act(async () => {
      firstSave.resolve(createSaveSourceResponse(firstSource));
      await firstSave.promise;
    });

    expect(navigateMock).toHaveBeenLastCalledWith(secondUrl, {});
    expect(screen.queryByRole('tab', { name: /First/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Second/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('lets canonical URL intent win over an unrelated stored session', async () => {
    const sources = [
      createSource(),
      createSource({
        sourceId: SECOND_SOURCE_ID,
        label: '第二图库',
        rootPath: '/Volumes/Second'
      })
    ];
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [{ id: 'stored-tab', location: createCanonicalLocation() }]
    })));
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse(sources));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SECOND_SOURCE_ID}&relativePath=2027%2FTrip&view=browse`
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(1);
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.currentPath).toBe('/Volumes/Second/2027/Trip');
      expect(homeProps.sourceBoundary?.sourceId).toBe(SECOND_SOURCE_ID);
    });
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.SAVE_SOURCE_ROOT_V1,
      expect.anything()
    );
  });

  test('lets explicit URL target B win when session target A has the old colon identity', async () => {
    const source = createSource();
    const sessionLocationA = createCanonicalLocation({
      relativePath: 'aa',
      viewMode: 'browse',
      initialMediaRelativePath: 'aa/xx:photoSet:aa:browse:aa/xx/y'
    });
    const explicitTargetB = {
      sourceId: SOURCE_ID,
      relativePath: 'aa:browse:aa/xx',
      viewMode: 'photoSet',
      initialMediaRelativePath: 'aa:browse:aa/xx/y'
    };
    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [{ id: 'tab-collision-a', location: sessionLocationA }]
    })));
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({
      pathname: '/browse',
      search: `?${new URLSearchParams({
        sourceId: explicitTargetB.sourceId,
        relativePath: explicitTargetB.relativePath,
        view: 'photoSet',
        image: explicitTargetB.initialMediaRelativePath
      }).toString()}`
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-album-path'))
        .toHaveTextContent('/Volumes/NAS/Photos/aa:browse:aa/xx');
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v3'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location).toEqual({ kind: 'directory', target: explicitTargetB });
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  test('renders HomePage for root folder view', async () => {
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

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

  test('renders FavoritesPage for the canonical favorites URL', async () => {
    setupRouterMocks({
      pathname: '/favorites',
      search: ''
    });

    render(<BrowserPage colorMode="light" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

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

  test('keeps favorites deep link as single tab when URL does not match saved session tabs', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/favorites',
      search: ''
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
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    expect(screen.getByRole('tab', { name: /我的收藏/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wedding/i })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('keeps the favorites tab unchanged when an absolute favorite matches no SourceRoot', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/favorites', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([
          createSource({ rootPath: '/Volumes/NAS/Photos' })
        ]));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => expect(screen.getByTestId('favorites-page')).toBeInTheDocument());
    navigateMock.mockClear();

    fireEvent.click(screen.getByText('模拟打开失联收藏'));

    expect(await screen.findByText('该目录未关联照片来源，请先重新打开来源目录')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: /我的收藏/i })).toHaveAttribute('aria-selected', 'true');
  });

  test('opens favorites from home in a new active tab without replacing current tab', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=trip&view=browse`
    });
    ipcRenderer.invoke.mockImplementation((channel) => (
      channel === CHANNELS.LOAD_SOURCE_ROOTS_V1
        ? Promise.resolve(createLoadSourcesResponse([createSource()]))
        : Promise.resolve(undefined)
    ));

    render(<BrowserPage colorMode="light" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('模拟打开收藏'));

    expect(screen.getByRole('tab', { name: /trip/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /trip/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /我的收藏/i })).toHaveAttribute('aria-selected', 'true');
    expect(navigateMock).toHaveBeenLastCalledWith('/favorites', {});
  });

  test('opens favorites from album in a new active tab without replacing current tab', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=wedding&view=photoSet`
    });
    ipcRenderer.invoke.mockImplementation((channel) => (
      channel === CHANNELS.LOAD_SOURCE_ROOTS_V1
        ? Promise.resolve(createLoadSourcesResponse([createSource()]))
        : Promise.resolve(undefined)
    ));

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('模拟打开收藏'));

    expect(screen.getByRole('tab', { name: /wedding/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wedding/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: /我的收藏/i })).toHaveAttribute('aria-selected', 'true');
    expect(navigateMock).toHaveBeenLastCalledWith('/favorites', {});
  });

  test('saves current tabs snapshot from tabs menu without touching the v1 key', async () => {
    setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=trip&view=browse`
    });
    ipcRenderer.invoke.mockImplementation((channel) => (
      channel === CHANNELS.LOAD_SOURCE_ROOTS_V1
        ? Promise.resolve(createLoadSourcesResponse([createSource()]))
        : Promise.resolve(undefined)
    ));

    render(<BrowserPage colorMode="light" />);

    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('标签页列表'));
    fireEvent.click(screen.getByText('保存当前标签组'));

    const savedRaw = localStorage.getItem('browser_tabs_snapshot_v3');
    expect(savedRaw).toBeTruthy();

    const savedSnapshot = JSON.parse(savedRaw);
    expect(savedSnapshot.schemaVersion).toBe(3);
    expect(savedSnapshot.tabs[0].location).toEqual({
      kind: 'directory',
      target: {
        sourceId: SOURCE_ID,
        relativePath: 'trip',
        viewMode: 'browse',
        initialMediaRelativePath: null
      }
    });
    expect(savedSnapshot.activeTabId).toBeTruthy();
    expect(localStorage.getItem('browser_tabs_snapshot_v1')).toBeNull();
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

  test('keeps album content in sync with tab state after random navigation before url catches up', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=old&view=photoSet`
    });
    ipcRenderer.invoke.mockImplementation((channel) => (
      channel === CHANNELS.LOAD_SOURCE_ROOTS_V1
        ? Promise.resolve(createLoadSourcesResponse([createSource()]))
        : Promise.resolve(undefined)
    ));

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v3')).toBeTruthy();
    });

    expect(screen.getByRole('tab', { name: /old/i })).toBeInTheDocument();
    expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/Volumes/NAS/Photos/old');

    fireEvent.click(screen.getByText('模拟随机相簿'));

    expect(navigateMock).toHaveBeenCalledWith(
      navigationUtils.buildNavigationTargetUrl({
        sourceId: SOURCE_ID,
        relativePath: 'random',
        viewMode: 'photoSet',
        initialMediaRelativePath: null
      }),
      {}
    );
    expect(screen.getByRole('tab', { name: /random/i })).toBeInTheDocument();
    expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/Volumes/NAS/Photos/random');

    fireEvent.click(screen.getByText('模拟刷新当前相簿'));
    expect(mockAlbumRefreshTargets).toEqual(['/Volumes/NAS/Photos/random']);
  });

  test('preserves independent scroll positions when switching between same-path tabs', async () => {
    const routerState = {
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=shared&view=browse`,
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

    localStorage.setItem('browser_tabs_session_v3', JSON.stringify(createV3Session({
      tabs: [
        {
          id: 'tab-a',
          location: createCanonicalLocation({ relativePath: 'shared' })
        },
        {
          id: 'tab-b',
          location: createCanonicalLocation({ relativePath: 'shared' })
        }
      ],
      activeTabId: 'tab-a'
    })));
    ipcRenderer.invoke.mockImplementation((channel) => (
      channel === CHANNELS.LOAD_SOURCE_ROOTS_V1
        ? Promise.resolve(createLoadSourcesResponse([createSource()]))
        : Promise.resolve(undefined)
    ));

    render(
      <ScrollPositionContext.Provider value={scrollContextValue}>
        <BrowserPage colorMode="dark" scrollContext={scrollContextValue} />
      </ScrollPositionContext.Provider>
    );

    await screen.findAllByRole('tab');
    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

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
