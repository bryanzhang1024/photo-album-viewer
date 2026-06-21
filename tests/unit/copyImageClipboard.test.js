/** @jest-environment node */

const fs = require('fs');
const CHANNELS = require('../../src/common/ipc-channels');
const { createElectronMocks } = require('../helpers/electronMock');

const originalPlatform = process.platform;

const setPlatform = (platform) => {
  Object.defineProperty(process, 'platform', {
    value: platform
  });
};

const createImageStub = () => ({
  isEmpty: jest.fn(() => false),
  toPNG: jest.fn(() => Buffer.from('png-data'))
});

const setupMainProcess = () => {
  jest.resetModules();

  const electron = createElectronMocks();
  electron.app.requestSingleInstanceLock = jest.fn(() => true);
  electron.app.whenReady = jest.fn(() => new Promise(() => {}));
  electron.dialog = {
    showOpenDialog: jest.fn()
  };
  electron.shell = {
    showItemInFolder: jest.fn()
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
    readImage: jest.fn(() => createImageStub())
  };
  electron.nativeImage.createFromPath.mockReturnValue(createImageStub());
  electron.nativeImage.createFromBuffer = jest.fn(() => createImageStub());

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
    getAlbumImages: jest.fn()
  }));

  jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);

  // eslint-disable-next-line global-require
  require('../../src/main/main');
  return electron;
};

describe('copy image to clipboard', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    });
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('writes macOS file copy data as plist and avoids generic URL formats in file mode', async () => {
    setPlatform('darwin');
    const electron = setupMainProcess();
    const filePath = '/Volumes/1TB/Collection/600-Cos Weibo/XHS@20260405/[🌸梅梅面包机]海岸线的场照生了[9](20260412).jpeg';

    const result = await electron.ipcMain.invoke(CHANNELS.COPY_IMAGE_TO_CLIPBOARD, filePath, 'file');

    expect(result.success).toBe(true);
    expect(electron.clipboard.clear).toHaveBeenCalledTimes(1);
    expect(electron.clipboard.writeBookmark).not.toHaveBeenCalled();
    expect(electron.clipboard.writeBuffer).toHaveBeenCalledTimes(1);

    const writes = new Map(
      electron.clipboard.writeBuffer.mock.calls.map(([format, buffer]) => [format, buffer.toString('utf8')])
    );

    expect(writes.get('NSFilenamesPboardType')).toContain('<plist version="1.0">');
    expect(writes.get('NSFilenamesPboardType')).toContain(`<string>${filePath}</string>`);
    expect(writes.has('Apple URL pasteboard type')).toBe(false);
    expect(writes.has('public.file-url')).toBe(false);
    expect(writes.has('public.url')).toBe(false);
    expect(writes.has('text/uri-list')).toBe(false);
  });
});
