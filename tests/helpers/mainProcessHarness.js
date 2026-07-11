const { createElectronMocks } = require('./electronMock');

const createImageStub = () => ({
  isEmpty: jest.fn(() => false),
  toPNG: jest.fn(() => Buffer.from('png-data'))
});

const setupMainProcess = ({ fileSystemService = {}, configureElectron } = {}) => {
  jest.resetModules();

  const electron = createElectronMocks();
  electron.app.requestSingleInstanceLock = jest.fn(() => true);
  electron.app.whenReady = jest.fn(() => new Promise(() => {}));
  electron.dialog = { showOpenDialog: jest.fn() };
  electron.shell = {
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(() => Promise.resolve())
  };
  electron.session = {
    defaultSession: {
      protocol: { registerFileProtocol: jest.fn() }
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
  configureElectron?.(electron);

  const resolvedFileSystemService = {
    createErrorResponse: jest.fn((message, targetPath) => ({
      success: false,
      error: { message },
      currentPath: targetPath
    })),
    scanNavigationLevel: jest.fn(),
    scanDirectoryTree: jest.fn(),
    getAlbumImages: jest.fn(),
    getAlbumImagesPage: jest.fn(),
    getAlbumImageCount: jest.fn(),
    clearAlbumImageMetadataCache: jest.fn(),
    DEFAULT_ALBUM_PAGE_SIZE: 200,
    SUPPORTED_FORMATS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
    ...fileSystemService
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
  jest.doMock('../../src/main/services/FileSystemService', () => resolvedFileSystemService);

  require('../../src/main/main');
  return { electron, fileSystemService: resolvedFileSystemService };
};

module.exports = {
  createImageStub,
  setupMainProcess
};
