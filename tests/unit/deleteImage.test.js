/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const CHANNELS = require('../../src/common/ipc-channels');
const { createElectronMocks } = require('../helpers/electronMock');

const setupMainProcess = () => {
  jest.resetModules();

  const electron = createElectronMocks();
  electron.app.requestSingleInstanceLock = jest.fn(() => true);
  electron.app.whenReady = jest.fn(() => new Promise(() => {}));
  electron.dialog = {
    showOpenDialog: jest.fn()
  };
  electron.shell = {
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(() => Promise.resolve())
  };
  electron.session = {
    defaultSession: {
      protocol: {
        registerFileProtocol: jest.fn()
      }
    }
  };
  electron.clipboard = {
    clear: jest.fn(),
    writeBuffer: jest.fn(),
    writeBookmark: jest.fn(),
    writeText: jest.fn(),
    writeImage: jest.fn(),
    availableFormats: jest.fn(() => []),
    readImage: jest.fn()
  };

  jest.doMock('electron', () => electron);
  jest.doMock('electron-is-dev', () => false);
  jest.doMock('../../src/main/services/WindowService', () => ({
    createWindow: jest.fn(),
    getMainWindow: jest.fn(() => null),
    windows: new Set()
  }));
  jest.doMock('../../src/main/services/ThumbnailService', () => ({
    THUMBNAIL_CACHE_DIR: '/tmp/photo-album-viewer-thumbnails',
    setMaxWorkers: jest.fn(),
    ensureCacheDir: jest.fn(() => Promise.resolve()),
    generateThumbnail: jest.fn(),
    thumbnailService: {
      getCacheStats: jest.fn(() => Promise.resolve({})),
      getRuntimeStats: jest.fn(() => ({}))
    }
  }));
  jest.doMock('../../src/main/services/FavoritesService', () => ({
    registerIpcHandlers: jest.fn(),
    startFavoritesWatcher: jest.fn(() => Promise.resolve()),
    stopFavoritesWatcher: jest.fn()
  }));
  jest.doMock('../../src/main/services/FileSystemService', () => ({
    createErrorResponse: jest.fn((message, targetPath) => ({ success: false, error: { message }, currentPath: targetPath })),
    scanNavigationLevel: jest.fn(),
    scanDirectories: jest.fn(),
    getAlbumImages: jest.fn(),
    SUPPORTED_FORMATS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']
  }));

  jest.spyOn(fs.promises, 'stat').mockResolvedValue({
    isFile: () => true
  });

  // eslint-disable-next-line global-require
  require('../../src/main/main');
  return electron;
};

describe('trash image IPC', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('moves an existing supported image file to the system trash', async () => {
    const electron = setupMainProcess();
    const filePath = '/photos/trip/IMG_0001.jpg';

    const result = await electron.ipcMain.invoke(CHANNELS.TRASH_IMAGE, filePath);

    expect(result).toEqual({ success: true, filePath: path.resolve(filePath) });
    expect(fs.promises.stat).toHaveBeenCalledWith(path.resolve(filePath));
    expect(electron.shell.trashItem).toHaveBeenCalledWith(path.resolve(filePath));
  });

  test('rejects a non-image file before moving it to trash', async () => {
    const electron = setupMainProcess();

    const result = await electron.ipcMain.invoke(CHANNELS.TRASH_IMAGE, '/photos/trip/notes.txt');

    expect(result.success).toBe(false);
    expect(result.error).toBe('不支持删除此文件类型');
    expect(electron.shell.trashItem).not.toHaveBeenCalled();
  });

  test('rejects directories before moving them to trash', async () => {
    const electron = setupMainProcess();
    fs.promises.stat.mockResolvedValueOnce({
      isFile: () => false
    });

    const result = await electron.ipcMain.invoke(CHANNELS.TRASH_IMAGE, '/photos/trip');

    expect(result.success).toBe(false);
    expect(result.error).toBe('目标不是图片文件');
    expect(electron.shell.trashItem).not.toHaveBeenCalled();
  });

  test('returns an error when trashItem fails', async () => {
    const electron = setupMainProcess();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    electron.shell.trashItem.mockRejectedValueOnce(new Error('trash unavailable'));

    const result = await electron.ipcMain.invoke(CHANNELS.TRASH_IMAGE, '/photos/trip/IMG_0001.jpg');

    expect(result.success).toBe(false);
    expect(result.error).toBe('trash unavailable');
    consoleErrorSpy.mockRestore();
  });
});
