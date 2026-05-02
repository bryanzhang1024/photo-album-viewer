import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
