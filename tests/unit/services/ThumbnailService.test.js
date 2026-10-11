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

    expect(result).toBe(`thumbnail-protocol://${path.basename(webpPath)}`);
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
    expect(result).toBe(`thumbnail-protocol://${path.basename(webpPath)}`);
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
    expect(result).toBe(`thumbnail-protocol://${path.basename(pngPath)}`);
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

  describe('队列调度与取消', () => {
    const flush = async (times = 4) => {
      for (let i = 0; i < times; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setImmediate(resolve));
      }
    };

    const queueFsStructure = {
      '/photos': {},
      '/mock': { userData: { 'thumbnail-cache': {} } }
    };

    /** 用可控 Promise 替换真正的解码，从而观察队列派发顺序 */
    const controlProcessing = (service) => {
      const control = { started: [], pending: [] };
      jest
        .spyOn(service.thumbnailService, 'processThumbnail')
        .mockImplementation((imagePath) => {
          control.started.push(imagePath);
          return new Promise((resolve, reject) => {
            control.pending.push({ resolve, reject });
          });
        });
      return control;
    };

    test('可见任务插队到未开始的屏外前瞻任务之前', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(1);

      const blocker = service.thumbnailService.generateThumbnail('/photos/blocker.jpg', 600, 900, 1);
      await flush();
      expect(control.started).toEqual(['/photos/blocker.jpg']);

      const prefetchA = service.thumbnailService.generateThumbnail('/photos/prefetch-a.jpg', 600, 900, 1);
      const prefetchB = service.thumbnailService.generateThumbnail('/photos/prefetch-b.jpg', 600, 900, 1);
      const visible = service.thumbnailService.generateThumbnail('/photos/visible.jpg', 600, 900, 0);

      const queued = service.thumbnailService.getRuntimeStats();
      expect(queued.queuedPrefetch).toBe(2);
      expect(queued.queuedVisible).toBe(1);

      control.pending.shift().resolve('blocker');
      await flush();
      expect(control.started).toEqual(['/photos/blocker.jpg', '/photos/visible.jpg']);

      control.pending.shift().resolve('visible');
      await flush();
      expect(control.started).toEqual([
        '/photos/blocker.jpg',
        '/photos/visible.jpg',
        '/photos/prefetch-a.jpg'
      ]);

      control.pending.shift().resolve('prefetch-a');
      await flush();
      expect(control.started).toEqual([
        '/photos/blocker.jpg',
        '/photos/visible.jpg',
        '/photos/prefetch-a.jpg',
        '/photos/prefetch-b.jpg'
      ]);

      control.pending.shift().resolve('prefetch-b');
      await expect(Promise.all([blocker, prefetchA, prefetchB, visible])).resolves.toEqual([
        'blocker',
        'prefetch-a',
        'prefetch-b',
        'visible'
      ]);
    });

    test('取消排队中的任务：立刻返回 null 且不再开始解码', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(1);

      const blocker = service.thumbnailService.generateThumbnail('/photos/blocker.jpg', 600, 900, 0);
      await flush();

      const queued = service.thumbnailService.generateThumbnail('/photos/queued.jpg', 600, 900, 0);
      await flush();
      expect(control.started).toEqual(['/photos/blocker.jpg']);

      const result = service.thumbnailService.cancelPending(['/photos/queued.jpg']);
      expect(result).toMatchObject({ requested: 1, cancelled: 1, inFlight: 0 });
      await expect(queued).resolves.toBeNull();

      control.pending.shift().resolve('blocker');
      await flush();
      await expect(blocker).resolves.toBe('blocker');
      expect(control.started).toEqual(['/photos/blocker.jpg']);
      expect(service.thumbnailService.getRuntimeStats().cancelled).toBe(1);
    });

    test('已在解码的任务不被取消打断，仍返回结果', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(1);

      const running = service.thumbnailService.generateThumbnail('/photos/running.jpg', 600, 900, 0);
      await flush();
      expect(control.started).toEqual(['/photos/running.jpg']);

      const result = service.thumbnailService.cancelPending(['/photos/running.jpg']);
      expect(result).toMatchObject({ requested: 1, cancelled: 0, inFlight: 1 });

      control.pending.shift().resolve('running-result');
      await expect(running).resolves.toBe('running-result');
    });

    test('取消后同一路径可以重新入队并真正开始', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(1);

      const blocker = service.thumbnailService.generateThumbnail('/photos/blocker.jpg', 600, 900, 0);
      await flush();

      const queued = service.thumbnailService.generateThumbnail('/photos/again.jpg', 600, 900, 0);
      service.thumbnailService.cancelPending(['/photos/again.jpg']);
      await expect(queued).resolves.toBeNull();

      const retried = service.thumbnailService.generateThumbnail('/photos/again.jpg', 600, 900, 0);
      control.pending.shift().resolve('blocker');
      await flush();

      expect(control.started).toEqual(['/photos/blocker.jpg', '/photos/again.jpg']);
      control.pending.shift().resolve('retry-result');
      await expect(retried).resolves.toBe('retry-result');
      await expect(blocker).resolves.toBe('blocker');
    });

    test('取消未知路径或空输入都是安全的空操作', () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });

      expect(service.thumbnailService.cancelPending(['/photos/never.jpg'])).toMatchObject({
        requested: 1,
        cancelled: 0,
        inFlight: 0
      });
      expect(service.thumbnailService.cancelPending([])).toMatchObject({ requested: 0, cancelled: 0 });
      expect(service.thumbnailService.cancelPending(null)).toMatchObject({ requested: 0, cancelled: 0 });
    });

    test('解码失败不泄漏并发位，后续任务能立即补位', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(1);

      const failing = service.thumbnailService.generateThumbnail('/photos/broken.jpg', 600, 900, 0);
      await flush();
      control.pending.shift().reject(new Error('decode failed'));
      await expect(failing).resolves.toBeNull();
      expect(service.thumbnailService.getRuntimeStats().activeWorkers).toBe(0);

      const next = service.thumbnailService.generateThumbnail('/photos/next.jpg', 600, 900, 0);
      await flush();
      expect(control.started).toEqual(['/photos/broken.jpg', '/photos/next.jpg']);

      control.pending.shift().resolve('next-result');
      await expect(next).resolves.toBe('next-result');
    });

    test('全部任务结束后无残留排队与在途记录', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(2);

      const tasks = [
        service.thumbnailService.generateThumbnail('/photos/one.jpg', 600, 900, 0),
        service.thumbnailService.generateThumbnail('/photos/two.jpg', 600, 900, 0),
        service.thumbnailService.generateThumbnail('/photos/three.jpg', 600, 900, 1)
      ];

      await flush();
      while (control.pending.length > 0) {
        control.pending.shift().resolve('done');
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
      await Promise.all(tasks);

      const stats = service.thumbnailService.getRuntimeStats();
      expect(stats.activeWorkers).toBe(0);
      expect(stats.pendingTasks).toBe(0);
      expect(stats.queuedVisible).toBe(0);
      expect(stats.queuedPrefetch).toBe(0);
    });

    test('运行时统计暴露两档队列长度与等待分位，且不泄漏样本数组', async () => {
      const service = setupThumbnailService({ fsStructure: queueFsStructure });
      const control = controlProcessing(service);
      service.thumbnailService.setMaxWorkers(1);

      const blocker = service.thumbnailService.generateThumbnail('/photos/blocker.jpg', 600, 900, 0);
      await flush();
      const queued = service.thumbnailService.generateThumbnail('/photos/queued.jpg', 600, 900, 1);
      await flush();

      expect(service.thumbnailService.getRuntimeStats()).toMatchObject({
        maxWorkers: 1,
        activeWorkers: 1,
        queuedVisible: 0,
        queuedPrefetch: 1
      });
      // blocker 已开始，记下它那一条（接近 0ms）样本作为基线
      const samplesBefore = service.thumbnailService.getRuntimeStats().queueWaitSamples;

      control.pending.shift().resolve('blocker');
      await flush();
      control.pending.shift().resolve('queued');
      await Promise.all([blocker, queued]);

      const after = service.thumbnailService.getRuntimeStats();
      expect(after.queueWaitSamples).toBeGreaterThan(samplesBefore);
      expect(after.queueWaitP50Ms).toBeGreaterThanOrEqual(0);
      expect(after.queueWaitP90Ms).toBeGreaterThanOrEqual(after.queueWaitP50Ms);
      expect(after.queueWaits).toBeUndefined();
    });
  });
});
