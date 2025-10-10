/** @jest-environment node */

const path = require('path');
const { createFsMock } = require('../../helpers/fsMock');

const CHANNELS = require('../../../src/common/ipc-channels');

jest.mock('electron', () => {
  const { createElectronMocks } = require('../../helpers/electronMock');
  return createElectronMocks();
}, { virtual: true });

describe('FavoritesService', () => {
  let electron;
  let mockFs;
  let FavoritesService;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.resetModules();
    electron = require('electron');
    electron.__resetWindows();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFs = createFsMock({
      '/mock': {
        userData: {}
      }
    });
    FavoritesService = require('../../../src/main/services/FavoritesService');
  });

  afterEach(() => {
    if (mockFs && typeof mockFs.restore === 'function') {
      mockFs.restore();
      mockFs = null;
    }
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
      consoleErrorSpy = null;
    }
    jest.restoreAllMocks();
  });

  test('loadFavoritesInternal creates default file when missing', async () => {
    FavoritesService.registerIpcHandlers();

    const data = await electron.ipcMain.invoke(CHANNELS.LOAD_FAVORITES);

    expect(data).toMatchObject({
      albums: [],
      images: [],
      collections: [],
      version: 1
    });

    const favoritesPath = path.join('/mock/userData', 'favorites.json');
    expect(() => require('fs').readFileSync(favoritesPath, 'utf8')).not.toThrow();
  });

  test('saving favorites bumps version and broadcasts updates', async () => {
    const fs = require('fs');
    const favoritesPath = path.join('/mock/userData', 'favorites.json');
    const initialData = {
      albums: ['a'],
      images: [],
      collections: [],
      version: 2,
      lastModified: Date.now()
    };

    fs.writeFileSync(favoritesPath, JSON.stringify(initialData, null, 2));

    const windowStub = electron.BrowserWindow();
    windowStub.webContents.isDestroyed.mockReturnValue(false);

    FavoritesService.registerIpcHandlers();

    const payload = {
      albums: ['b'],
      images: [],
      collections: []
    };

    const result = await electron.ipcMain.invoke(
      CHANNELS.SAVE_FAVORITES,
      payload,
      initialData.version
    );

    expect(result.success).toBe(true);
    expect(result.version).toBe(initialData.version + 1);

    const stored = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
    expect(stored.version).toBe(initialData.version + 1);
    expect(stored.albums).toEqual(['b']);

    expect(windowStub.webContents.send).toHaveBeenCalledWith(
      CHANNELS.FAVORITES_UPDATED,
      expect.objectContaining({ version: initialData.version + 1 })
    );
  });

  test('saving favorites rejects on version conflict', async () => {
    const fs = require('fs');
    const favoritesPath = path.join('/mock/userData', 'favorites.json');
    const storedData = {
      albums: [],
      images: [],
      collections: [],
      version: 10,
      lastModified: Date.now()
    };
    fs.writeFileSync(favoritesPath, JSON.stringify(storedData, null, 2));

    FavoritesService.registerIpcHandlers();

    const result = await electron.ipcMain.invoke(
      CHANNELS.SAVE_FAVORITES,
      { albums: ['x'], images: [], collections: [] },
      storedData.version - 1
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('版本冲突');
    expect(result.currentVersion).toBe(storedData.version);
  });

  test('saving favorites handles serialization errors gracefully', async () => {
    FavoritesService.registerIpcHandlers();

    const payload = { albums: [], images: [], collections: [] };
    payload.self = payload;

    const result = await electron.ipcMain.invoke(
      CHANNELS.SAVE_FAVORITES,
      payload,
      undefined
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('circular');
  });

  test('favorites watcher broadcasts updates on file change', async () => {
    const fs = require('fs');
    const favoritesPath = path.join('/mock/userData', 'favorites.json');

    fs.writeFileSync(
      favoritesPath,
      JSON.stringify({
        albums: [],
        images: [],
        collections: [],
        version: 1,
        lastModified: Date.now()
      })
    );

    const windowStub = electron.BrowserWindow();
    windowStub.webContents.isDestroyed.mockReturnValue(false);

    let watchHandler;
    const watcherClose = jest.fn();
    jest
      .spyOn(fs, 'watch')
      .mockImplementation((pathArg, handler) => {
        watchHandler = handler;
        return { close: watcherClose };
      });

    FavoritesService.registerIpcHandlers();
    FavoritesService.startFavoritesWatcher();

    expect(electron.BrowserWindow.getAllWindows()).toHaveLength(1);

    fs.writeFileSync(
      favoritesPath,
      JSON.stringify({
        albums: ['fresh'],
        images: [],
        collections: [],
        version: 2,
        lastModified: Date.now()
      })
    );

    expect(typeof watchHandler).toBe('function');
    watchHandler('change');
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(windowStub.webContents.send).toHaveBeenCalledWith(
      CHANNELS.FAVORITES_UPDATED,
      expect.objectContaining({ albums: ['fresh'] })
    );

    FavoritesService.stopFavoritesWatcher();
    expect(watcherClose).toHaveBeenCalled();
  });
});
