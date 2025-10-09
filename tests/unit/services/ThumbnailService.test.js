/** @jest-environment node */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

jest.mock('electron', () => {
  const app = {
    getPath: jest.fn(),
    isReady: jest.fn(),
    whenReady: jest.fn(),
    on: jest.fn(),
    getFileIcon: jest.fn()
  };

  const nativeImage = {
    createFromPath: jest.fn(),
    createThumbnailFromPath: jest.fn()
  };

  return { app, nativeImage };
});

jest.mock('sharp');

const { createFsMock } = require('../../helpers/fsMock');

let electron;
let sharp;
let mockFsInstance;

const createNativeImageStub = ({ empty = false, width = 128, height = 128, bitmap = [0, 0, 0, 0], png = 'png' } = {}) => {
  const image = {
    isEmpty: jest.fn(() => empty),
    getSize: jest.fn(() => ({ width, height })),
    resize: jest.fn(() => image),
    toBitmap: jest.fn(() => Buffer.from(bitmap)),
    toPNG: jest.fn(() => Buffer.from(png))
  };
  return image;
};

const setupThumbnailService = (options = {}) => {
  jest.resetModules();

  if (mockFsInstance && typeof mockFsInstance.restore === 'function') {
    mockFsInstance.restore();
    mockFsInstance = null;
  }

  mockFsInstance = createFsMock(options.fsStructure || {});

  electron = require('electron');
  sharp = require('sharp');

  electron.app.getPath.mockReturnValue(options.userDataPath || '/mock/userData');
  electron.app.isReady.mockReturnValue(false);
  electron.app.on.mockImplementation(() => {});
  electron.app.whenReady.mockResolvedValue();
  electron.app.getFileIcon.mockResolvedValue(
    Object.prototype.hasOwnProperty.call(options, 'fileIcon')
      ? options.fileIcon
      : createNativeImageStub({ bitmap: [1, 1, 1, 1] })
  );
  electron.nativeImage.createFromPath.mockReturnValue(
    Object.prototype.hasOwnProperty.call(options, 'cacheImage')
      ? options.cacheImage
      : createNativeImageStub()
  );
  electron.nativeImage.createThumbnailFromPath.mockResolvedValue(
    Object.prototype.hasOwnProperty.call(options, 'systemThumb')
      ? options.systemThumb
      : createNativeImageStub({ bitmap: [2, 2, 2, 2] })
  );

  const sharpInstance = {
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toFile: jest.fn(options.sharpToFileImpl || (() => Promise.resolve()))
  };
  sharp.mockImplementation(() => sharpInstance);

  // eslint-disable-next-line global-require
  const serviceModule = require('../../../src/main/services/ThumbnailService');
  return {
    ...serviceModule,
    sharpInstance
  };
};

