/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');
const { setupMainProcess } = require('../helpers/mainProcessHarness');

describe('legacy album image IPC contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns an array without options and a page object with options', async () => {
    const legacyImages = [{ path: '/albums/trip/1.jpg', name: '1.jpg' }];
    const page = {
      success: true,
      albumPath: '/albums/trip',
      images: legacyImages,
      totalCount: 1,
      offset: 0,
      limit: 200,
      hasMore: false,
      globalIndex: null
    };
    const getAlbumImages = jest.fn().mockResolvedValue(legacyImages);
    const getAlbumImagesPage = jest.fn().mockResolvedValue(page);
    const { electron } = setupMainProcess({
      fileSystemService: { getAlbumImages, getAlbumImagesPage }
    });

    const legacyResult = await electron.ipcMain.invoke(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/trip'
    );
    const pagedResult = await electron.ipcMain.invoke(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/trip',
      { offset: 0, limit: 200 }
    );

    expect(legacyResult).toBe(legacyImages);
    expect(Array.isArray(legacyResult)).toBe(true);
    expect(pagedResult).toBe(page);
    expect(Array.isArray(pagedResult)).toBe(false);
    expect(getAlbumImages).toHaveBeenCalledWith('/albums/trip');
    expect(getAlbumImagesPage).toHaveBeenCalledWith(
      '/albums/trip',
      { offset: 0, limit: 200 }
    );
  });
});
