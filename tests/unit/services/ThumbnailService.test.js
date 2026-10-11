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

/**
 * 带真实文件头的假图片。
 *
 * trySystemThumbnail 现在会先读文件头确认是图片容器（扩展名不可信），
 * 所以需要走原生回退的用例必须提供真实的 magic bytes，否则会被闸门挡掉。
 */
const JPEG_HEADER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]),
  Buffer.alloc(16)
]);

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
    // quality 决定量化表与观感，保持 80；effort 只影响编码搜索强度（实测 −12% 端到端）
    expect(service.sharpInstance.webp).toHaveBeenCalledWith({ quality: 80, effort: 2 });
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
          'fallback.jpg': JPEG_HEADER
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
          'unlucky.jpg': JPEG_HEADER
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

  describe('超时与并发位保护', () => {
    const timeoutFsStructure = {
      '/photos': {
        'native-hang.jpg': JPEG_HEADER,
        'icon-hang.jpg': JPEG_HEADER
      },
      '/mock': { userData: { 'thumbnail-cache': {} } }
    };

    test('任务永不 settle 时超时释放并发位，后续任务仍能完成', async () => {
      const service = setupThumbnailService({ fsStructure: timeoutFsStructure });
      const svc = service.thumbnailService;
      svc.setMaxWorkers(1);
      svc.TASK_TIMEOUT_MS = 60;

      const neverSettles = new Promise(() => {});
      const processSpy = jest
        .spyOn(svc, 'processThumbnail')
        .mockImplementation((imagePath) =>
          imagePath === '/photos/hang.jpg' ? neverSettles : Promise.resolve('recovered')
        );

      const startedAt = Date.now();
      const hung = await svc.generateThumbnail('/photos/hang.jpg', 600, 900, 0);
      const elapsed = Date.now() - startedAt;

      expect(hung).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(50);

      const stats = svc.getRuntimeStats();
      expect(stats.timeouts).toBe(1);
      expect(stats.activeWorkers).toBe(0);
      expect(stats.pendingTasks).toBe(0);

      // 并发位确实被释放：后续任务可以立刻开始并完成
      await expect(svc.generateThumbnail('/photos/after.jpg', 600, 900, 0)).resolves.toBe('recovered');
      expect(processSpy).toHaveBeenCalledTimes(2);
    });

    test('原生缩略图调用挂起时按超时放弃，不拖住队列', async () => {
      const service = setupThumbnailService({
        fsStructure: timeoutFsStructure,
        sharpToFileImpl: () => Promise.reject(new Error('sharp failed'))
      });
      const svc = service.thumbnailService;
      svc.setMaxWorkers(1);
      svc.NATIVE_CALL_TIMEOUT_MS = 60;

      electron.nativeImage.createThumbnailFromPath.mockImplementation(() => new Promise(() => {}));

      const startedAt = Date.now();
      const result = await svc.generateThumbnail('/photos/native-hang.jpg', 600, 900, 0);
      const elapsed = Date.now() - startedAt;

      expect(result).toBeNull();
      expect(elapsed).toBeLessThan(2000);

      const stats = svc.getRuntimeStats();
      expect(stats.nativeTimeouts).toBeGreaterThanOrEqual(1);
      expect(stats.activeWorkers).toBe(0);
      expect(stats.pendingTasks).toBe(0);
    });

    test('文件图标判定挂起时按超时返回，不阻塞任务', async () => {
      const systemThumb = createNativeImageStub({ bitmap: [7, 7, 7, 7], png: 'native' });
      const service = setupThumbnailService({
        fsStructure: timeoutFsStructure,
        sharpToFileImpl: () => Promise.reject(new Error('sharp failed')),
        systemThumb
      });
      const svc = service.thumbnailService;
      svc.setMaxWorkers(1);
      svc.NATIVE_CALL_TIMEOUT_MS = 60;

      electron.app.getFileIcon.mockImplementation(() => new Promise(() => {}));

      const startedAt = Date.now();
      const result = await svc.generateThumbnail('/photos/icon-hang.jpg', 600, 900, 0);
      const elapsed = Date.now() - startedAt;

      expect(elapsed).toBeLessThan(2000);

      const stats = svc.getRuntimeStats();
      expect(stats.nativeTimeouts).toBeGreaterThanOrEqual(1);
      expect(stats.activeWorkers).toBe(0);
      expect(stats.pendingTasks).toBe(0);
      // 图标判定超时后返回「不是图标」，沿用既有语义（第 4 步会重写该判定）
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('文件头闸门（防止把文件图标当缩略图缓存）', () => {
    const RIFF = Buffer.from('RIFF', 'ascii');
    const FOUR_ZERO = Buffer.from([0, 0, 0, 0]);

    test.each([
      ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
      ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      ['GIF', Buffer.from('GIF89a', 'ascii')],
      ['BMP', Buffer.from('BM', 'ascii')],
      ['WebP', Buffer.concat([RIFF, FOUR_ZERO, Buffer.from('WEBP', 'ascii')])],
      ['TIFF-LE', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
      ['TIFF-BE', Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
      ['HEIC', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'ascii')])],
      ['AVIF', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypavif', 'ascii')])]
    ])('接受 %s 文件头', (_name, header) => {
      const service = setupThumbnailService();
      expect(service.looksLikeImageHeader(header)).toBe(true);
    });

    test.each([
      ['纯文本', Buffer.from('这不是图片，只是文本', 'utf8')],
      ['空 buffer', Buffer.alloc(0)],
      ['过短的头', Buffer.from([0xff, 0xd8])],
      ['RIFF 但是 WAVE 音频', Buffer.concat([RIFF, FOUR_ZERO, Buffer.from('WAVE', 'ascii')])],
      ['ISO-BMFF 但是 mp4 视频', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42', 'ascii')])]
    ])('拒绝 %s', (_name, header) => {
      const service = setupThumbnailService();
      expect(service.looksLikeImageHeader(header)).toBe(false);
    });

    test('isDecodableImageSource 按真实文件头判定', async () => {
      const service = setupThumbnailService({
        fsStructure: {
          '/photos': {
            'real.jpg': JPEG_HEADER,
            'fake.jpg': '这不是图片，只是纯文本内容。'
          },
          '/mock': { userData: { 'thumbnail-cache': {} } }
        }
      });

      await expect(service.thumbnailService.isDecodableImageSource('/photos/real.jpg')).resolves.toBe(true);
      await expect(service.thumbnailService.isDecodableImageSource('/photos/fake.jpg')).resolves.toBe(false);
      await expect(service.thumbnailService.isDecodableImageSource('/photos/missing.jpg')).resolves.toBe(false);
    });

    test('源文件不是图片时不走原生回退，也不写缓存', async () => {
      const service = setupThumbnailService({
        fsStructure: {
          '/photos': {
            'renamed.jpg': '这不是图片，只是被改名的纯文本。'
          },
          '/mock': { userData: { 'thumbnail-cache': {} } }
        },
        sharpToFileImpl: () => Promise.reject(new Error('sharp failed'))
      });
      electron.nativeImage.createThumbnailFromPath.mockResolvedValue(
        createNativeImageStub({ png: 'native' })
      );

      const imagePath = '/photos/renamed.jpg';
      const result = await service.thumbnailService.generateThumbnail(imagePath, 600, 900, 0);

      expect(result).toBeNull();
      // 关键：连原生调用都不该发生，通用图标才没有机会被写进缓存
      expect(electron.nativeImage.createThumbnailFromPath).not.toHaveBeenCalled();
      expect(service.thumbnailService.getRuntimeStats().nonImageFallbacksSkipped).toBe(1);

      const pngPath = buildCachePath(service, imagePath, 600, 900, 'png');
      expect(fs.existsSync(pngPath)).toBe(false);
    });

    test('文件头合法时仍走原生回退', async () => {
      // 位图要足够大：太小的 buffer 会让既有 20% 阈值把两者判成「同一个图标」
      const systemThumb = createNativeImageStub({ bitmap: [9, 9, 9, 9, 9, 9, 9, 9], png: 'native' });
      const service = setupThumbnailService({
        fsStructure: {
          '/photos': {
            'real.jpg': JPEG_HEADER
          },
          '/mock': { userData: { 'thumbnail-cache': {} } }
        },
        sharpToFileImpl: () => Promise.reject(new Error('sharp failed')),
        systemThumb
      });

      const imagePath = '/photos/real.jpg';
      const result = await service.thumbnailService.generateThumbnail(imagePath, 600, 900, 0);

      expect(electron.nativeImage.createThumbnailFromPath).toHaveBeenCalledWith(imagePath, {
        width: 600,
        height: 900
      });
      expect(result).toBe(
        `thumbnail-protocol://${path.basename(buildCachePath(service, imagePath, 600, 900, 'png'))}`
      );
      expect(service.thumbnailService.getRuntimeStats().nonImageFallbacksSkipped).toBe(0);
    });
  });
});