describe('ThumbnailService', () => {
  let consoleErrorSpy;
  let consoleWarnSpy;
  let consoleLogSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
      consoleErrorSpy = null;
    }
    if (consoleWarnSpy) {
      consoleWarnSpy.mockRestore();
      consoleWarnSpy = null;
    }
    if (consoleLogSpy) {
      consoleLogSpy.mockRestore();
      consoleLogSpy = null;
    }
    if (mockFsInstance && typeof mockFsInstance.restore === 'function') {
      mockFsInstance.restore();
      mockFsInstance = null;
    }
    jest.restoreAllMocks();
  });

  const buildCachePath = (service, imagePath, width, height, ext) => {
    const hash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
    return path.join(service.THUMBNAIL_CACHE_DIR, `${hash}.${ext}`);
  };

  test('returns cached webp when available', async () => {
    const imagePath = '/photos/cached.jpg';
    const width = 320;
    const height = 240;
    const webpHash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
    const webpFilename = `${webpHash}.webp`;

    const service = setupThumbnailService({
      fsStructure: {
        '/photos': {
          'cached.jpg': 'image-data'
        },
        '/mock': {
          userData: {
            'thumbnail-cache': {
              [webpFilename]: 'cached-thumb'
            }
          }
        }
      }
    });

    const webpPath = buildCachePath(service, imagePath, width, height, 'webp');

    const result = await service.thumbnailService.generateThumbnail(imagePath, width, height);

    expect(result).toBe(`file://${webpPath}`);
    expect(sharp).not.toHaveBeenCalled();
  });

  test('generates new thumbnail with sharp when cache missing', async () => {
    const imagePath = '/photos/new.jpg';
    const width = 300;
    const height = 300;

    const service = setupThumbnailService({
      fsStructure: {
        '/photos': {
          'new.jpg': 'new-image'
        },
        '/mock': {
          userData: {
            'thumbnail-cache': {}
          }
        }
      }
    });

    const webpPath = buildCachePath(service, imagePath, width, height, 'webp');

    const result = await service.thumbnailService.generateThumbnail(imagePath, width, height);

    expect(sharp).toHaveBeenCalledTimes(1);
    expect(sharp).toHaveBeenCalledWith(imagePath, { failOnError: false });
    expect(service.sharpInstance.resize).toHaveBeenCalledWith({
      width,
      height,
      fit: expect.anything(),
      withoutEnlargement: true
    });
    expect(service.sharpInstance.webp).toHaveBeenCalledWith({ quality: 80 });
    expect(service.sharpInstance.toFile).toHaveBeenCalledWith(webpPath);
    expect(result).toBe(`file://${webpPath}`);
  });

  test('falls back to native thumbnail when sharp fails', async () => {
    const systemThumb = createNativeImageStub({
      bitmap: [9, 9, 9, 9, 9, 9, 9, 9],
      png: 'native'
    });
    const fileIcon = createNativeImageStub({
      bitmap: [1, 1, 1, 1, 1, 1, 1, 1]
    });

    const service = setupThumbnailService({
      fsStructure: {
        '/photos': {
          'fallback.jpg': 'image'
        },
        '/mock': {
          userData: {
            'thumbnail-cache': {}
          }
        }
      },
      systemThumb,
      fileIcon,
      sharpToFileImpl: () => Promise.reject(new Error('sharp failed'))
    });

    const imagePath = '/photos/fallback.jpg';
    const width = 220;
    const height = 220;
    const pngPath = buildCachePath(service, imagePath, width, height, 'png');

    const result = await service.thumbnailService.generateThumbnail(imagePath, width, height);

    expect(service.sharpInstance.toFile).toHaveBeenCalled();
    expect(electron.nativeImage.createThumbnailFromPath).toHaveBeenCalledWith(imagePath, {
      width,
      height
    });
    expect(fs.existsSync(pngPath)).toBe(true);
    expect(result).toBe(`file://${pngPath}`);
  });

  test('returns null when both sharp and native thumbnail fail', async () => {
    const service = setupThumbnailService({
      fsStructure: {
        '/photos': {
          'unlucky.jpg': 'data'
        },
        '/mock': {
          userData: {
            'thumbnail-cache': {}
          }
        }
      },
      systemThumb: null,
      sharpToFileImpl: () => Promise.reject(new Error('sharp failure'))
    });

    electron.nativeImage.createThumbnailFromPath.mockResolvedValueOnce(null);

    const imagePath = '/photos/unlucky.jpg';

    const result = await service.thumbnailService.generateThumbnail(imagePath, 200, 200);

    expect(result).toBeNull();
  });

  test('deduplicates concurrent thumbnail requests', async () => {
    let resolveWait;
    const waitPromise = new Promise((resolve) => {
      resolveWait = resolve;
    });

    const service = setupThumbnailService();

    const processSpy = jest
      .spyOn(service.thumbnailService, 'processThumbnail')
      .mockImplementation(() => waitPromise.then(() => 'result'));

    const cacheFilenames = {
      webp: '/mock/userData/thumbnail-cache/mock.webp',
      png: '/mock/userData/thumbnail-cache/mock.png'
    };

    const firstCall = service.thumbnailService.enqueueTask(
      '/photos/concurrent.jpg',
      180,
      180,
      cacheFilenames
    );
    const secondCall = service.thumbnailService.enqueueTask(
      '/photos/concurrent.jpg',
      180,
      180,
      cacheFilenames
    );

    expect(processSpy).toHaveBeenCalledTimes(1);

    resolveWait();

    const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
    expect(firstResult).toBe('result');
    expect(secondResult).toBe('result');
  });
});
