import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

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
  jest.fn(({ album, onClick }) => (
    <button type="button" onClick={onClick}>
      {album?.name || 'album'}
    </button>
  ))
);

jest.mock('../../../src/renderer/components/ImageCard', () =>
  jest.fn(({ image }) => <div data-testid="image-card">{image?.name || 'image'}</div>)
);

jest.mock('../../../src/renderer/components/ImageViewer', () =>
  jest.fn(() => <div data-testid="image-viewer" />)
);

jest.mock('../../../src/renderer/contexts/FavoritesContext', () => ({
  useFavorites: jest.fn(() => ({
    isLoading: false,
    favorites: {
      folders: [
        {
          id: 'folder_1',
          kind: 'folder',
          path: '/photos/mixed',
          name: 'mixed'
        }
      ],
      albums: [
        {
          id: 'album_1',
          kind: 'photoSet',
          path: '/photos/mixed',
          name: 'mixed photos',
          imageCount: 2
        }
      ],
      images: [],
      collections: []
    }
  }))
}));

const reactRouter = require('react-router-dom');
const { ScrollPositionContext } = require('../../../src/renderer/App');
const FavoritesPage = require('../../../src/renderer/pages/FavoritesPage').default;

describe('FavoritesPage navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    reactRouter.useNavigate.mockReturnValue(jest.fn());
    reactRouter.useLocation.mockReturnValue({
      pathname: '/favorites',
      search: '',
      state: null
    });
  });

  test('opens folder favorites in folder view and photo-set favorites in album view', () => {
    const onNavigate = jest.fn();

    render(
      <ScrollPositionContext.Provider
        value={{ savePosition: jest.fn(), getPosition: jest.fn(() => 0) }}
      >
        <FavoritesPage urlMode={true} onNavigate={onNavigate} />
      </ScrollPositionContext.Provider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'mixed' }));
    fireEvent.click(screen.getByRole('button', { name: 'mixed photos' }));

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/photos/mixed', 'folder');
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/photos/mixed', 'album');
  });
});
