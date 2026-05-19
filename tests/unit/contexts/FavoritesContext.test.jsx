import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { FavoritesProvider, useFavorites } from '../../../src/renderer/contexts/FavoritesContext';

const ipcRenderer = global.electronMock.ipcRenderer;

function FavoriteProbe() {
  const { isFolderFavorited, isAlbumFavorited } = useFavorites();

  return (
    <div>
      <div data-testid="folder-status">{String(isFolderFavorited('/photos'))}</div>
      <div data-testid="photo-set-status">{String(isAlbumFavorited('/photos'))}</div>
    </div>
  );
}

function RemoveImageFavoriteProbe() {
  const { isImageFavorited, removeImageFavorite } = useFavorites();

  return (
    <div>
      <div data-testid="image-status">{String(isImageFavorited('/photos/a.jpg'))}</div>
      <button type="button" onClick={() => removeImageFavorite('/photos/a.jpg')}>
        remove image
      </button>
    </div>
  );
}

describe('FavoritesContext item identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ipcRenderer.invoke.mockResolvedValue({
      folders: [
        {
          id: 'folder_1',
          kind: 'folder',
          path: '/photos',
          name: 'photos'
        }
      ],
      albums: [
        {
          id: 'album_1',
          kind: 'photoSet',
          path: '/photos',
          name: 'photos',
          imageCount: 2
        }
      ],
      images: [],
      collections: [],
      version: 1
    });
  });

  test('tracks folder and photo-set favorites separately even when paths match', async () => {
    render(
      <FavoritesProvider>
        <FavoriteProbe />
      </FavoritesProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('folder-status')).toHaveTextContent('true');
      expect(screen.getByTestId('photo-set-status')).toHaveTextContent('true');
    });
  });
});

describe('FavoritesContext image removal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ipcRenderer.invoke.mockImplementation((channel) => {
      if (channel === 'load-favorites') {
        return Promise.resolve({
          folders: [],
          albums: [],
          images: [
            {
              id: 'image_1',
              path: '/photos/a.jpg',
              name: 'a.jpg'
            },
            {
              id: 'image_2',
              path: '/photos/b.jpg',
              name: 'b.jpg'
            }
          ],
          collections: [],
          version: 1
        });
      }

      return Promise.resolve({ success: true });
    });
  });

  test('removeImageFavorite removes only the matching image favorite', async () => {
    render(
      <FavoritesProvider>
        <RemoveImageFavoriteProbe />
      </FavoritesProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('image-status')).toHaveTextContent('true');
    });

    await act(async () => {
      screen.getByRole('button', { name: 'remove image' }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-status')).toHaveTextContent('false');
    });

    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
      'save-favorites',
      expect.objectContaining({
        images: [
          expect.objectContaining({
            path: '/photos/b.jpg'
          })
        ]
      }),
      1
    );
  });
});
