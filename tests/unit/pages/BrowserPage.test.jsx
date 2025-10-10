import React from 'react';
import { render, screen } from '@testing-library/react';

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
  jest.fn(() => <div data-testid="home-page" />)
);

jest.mock('../../../src/renderer/pages/AlbumPage', () =>
  jest.fn(() => <div data-testid="album-page" />)
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
  const BrowserPage = require('../../../src/renderer/pages/BrowserPage').default;

  beforeEach(() => {
    jest.clearAllMocks();
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

  test('tracks last path for non-root navigation', () => {
    setupRouterMocks({
      pathname: '/browse/%2Fphotos',
      search: ''
    });

    render(<BrowserPage colorMode="dark" />);

    expect(navigationUtils.setLastPath).toHaveBeenCalledWith('/photos');
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
});
