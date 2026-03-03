import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

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
  jest.fn((props) => <div data-testid="home-page">{props.tabsHeaderContent}</div>)
);

jest.mock('../../../src/renderer/pages/AlbumPage', () =>
  jest.fn((props) => <div data-testid="album-page">{props.tabsHeaderContent}</div>)
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
const navigationUtils = require('../../../src/renderer/utils/navigation');
const reactRouter = require('react-router-dom');

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
    navigationUtils.getLastPath.mockReturnValue('');
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
});
