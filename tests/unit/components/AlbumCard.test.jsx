import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import AlbumCard from '../../../src/renderer/components/AlbumCard';

jest.mock('../../../src/renderer/contexts/FavoritesContext', () => ({
  useFavorites: jest.fn(() => ({
    isFolderFavorited: jest.fn(() => false),
    isAlbumFavorited: jest.fn(() => false),
    toggleFolderFavorite: jest.fn(),
    toggleAlbumFavorite: jest.fn()
  }))
}));

jest.mock('../../../src/renderer/hooks/useIsVisible', () => jest.fn(() => true));

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => null),
    set: jest.fn()
  }
}));

const ipcRenderer = global.electronMock.ipcRenderer;

const renderAlbum = (albumOverrides = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <AlbumCard
      album={{
        id: 'album_1',
        kind: 'photoSet',
        path: '/library/album',
        name: 'album',
        imageCount: 1,
        ...albumOverrides
      }}
      onClick={jest.fn()}
      isFavoritesPage={true}
    />
  </ThemeProvider>
);

describe('AlbumCard preview fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads the first current album image when favorite preview metadata is missing', async () => {
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === 'get-album-images') {
        return Promise.resolve([{
          path: '/library/album/cover.jpg',
          name: 'cover.jpg'
        }]);
      }
      if (channel === 'get-batch-thumbnails') {
        return Promise.resolve({
          '/library/album/cover.jpg': 'thumbnail-protocol://cover.webp'
        });
      }
      return Promise.resolve(null);
    });

    renderAlbum();

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-album-images',
        '/library/album'
      );
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-batch-thumbnails',
        ['/library/album/cover.jpg'],
        0
      );
    });
    expect(await screen.findByAltText('album')).toHaveAttribute(
      'src',
      'thumbnail-protocol://cover.webp'
    );
  });

  test('keeps the placeholder and does not retry when the album has no images', async () => {
    ipcRenderer.invoke.mockResolvedValue([]);

    renderAlbum();

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-album-images',
        '/library/album'
      );
    });
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('album')).not.toBeInTheDocument();
  });

  test('rescans the current album after a stored preview path fails', async () => {
    ipcRenderer.invoke.mockImplementation((channel, value) => {
      if (channel === 'get-album-images') {
        return Promise.resolve([{ path: '/library/album/current.jpg' }]);
      }
      if (channel === 'get-batch-thumbnails' && value[0] === '/old/cover.jpg') {
        return Promise.resolve({ '/old/cover.jpg': null });
      }
      if (channel === 'get-batch-thumbnails') {
        return Promise.resolve({
          '/library/album/current.jpg': 'thumbnail-protocol://current.webp'
        });
      }
      return Promise.resolve(null);
    });

    renderAlbum({
      previewImages: [{ path: '/old/cover.jpg', name: 'cover.jpg' }]
    });
    fireEvent.error(await screen.findByAltText('album'));

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'get-album-images',
        '/library/album'
      );
    });
    expect(await screen.findByAltText('album')).toHaveAttribute(
      'src',
      'thumbnail-protocol://current.webp'
    );
  });
});
