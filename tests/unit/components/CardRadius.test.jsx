import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import AlbumCard from '../../../src/renderer/components/AlbumCard';
import ImageCard from '../../../src/renderer/components/ImageCard';

const favoriteMocks = {
  isFolderFavorited: jest.fn(() => false),
  isAlbumFavorited: jest.fn(() => false),
  toggleFolderFavorite: jest.fn(),
  toggleAlbumFavorite: jest.fn(),
  isImageFavorited: jest.fn(() => false),
  toggleImageFavorite: jest.fn()
};

jest.mock('../../../src/renderer/contexts/FavoritesContext', () => ({
  useFavorites: jest.fn(() => ({
    isFolderFavorited: jest.fn(() => false),
    isAlbumFavorited: jest.fn(() => false),
    toggleFolderFavorite: jest.fn(),
    toggleAlbumFavorite: jest.fn(),
    isImageFavorited: jest.fn(() => false),
    toggleImageFavorite: jest.fn()
  }))
}));

jest.mock('../../../src/renderer/hooks/useIsVisible', () => jest.fn(() => true));

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn()
  }
}));

jest.mock('../../../src/renderer/utils/thumbnailUrl', () => ({
  getThumbnailUrl: jest.fn((path) => `thumbnail-protocol://${encodeURIComponent(path || 'mock')}`)
}));

const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;

const renderWithTheme = (ui) =>
  render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);

describe('card radius styling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { useFavorites } = require('../../../src/renderer/contexts/FavoritesContext');
    useFavorites.mockReturnValue(favoriteMocks);
    imageCache.get.mockImplementation((type) => {
      if (type === 'preview') {
        return [
          'thumbnail-protocol://one',
          'thumbnail-protocol://two',
          'thumbnail-protocol://three',
          'thumbnail-protocol://four'
        ];
      }

      return null;
    });
  });

  test('ImageCard uses the approved larger outer card radius', () => {
    const { container } = renderWithTheme(
      <ImageCard
        image={{ path: '/albums/a.jpg', name: 'a.jpg' }}
        onClick={jest.fn()}
        density="standard"
      />
    );

    expect(container.firstChild).toHaveStyle('border-radius: 18px');
  });

  test('AlbumCard renders folder previews as a single album-style cover', () => {
    const { container } = renderWithTheme(
      <AlbumCard
        node={{
          path: '/albums/trip',
          name: 'trip',
          type: 'folder',
          imageCount: 24,
          samples: ['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg'],
          childFolders: 3
        }}
        onClick={jest.fn()}
      />
    );

    expect(container.firstChild).toHaveStyle('border-radius: 18px');

    const coverImages = container.querySelectorAll('img[alt="trip"]');
    expect(coverImages).toHaveLength(1);
    expect(container.querySelectorAll('img[alt^="预览"]')).toHaveLength(0);
    expect(container).toHaveTextContent('3');
  });

  test('AlbumCard keeps folder favorite semantics after visual unification', () => {
    const { getByLabelText } = renderWithTheme(
      <AlbumCard
        node={{
          path: '/albums/trip',
          name: 'trip',
          type: 'folder',
          imageCount: 24,
          samples: ['/a.jpg'],
          childFolders: 3
        }}
        onClick={jest.fn()}
      />
    );

    fireEvent.click(getByLabelText('添加收藏'));

    expect(favoriteMocks.toggleFolderFavorite).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'folder',
        path: '/albums/trip',
        name: 'trip'
      })
    );
    expect(favoriteMocks.toggleAlbumFavorite).not.toHaveBeenCalled();
  });
});
