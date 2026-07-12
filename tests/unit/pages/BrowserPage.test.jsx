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

jest.mock('../../../src/renderer/hooks/useRandomNavigationCoordinator', () => ({
  useRandomNavigationCoordinator: jest.fn()
}));

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
const {
  useRandomNavigationCoordinator
} = require('../../../src/renderer/hooks/useRandomNavigationCoordinator');
const reactRouter = require('react-router-dom');
const CHANNELS = require('../../../src/common/ipc-channels');
const browserTabsSessionV1 = require('../../fixtures/legacy/browser-tabs-session-v1.json');
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

const createV2Session = ({ tabs, activeTabId = tabs[0].id }) => ({
  schemaVersion: 2,
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
    navigationUtils.getLastPath.mockReturnValue('');
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

  test('waits for SourceRoot hydration before migrating v1 or persisting v2', async () => {
    const source = createSource();
    const deferredLoad = createDeferred();
    const v1Raw = JSON.stringify({
      tabs: [{
        id: 'tab-v1',
        targetPath: '/Volumes/NAS/Photos/2026/旅行',
        viewMode: 'album',
        initialImage: '/Volumes/NAS/Photos/2026/旅行/001.jpg'
      }],
      activeTabId: 'tab-v1'
    });
    localStorage.setItem('browser_tabs_session_v1', v1Raw);
    const getItemSpy = jest.spyOn(localStorage, 'getItem');

    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) return deferredLoad.promise;
      return Promise.resolve(undefined);
    });
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.LOAD_SOURCE_ROOTS_V1,
      { contractVersion: 1 }
    );
    expect(getItemSpy).not.toHaveBeenCalledWith('browser_tabs_session_v1');
    expect(localStorage.getItem('browser_tabs_session_v2')).toBeNull();

    await act(async () => {
      deferredLoad.resolve(createLoadSourcesResponse([source]));
      await deferredLoad.promise;
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-album-path'))
        .toHaveTextContent('/Volumes/NAS/Photos/2026/旅行');
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });
    expect(localStorage.getItem('browser_tabs_session_v1')).toBe(v1Raw);
    getItemSpy.mockRestore();
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });
  });

  test('keeps legacy v1 tabs running without writing v2 when registry loading fails', async () => {
    const v1Raw = JSON.stringify({
      tabs: [{
        id: 'tab-legacy',
        targetPath: '/Offline/旅行',
        viewMode: 'album',
        initialImage: '/Offline/旅行/001.jpg'
      }],
      activeTabId: 'tab-legacy'
    });
    localStorage.setItem('browser_tabs_session_v1', v1Raw);
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve({
          contractVersion: 1,
          ok: false,
          data: null,
          error: {
            code: 'SOURCE_ROOT_IO_ERROR',
            message: 'offline',
            retryable: true,
            details: null
          }
        });
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/Offline/旅行');
    });
    expect(localStorage.getItem('browser_tabs_session_v2')).toBeNull();
    expect(localStorage.getItem('browser_tabs_session_v1')).toBe(v1Raw);
  });

  test('materializes canonical v2 folder and album locations into legacy page props', async () => {
    const source = createSource();
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
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
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
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

  test('passes null random handlers to legacy HomePage and AlbumPage locations', async () => {
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
      tabs: [
        {
          id: 'tab-legacy-folder',
          location: {
            kind: 'legacyAbsolute',
            legacyAbsolutePath: '/Legacy/Folder',
            viewMode: 'folder',
            legacyInitialMediaPath: null
          }
        },
        {
          id: 'tab-legacy-album',
          location: {
            kind: 'legacyAbsolute',
            legacyAbsolutePath: '/Legacy/Album',
            viewMode: 'album',
            legacyInitialMediaPath: null
          }
        }
      ],
      activeTabId: 'tab-legacy-folder'
    })));
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.onRandomBrowse).toBeNull();
      expect(homeProps.onRandomScopeRefresh).toBeNull();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Album/i }));

    await waitFor(() => {
      const albumProps = AlbumPage.mock.calls[AlbumPage.mock.calls.length - 1][0];
      expect(albumProps.onRandomBrowse).toBeNull();
      expect(albumProps.onRandomScopeRefresh).toBeNull();
    });
  });

  test('restores a mixed-case v2 source id against the lowercase registry source', async () => {
    const source = createSource();
    const mixedCaseSourceId = SOURCE_ID.toUpperCase();
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
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
        view: 'folder'
      }).toString()}`
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const homeProps = HomePage.mock.calls[HomePage.mock.calls.length - 1][0];
      expect(homeProps.currentPath).toBe('/Volumes/NAS/Photos/2026/旅行');
      expect(homeProps.sourceBoundary?.sourceId).toBe(SOURCE_ID);
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location.target.sourceId).toBe(mixedCaseSourceId);
    });
  });

  test('migrates a unique v1 root, keeps unresolved tabs open, and preserves v1 raw bytes', async () => {
    const source = createSource();
    const sessionRaw = `  ${JSON.stringify({
      tabs: [
        {
          id: 'tab-resolved',
          targetPath: '/Volumes/NAS/Photos/2026/旅行',
          viewMode: 'folder',
          initialImage: null
        },
        {
          id: 'tab-unresolved',
          targetPath: '/Other/旅行',
          viewMode: 'album',
          initialImage: '/Other/旅行/cover.jpg'
        }
      ],
      activeTabId: 'tab-unresolved'
    }, null, 2)}\n`;
    const snapshotRaw = `\n${JSON.stringify({
      tabs: [{
        id: 'snapshot-v1',
        targetPath: '/Volumes/NAS/Photos/快照',
        viewMode: 'folder',
        initialImage: null
      }],
      activeTabId: 'snapshot-v1'
    })}`;
    localStorage.setItem('browser_tabs_session_v1', sessionRaw);
    localStorage.setItem('browser_tabs_snapshot_v1', snapshotRaw);
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([source]));
      }
      return Promise.resolve(undefined);
    });
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(screen.getAllByRole('tab')).toHaveLength(2);
      expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/Other/旅行');
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    const saved = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
    expect(saved.tabs).toEqual([
      {
        id: 'tab-resolved',
        location: createCanonicalLocation({
          relativePath: '2026/旅行',
          viewMode: 'browse'
        })
      },
      {
        id: 'tab-unresolved',
        location: {
          kind: 'legacyAbsolute',
          legacyAbsolutePath: '/Other/旅行',
          viewMode: 'album',
          legacyInitialMediaPath: '/Other/旅行/cover.jpg'
        }
      }
    ]);
    expect(localStorage.getItem('browser_tabs_session_v1')).toBe(sessionRaw);
    expect(localStorage.getItem('browser_tabs_snapshot_v1')).toBe(snapshotRaw);
  });

  test('keeps tabs with different source identities even when paths materialize equally', async () => {
    const sources = [
      createSource(),
      createSource({ sourceId: SECOND_SOURCE_ID, label: '备份照片' })
    ];
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
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
      search: `?sourceId=${SECOND_SOURCE_ID}&relativePath=2026%2F%E6%97%85%E8%A1%8C&view=folder`
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
      search: `?sourceId=${SOURCE_ID}&relativePath=2026&view=folder`
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
      search: `?sourceId=${SOURCE_ID}&relativePath=&view=album`
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

  test('opens an unregistered legacy root in a new window with the absolute path fallback', async () => {
    setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Selected/Photos');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: false, error: 'save failed' });
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
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.CREATE_NEW_INSTANCE,
        '/Selected/Photos'
      );
    });
  });

  test('keeps the selected root as an explicit legacy location when source registration throws', async () => {
    const ancestorSource = createSource({ rootPath: '/Photos' });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([ancestorSource]));
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Photos/Nested');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.reject(new Error('disk unavailable'));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith('/Photos/Nested', {
        viewMode: 'folder',
        initialImage: null,
        replace: false
      });
      expect(screen.getByText('来源注册失败，已使用兼容模式打开')).toBeInTheDocument();
    });
  });

  test('keeps the selected root as an explicit legacy location when source registration returns ok false', async () => {
    const ancestorSource = createSource({ rootPath: '/Photos' });
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([ancestorSource]));
      }
      if (channel === CHANNELS.SELECT_DIRECTORY) return Promise.resolve('/Photos/Nested');
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve({ contractVersion: 1, ok: false, error: 'save failed' });
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '打开文件夹' }));
    fireEvent.click(screen.getByText('在当前标签打开文件夹'));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenLastCalledWith('/Photos/Nested', {
        viewMode: 'folder',
        initialImage: null,
        replace: false
      });
      expect(screen.getByText('来源注册失败，已使用兼容模式打开')).toBeInTheDocument();
    });
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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
      search: `?sourceId=${SOURCE_ID}&relativePath=&view=folder`
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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
      search: `?sourceId=${SOURCE_ID}&relativePath=&view=folder`
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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
      search: `?sourceId=${SOURCE_ID}&relativePath=External&view=folder`,
      state: null
    });
    rerender(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location).toEqual(createCanonicalLocation({ relativePath: 'External' }));
      expect(screen.getByRole('tab', { name: /External/i })).toHaveAttribute('aria-selected', 'true');
    });

    await act(async () => {
      deferredSave.resolve(createSaveSourceResponse(selectedSource));
      await deferredSave.promise;
    });

    const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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

  test('registers an already-decoded legacy initialPath without decoding percent twice', async () => {
    const initialSource = createSource({
      rootPath: '/photos/100%done',
      label: '100%done'
    });
    const navigateMock = setupRouterMocks({
      pathname: '/',
      search: '?initialPath=%2Fphotos%2F100%25done'
    });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse());
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) {
        return Promise.resolve(createSaveSourceResponse(initialSource));
      }
      return Promise.resolve(undefined);
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: '/photos/100%done',
        label: null
      });
      expect(navigateMock).toHaveBeenLastCalledWith(
        navigationUtils.buildNavigationTargetUrl({
          sourceId: SOURCE_ID,
          relativePath: '',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }),
        { replace: true }
      );
    });
  });

  test('lets a newer canonical URL finish hydration while an initialPath registration is pending', async () => {
    const loadedSource = createSource();
    const delayedSource = createSource({
      sourceId: SECOND_SOURCE_ID,
      rootPath: '/Slow/Root',
      label: 'Slow Root'
    });
    const deferredSave = createDeferred();
    const navigateMock = setupRouterMocks({
      pathname: '/',
      search: '?initialPath=%2FSlow%2FRoot'
    });
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === CHANNELS.LOAD_SOURCE_ROOTS_V1) {
        return Promise.resolve(createLoadSourcesResponse([loadedSource]));
      }
      if (channel === CHANNELS.SAVE_SOURCE_ROOT_V1) return deferredSave.promise;
      return Promise.resolve(undefined);
    });

    const { rerender } = render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(CHANNELS.SAVE_SOURCE_ROOT_V1, {
        contractVersion: 1,
        sourceId: null,
        rootPath: '/Slow/Root',
        label: null
      });
    });

    reactRouter.useLocation.mockReturnValue({
      pathname: '/browse',
      search: `?sourceId=${SOURCE_ID}&relativePath=2027&view=album`,
      state: null
    });
    rerender(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location).toEqual(createCanonicalLocation({
        relativePath: '2027',
        viewMode: 'photoSet'
      }));
      expect(screen.getByTestId('mock-album-path')).toHaveTextContent('/Volumes/NAS/Photos/2027');
    });

    await act(async () => {
      deferredSave.resolve(createSaveSourceResponse(delayedSource));
      await deferredSave.promise;
    });

    const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
    const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
    expect(activeTab.location).toEqual(createCanonicalLocation({
      relativePath: '2027',
      viewMode: 'photoSet'
    }));
    expect(navigateMock).not.toHaveBeenCalled();
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
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
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
      search: `?sourceId=${SECOND_SOURCE_ID}&relativePath=2027%2FTrip&view=folder`
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
    localStorage.setItem('browser_tabs_session_v2', JSON.stringify(createV2Session({
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
        view: 'album',
        image: explicitTargetB.initialMediaRelativePath
      }).toString()}`
    });

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-album-path'))
        .toHaveTextContent('/Volumes/NAS/Photos/aa:browse:aa/xx');
      const savedSession = JSON.parse(localStorage.getItem('browser_tabs_session_v2'));
      const activeTab = savedSession.tabs.find((tab) => tab.id === savedSession.activeTabId);
      expect(activeTab.location).toEqual({ kind: 'directory', target: explicitTargetB });
    });
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  test('renders HomePage for root folder view', async () => {
    setupRouterMocks({ pathname: '/', search: '' });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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

  test('renders AlbumPage when viewMode=album in URL', async () => {
    setupRouterMocks({
      pathname: '/browse/%2Fphotos',
      search: '?view=album&image=cover.jpg'
    });

    render(<BrowserPage colorMode="light" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    expect(screen.getByTestId('album-page')).toBeInTheDocument();
    expect(AlbumPage).toHaveBeenCalledWith(
      expect.objectContaining({
        albumPath: '/photos',
        initialImage: '/photos/cover.jpg',
        urlMode: true
      }),
      {}
    );
    expect(HomePage).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.SAVE_SOURCE_ROOT_V1,
      expect.anything()
    );
  });

  test('renders FavoritesPage when viewMode=favorites in URL', async () => {
    setupRouterMocks({
      pathname: '/browse',
      search: '?view=favorites'
    });

    render(<BrowserPage colorMode="light" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
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

  test('restores last path when no target specified', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    navigationUtils.getLastPath.mockReturnValue('/previous/path');

    render(<BrowserPage colorMode="light" />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/previous/path', {
        initialImage: null,
        replace: true,
        viewMode: 'folder'
      });
    });
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.SAVE_SOURCE_ROOT_V1,
      expect.anything()
    );
  });

  test('restores tabs session with album view mode', async () => {
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

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/albums/wedding', {
        viewMode: 'album',
        initialImage: '/albums/wedding/cover.jpg',
        replace: true
      });
    });
  });

  test('restores full tabs when current URL matches a saved tab', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Fwedding',
      search: '?view=album&image=cover.jpg'
    });

    localStorage.setItem(
      'browser_tabs_session_v1',
      JSON.stringify(browserTabsSessionV1)
    );

    render(<BrowserPage colorMode="dark" />);

    expect(await screen.findByRole('tab', { name: /trip/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wedding/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /wedding/i })).toHaveAttribute('aria-selected', 'true');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('keeps deep link as single tab when URL does not match saved session tabs', async () => {
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
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    expect(screen.getByRole('tab', { name: /path/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wedding/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /trip/i })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('keeps favorites deep link as single tab when URL does not match saved session tabs', async () => {
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
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    expect(screen.getByRole('tab', { name: /我的收藏/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /wedding/i })).not.toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  test('tracks last path for non-root navigation', async () => {
    setupRouterMocks({
      pathname: '/browse/%2Fphotos',
      search: ''
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    expect(navigationUtils.setLastPath).toHaveBeenCalledWith('/photos');
  });

  test('falls back to default root directory when no tabs session and no last path', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });
    localStorage.setItem('lastRootPath_default', '/photos/default-root');

    render(<BrowserPage colorMode="light" />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/photos/default-root', {
        initialImage: null,
        replace: true,
        viewMode: 'folder'
      });
    });
    expect(ipcRenderer.invoke).not.toHaveBeenCalledWith(
      CHANNELS.SAVE_SOURCE_ROOT_V1,
      expect.anything()
    );
  });

  test('opens favorites from home in a new active tab without replacing current tab', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Ftrip',
      search: '?view=folder'
    });

    render(<BrowserPage colorMode="light" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

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

  test('opens favorites from album in a new active tab without replacing current tab', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Fwedding',
      search: '?view=album'
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

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

  test('saves current tabs snapshot from tabs menu without touching the v1 key', async () => {
    setupRouterMocks({
      pathname: '/browse/%2Falbums%2Ftrip',
      search: '?view=folder'
    });

    render(<BrowserPage colorMode="light" />);

    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('标签页列表'));
    fireEvent.click(screen.getByText('保存当前标签组'));

    const savedRaw = localStorage.getItem('browser_tabs_snapshot_v2');
    expect(savedRaw).toBeTruthy();

    const savedSnapshot = JSON.parse(savedRaw);
    expect(savedSnapshot.schemaVersion).toBe(2);
    expect(savedSnapshot.tabs[0].location).toEqual({
      kind: 'legacyAbsolute',
      legacyAbsolutePath: '/albums/trip',
      viewMode: 'folder',
      legacyInitialMediaPath: null
    });
    expect(savedSnapshot.activeTabId).toBeTruthy();
    expect(localStorage.getItem('browser_tabs_snapshot_v1')).toBeNull();
  });

  test('restores saved v1 tabs snapshot without changing its raw string', async () => {
    const navigateMock = setupRouterMocks({ pathname: '/', search: '' });

    const snapshotRaw = JSON.stringify({
      tabs: [
        {
          id: 'tab-album-restore',
          targetPath: '/albums/wedding',
          viewMode: 'album',
          initialImage: 'cover.jpg'
        }
      ],
      activeTabId: 'tab-album-restore'
    });
    localStorage.setItem('browser_tabs_snapshot_v1', snapshotRaw);

    render(<BrowserPage colorMode="dark" />);

    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('标签页列表'));
    fireEvent.click(screen.getByText('恢复已保存标签组'));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/albums/wedding', {
        viewMode: 'album',
        initialImage: '/albums/wedding/cover.jpg',
        replace: true
      });
    });
    expect(mockClearAllRandomState).toHaveBeenCalledTimes(1);
    expect(mockClearAllRandomState.mock.invocationCallOrder[0]).toBeLessThan(
      AlbumPage.mock.invocationCallOrder[0]
    );
    expect(localStorage.getItem('browser_tabs_snapshot_v1')).toBe(snapshotRaw);
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

  test('go back from Windows drive subpath navigates to drive root', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/C%3A%2Fphotos',
      search: '?view=album'
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });
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

  test('keeps album content in sync with tab state after random navigation before url catches up', async () => {
    const navigateMock = setupRouterMocks({
      pathname: '/browse/%2Falbums%2Fold',
      search: '?view=album'
    });

    render(<BrowserPage colorMode="dark" />);
    await waitFor(() => {
      expect(localStorage.getItem('browser_tabs_session_v2')).toBeTruthy();
    });

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

  test('preserves independent scroll positions when switching between same-path tabs', async () => {
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
