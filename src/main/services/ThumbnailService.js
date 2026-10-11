const { app, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const sharp = require('sharp');
const crypto = require('crypto');

const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);

const THUMBNAIL_CACHE_DIR = path.join(app.getPath('userData'), 'thumbnail-cache');

// 队列优先级：可见图块先于屏外前瞻，避免前瞻挤占用户正在看的内容
const PRIORITY_VISIBLE = 0;
const PRIORITY_PREFETCH = 1;
const PRIORITY_LEVEL_COUNT = 2;

// 队列等待时间只作观测用途，保留最近若干个样本
const QUEUE_WAIT_SAMPLE_SIZE = 200;

// 单个任务的硬上限。超过就认定底层调用卡死，强制释放并发位。
// 实测 Electron 的原生缩略图 API 可以永久不返回（曾整进程 22 分钟 0% CPU）。
const DEFAULT_TASK_TIMEOUT_MS = 30000;

// 原生缩略图与文件图标 API 的单次调用上限。这两条路实测可能耗时数秒，
// 超时后立刻放弃并回退，不让降级路径拖住整个队列。
const DEFAULT_NATIVE_CALL_TIMEOUT_MS = 3000;

// WebP 编码参数。
//
// effort 是编码耗时的主控项：实测 600x900 下 effort 4（sharp 默认）编码 p50 51ms，
// effort 2 为 22ms（-57%），而同一 quality 下输出只大 3%（71KB → 73KB）。
// quality 决定量化表、直接影响观感，保持 80 不变。
const DEFAULT_WEBP_OPTIONS = { quality: 80, effort: 2 };

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * 给可能永不 settle 的 Promise 加超时，超时以 null 结束竞争。
 *
 * 原始任务不会被中断（libvips 与原生 API 都无法中断），它会继续在后台跑完，
 * 但结果被丢弃。Promise.race 已为原始 Promise 挂上处理函数，因此它之后
 * 失败也不会产生 unhandled rejection。
 */
function withTimeout(promise, timeoutMs, onTimeout) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (typeof onTimeout === 'function') {
        onTimeout();
      }
      resolve(null);
    }, timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

/**
 * ThumbnailService - 缩略图生成服务
 *
 * Linus式设计:
 * - 初始化时检查目录，避免重复检查
 * - 并发控制，最多 MAX_WORKERS 个解码任务，由调度器统一派发
 * - 双档优先级队列：可见图块优先于屏外前瞻
 * - 支持取消尚未开始的排队任务
 * - 请求去重，相同请求合并
 * - 自动清理，7天TTL + 2GB限制
 */
class ThumbnailService {
  constructor() {
    this.cacheDir = THUMBNAIL_CACHE_DIR;
    this.cacheDirReady = false;
    this.pendingTasks = new Map(); // key -> task，用于请求去重
    this.pendingByPath = new Map(); // imagePath -> Set<key>，用于按路径取消
    this.priorityQueues = Array.from({ length: PRIORITY_LEVEL_COUNT }, () => []);
    this.activeWorkers = 0;
    this.MAX_WORKERS = 3; // 最大并发解码任务
    this.TASK_TIMEOUT_MS = DEFAULT_TASK_TIMEOUT_MS;
    this.NATIVE_CALL_TIMEOUT_MS = DEFAULT_NATIVE_CALL_TIMEOUT_MS;
    this.WEBP_OPTIONS = { ...DEFAULT_WEBP_OPTIONS };
    this.MAX_CACHE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
    this.CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7天
    this.metrics = {
      requestCount: 0,
      cacheHits: {
        total: 0,
        webp: 0,
        png: 0
      },
      cacheMisses: 0,
      dedupHits: 0,
      generatedWithSharp: 0,
      generatedWithSystem: 0,
      generationFailures: 0,
      cancelled: 0,
      timeouts: 0,
      nativeTimeouts: 0,
      queueWaits: []
    };
  }

  /**
   * 动态调整并发worker数量
   */
  setMaxWorkers(count) {
    const numeric = Number(count);
    if (!Number.isFinite(numeric)) {
      return;
    }

    const safeValue = Math.max(1, Math.min(8, Math.floor(numeric)));
    if (safeValue === this.MAX_WORKERS) {
      return;
    }

    this.MAX_WORKERS = safeValue;
    console.log(`[ThumbnailService] 更新并发度: ${this.MAX_WORKERS}`);
    this.pump();
  }

  /**
   * 初始化缓存目录 - 只执行一次
   */
  async ensureCacheDir() {
    if (this.cacheDirReady) return;

    try {
      await mkdir(this.cacheDir, { recursive: true });
      this.cacheDirReady = true;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        console.error('创建缩略图缓存目录失败:', err);
        throw err;
      }
      this.cacheDirReady = true;
    }
  }

  /**
   * 生成缓存文件名
   */
  generateCacheFilename(imagePath, width, height, format = 'webp') {
    const hash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
    return path.join(this.cacheDir, `${hash}.${format}`);
  }

  toProtocolUrl(cacheFilename) {
    return `thumbnail-protocol://${path.basename(cacheFilename)}`;
  }

  /**
   * 生成缩略图 - 带并发控制、优先级和请求去重
   *
   * @param {string} imagePath 原图绝对路径
   * @param {number} width 目标宽度
   * @param {number} height 目标高度
   * @param {number} priority 0（可见，优先）或 >0（屏外前瞻）
   */
  async generateThumbnail(imagePath, width = 300, height = 300, priority = PRIORITY_VISIBLE) {
    this.metrics.requestCount++;

    // 问题1解决: 初始化时检查一次
    if (!this.cacheDirReady) {
      await this.ensureCacheDir();
    }

    const cacheFilenames = {
      webp: this.generateCacheFilename(imagePath, width, height, 'webp'),
      png: this.generateCacheFilename(imagePath, width, height, 'png')
    };

    // 问题2解决: 同步检查缓存
    if (fs.existsSync(cacheFilenames.webp)) {
      this.metrics.cacheHits.total++;
      this.metrics.cacheHits.webp++;
      return this.toProtocolUrl(cacheFilenames.webp);
    }

    if (fs.existsSync(cacheFilenames.png)) {
      try {
        const cachedImage = nativeImage.createFromPath(cacheFilenames.png);
        if (cachedImage && !cachedImage.isEmpty()) {
          const looksLikeIcon = await this.isSystemFileIcon(imagePath, cachedImage);
          if (!looksLikeIcon) {
            this.metrics.cacheHits.total++;
            this.metrics.cacheHits.png++;
            return this.toProtocolUrl(cacheFilenames.png);
          }
        }
      } catch (err) {
        console.warn('读取缓存缩略图失败，尝试重新生成:', err?.message || err);
      }

      try {
        await unlink(cacheFilenames.png);
      } catch (err) {
        console.warn('删除失效缓存失败:', err?.message || err);
      }
    }

    // 问题3+4解决: 任务队列 + 并发控制
    this.metrics.cacheMisses++;
    return this.enqueueTask(imagePath, width, height, cacheFilenames, priority);
  }

  normalizePriority(priority) {
    const numeric = Number(priority);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return PRIORITY_VISIBLE;
    }
    return PRIORITY_PREFETCH;
  }

  /**
   * 任务队列 - 去重、优先级排序、并发派发
   */
  enqueueTask(imagePath, width, height, cacheFilenames, priority = PRIORITY_VISIBLE) {
    const key = `${imagePath}:${width}:${height}`;

    // 去重: 相同请求合并
    const existing = this.pendingTasks.get(key);
    if (existing) {
      this.metrics.dedupHits++;
      return existing.deferred.promise;
    }

    const task = {
      key,
      imagePath,
      width,
      height,
      cacheFilenames,
      priority: this.normalizePriority(priority),
      state: 'queued', // queued | running | settled
      enqueuedAt: Date.now(),
      deferred: createDeferred()
    };

    this.pendingTasks.set(key, task);
    let keysForPath = this.pendingByPath.get(imagePath);
    if (!keysForPath) {
      keysForPath = new Set();
      this.pendingByPath.set(imagePath, keysForPath);
    }
    keysForPath.add(key);

    this.priorityQueues[task.priority].push(task);
    this.pump();

    return task.deferred.promise;
  }

  /**
   * 调度器：在有空闲并发位时按优先级派发任务。
   * 取代原先 100ms 轮询的信号量，任务完成即立刻补位。
   */
  pump() {
    while (this.activeWorkers < this.MAX_WORKERS) {
      const task = this.dequeueTask();
      if (!task) {
        return;
      }
      this.activeWorkers++;
      task.state = 'running';
      this.runTask(task);
    }
  }

  dequeueTask() {
    for (let level = 0; level < PRIORITY_LEVEL_COUNT; level += 1) {
      const queue = this.priorityQueues[level];
      while (queue.length > 0) {
        const task = queue.shift();
        if (task.state === 'queued') {
          return task;
        }
      }
    }
    return null;
  }

  async runTask(task) {
    if (task.enqueuedAt) {
      this.recordQueueWait(Date.now() - task.enqueuedAt);
    }

    let result = null;
    try {
      result = await withTimeout(
        this.processThumbnail(task.imagePath, task.width, task.height, task.cacheFilenames),
        this.TASK_TIMEOUT_MS,
        () => {
          this.metrics.timeouts++;
          console.warn(
            `[ThumbnailService] 任务超时 ${this.TASK_TIMEOUT_MS}ms，释放并发位: ${task.imagePath}`
          );
        }
      );
    } catch (error) {
      console.error(`生成缩略图失败: ${task.imagePath}`, error);
      result = null;
    } finally {
      this.activeWorkers--;
      this.releasePending(task);
      this.pump();
    }

    this.settleTask(task, result);
  }

  settleTask(task, result) {
    if (task.state === 'settled') {
      return;
    }
    task.state = 'settled';
    task.deferred.resolve(result);
  }

  releasePending(task) {
    if (this.pendingTasks.get(task.key) === task) {
      this.pendingTasks.delete(task.key);
    }

    const keysForPath = this.pendingByPath.get(task.imagePath);
    if (keysForPath) {
      keysForPath.delete(task.key);
      if (keysForPath.size === 0) {
        this.pendingByPath.delete(task.imagePath);
      }
    }
  }

  removeFromQueues(task) {
    for (let level = 0; level < PRIORITY_LEVEL_COUNT; level += 1) {
      const queue = this.priorityQueues[level];
      const index = queue.indexOf(task);
      if (index !== -1) {
        queue.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  recordQueueWait(durationMs) {
    const waits = this.metrics.queueWaits;
    waits.push(durationMs);
    if (waits.length > QUEUE_WAIT_SAMPLE_SIZE) {
      waits.shift();
    }
  }

  /**
   * 取消尚未开始的排队任务。
   *
   * 只取消 queued 状态的任务：运行中的任务不打断，一来无法中断 libvips 解码，
   * 二来避免同一路径被重复解码并发写同一个缓存文件。
   *
   * @param {string[]} imagePaths 原图绝对路径
   * @returns {{requested:number, cancelled:number, inFlight:number}}
   */
  cancelPending(imagePaths) {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      return { requested: 0, cancelled: 0, inFlight: 0 };
    }

    const seen = new Set();
    let cancelled = 0;
    let inFlight = 0;

    for (const imagePath of imagePaths) {
      if (typeof imagePath !== 'string' || seen.has(imagePath)) {
        continue;
      }
      seen.add(imagePath);

      const keysForPath = this.pendingByPath.get(imagePath);
      if (!keysForPath || keysForPath.size === 0) {
        continue;
      }

      for (const key of Array.from(keysForPath)) {
        const task = this.pendingTasks.get(key);
        if (!task) {
          continue;
        }

        if (task.state !== 'queued') {
          inFlight++;
          continue;
        }

        this.removeFromQueues(task);
        this.releasePending(task);
        this.settleTask(task, null);
        cancelled++;
      }
    }

    this.metrics.cancelled += cancelled;
    return { requested: seen.size, cancelled, inFlight };
  }

  async processThumbnail(imagePath, width, height, cacheFilenames) {
    const sharpResult = await this.doGenerate(imagePath, width, height, cacheFilenames.webp);
    if (sharpResult) {
      return sharpResult;
    }

    console.warn(`Sharp生成缩略图失败，尝试系统缩略图: ${imagePath}`);
    const systemResult = await this.trySystemThumbnail(imagePath, width, height, cacheFilenames);
    if (!systemResult) {
      this.metrics.generationFailures++;
    }
    return systemResult;
  }

  async trySystemThumbnail(imagePath, width, height, cacheFilenames) {
    if (!nativeImage || typeof nativeImage.createThumbnailFromPath !== 'function') {
      return null;
    }

    const platformSupportsNative =
      process.platform === 'darwin' ||
      process.platform === 'win32';

    if (!platformSupportsNative) {
      return null;
    }

    try {
      const image = await withTimeout(
        nativeImage.createThumbnailFromPath(imagePath, { width, height }),
        this.NATIVE_CALL_TIMEOUT_MS,
        () => {
          this.metrics.nativeTimeouts++;
          console.warn(
            `系统缩略图超时 ${this.NATIVE_CALL_TIMEOUT_MS}ms，放弃原生路径: ${imagePath}`
          );
        }
      );

      if (!image || image.isEmpty()) {
        return null;
      }

      if (await this.isSystemFileIcon(imagePath, image)) {
        console.warn(`系统缩略图是文件图标，使用Sharp重新生成: ${imagePath}`);
        return null;
      }

      const buffer = image.toPNG();
      await writeFile(cacheFilenames.png, buffer);
      this.metrics.generatedWithSystem++;
      return this.toProtocolUrl(cacheFilenames.png);
    } catch (error) {
      console.warn('系统缩略图获取失败，回退到Sharp:', error?.message || error);
      return null;
    }
  }

  /**
   * 检查系统返回的缩略图是否只是默认文件图标
   */
  async isSystemFileIcon(imagePath, thumbnailImage) {
    if (!thumbnailImage || thumbnailImage.isEmpty()) {
      return true;
    }

    if (!app || typeof app.getFileIcon !== 'function') {
      return false;
    }

    if (!app.isReady()) {
      try {
        await withTimeout(app.whenReady(), this.NATIVE_CALL_TIMEOUT_MS, () => {
          this.metrics.nativeTimeouts++;
          console.warn(`等待应用就绪超时 ${this.NATIVE_CALL_TIMEOUT_MS}ms，跳过图标判定`);
        });
      } catch (err) {
        return false;
      }
    }

    try {
      const fileIcon = await withTimeout(
        app.getFileIcon(imagePath, { size: 'large' }),
        this.NATIVE_CALL_TIMEOUT_MS,
        () => {
          this.metrics.nativeTimeouts++;
          console.warn(
            `文件图标超时 ${this.NATIVE_CALL_TIMEOUT_MS}ms，跳过图标判定: ${imagePath}`
          );
        }
      );

      if (!fileIcon || fileIcon.isEmpty()) {
        return false;
      }

      const { width, height } = thumbnailImage.getSize();
      if (!width || !height) {
        return false;
      }

      const resizedIcon = fileIcon.resize({ width, height, quality: 'best' });
      const thumbBitmap = thumbnailImage.toBitmap();
      const iconBitmap = resizedIcon.toBitmap();

      if (!thumbBitmap || !iconBitmap || thumbBitmap.length !== iconBitmap.length || thumbBitmap.length === 0) {
        return false;
      }

      const totalPixels = thumbBitmap.length / 4;
      const mismatchThreshold = Math.ceil(totalPixels * 0.2); // 允许20%的像素差异
      let mismatchedPixels = 0;

      for (let i = 0; i < thumbBitmap.length; i += 4) {
        if (
          thumbBitmap[i] !== iconBitmap[i] ||
          thumbBitmap[i + 1] !== iconBitmap[i + 1] ||
          thumbBitmap[i + 2] !== iconBitmap[i + 2] ||
          thumbBitmap[i + 3] !== iconBitmap[i + 3]
        ) {
          mismatchedPixels++;
          if (mismatchedPixels > mismatchThreshold) {
            return false;
          }
        }
      }

      return true;
    } catch (err) {
      console.warn('比对系统文件图标失败，跳过检测:', err?.message || err);
      return false;
    }
  }

  /**
   * 实际生成逻辑
   */
  async doGenerate(imagePath, width, height, cacheFilename) {
    try {
      // 检查源文件
      await stat(imagePath);
    } catch (err) {
      console.error(`源图片文件不存在: ${imagePath}`, err);
      return null;
    }

    try {
      await sharp(imagePath, { failOnError: false })
        .resize({ width, height, fit: sharp.fit.cover, withoutEnlargement: true })
        .webp(this.WEBP_OPTIONS)
        .toFile(cacheFilename);

      this.metrics.generatedWithSharp++;
      return this.toProtocolUrl(cacheFilename);
    } catch (err) {
      console.error(`处理图片失败: ${imagePath}`, err);
      return null;
    }
  }

  /**
   * 清理过期缓存
   */
  async cleanExpiredCache() {
    if (!this.cacheDirReady) return;

    try {
      const files = await readdir(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        try {
          const stats = await stat(filePath);

          // TTL过期
          if (now - stats.mtime.getTime() > this.CACHE_TTL) {
            await unlink(filePath);
            console.log(`清理过期缓存: ${file}`);
          }
        } catch (err) {
          // 文件可能已被删除，忽略
        }
      }
    } catch (err) {
      console.error('清理缓存失败:', err);
    }
  }

  /**
   * 清理超大缓存目录
   */
  async cleanOversizedCache() {
    if (!this.cacheDirReady) return;

    try {
      const files = await readdir(this.cacheDir);
      let totalSize = 0;
      const fileStats = [];

      // 收集文件信息
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        try {
          const stats = await stat(filePath);
          totalSize += stats.size;
          fileStats.push({
            path: filePath,
            mtime: stats.mtime.getTime(),
            size: stats.size
          });
        } catch (err) {
          // 忽略
        }
      }

      // 如果超过限制，删除最旧的文件
      if (totalSize > this.MAX_CACHE_SIZE) {
        fileStats.sort((a, b) => a.mtime - b.mtime); // 最旧的在前

        let deletedSize = 0;
        const targetDeleteSize = totalSize - this.MAX_CACHE_SIZE;

        for (const file of fileStats) {
          if (deletedSize >= targetDeleteSize) break;

          try {
            await unlink(file.path);
            deletedSize += file.size;
            console.log(`清理旧缓存(超限): ${path.basename(file.path)}`);
          } catch (err) {
            // 忽略
          }
        }
      }
    } catch (err) {
      console.error('清理超大缓存失败:', err);
    }
  }

  /**
   * 获取缓存统计
   */
  async getCacheStats() {
    if (!this.cacheDirReady) return { count: 0, size: 0 };

    try {
      const files = await readdir(this.cacheDir);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        try {
          const stats = await stat(filePath);
          totalSize += stats.size;
        } catch (err) {
          // 忽略
        }
      }

      return {
        count: files.length,
        size: totalSize,
        maxSize: this.MAX_CACHE_SIZE,
        usage: ((totalSize / this.MAX_CACHE_SIZE) * 100).toFixed(2) + '%'
      };
    } catch (err) {
      console.error('获取缓存统计失败:', err);
      return { count: 0, size: 0 };
    }
  }

  getRuntimeStats() {
    const hitRate = this.metrics.requestCount > 0
      ? Number(((this.metrics.cacheHits.total / this.metrics.requestCount) * 100).toFixed(2))
      : 0;

    const { queueWaits, ...counters } = this.metrics;
    const sortedWaits = [...queueWaits].sort((a, b) => a - b);
    const percentile = (ratio) => {
      if (sortedWaits.length === 0) {
        return 0;
      }
      const index = Math.min(sortedWaits.length - 1, Math.floor(sortedWaits.length * ratio));
      return sortedWaits[index];
    };

    return {
      ...counters,
      hitRate,
      pendingTasks: this.pendingTasks.size,
      activeWorkers: this.activeWorkers,
      maxWorkers: this.MAX_WORKERS,
      queuedVisible: this.priorityQueues[PRIORITY_VISIBLE].length,
      queuedPrefetch: this.priorityQueues[PRIORITY_PREFETCH].length,
      queueWaitP50Ms: percentile(0.5),
      queueWaitP90Ms: percentile(0.9),
      queueWaitSamples: sortedWaits.length
    };
  }
}

// 创建单例
const thumbnailService = new ThumbnailService();

// 定期清理 - 每24小时
if (app.isReady()) {
  setInterval(() => {
    thumbnailService.cleanExpiredCache();
    thumbnailService.cleanOversizedCache();
  }, 24 * 60 * 60 * 1000);
} else {
  app.on('ready', () => {
    setInterval(() => {
      thumbnailService.cleanExpiredCache();
      thumbnailService.cleanOversizedCache();
    }, 24 * 60 * 60 * 1000);
  });
}

// 兼容旧接口
async function ensureCacheDir() {
  return thumbnailService.ensureCacheDir();
}

async function generateThumbnail(imagePath, width, height, priority) {
  return thumbnailService.generateThumbnail(imagePath, width, height, priority);
}

async function cancelPending(imagePaths) {
  return thumbnailService.cancelPending(imagePaths);
}

module.exports = {
  thumbnailService,
  ensureCacheDir,
  generateThumbnail,
  cancelPending,
  THUMBNAIL_CACHE_DIR,
  setMaxWorkers: (count) => thumbnailService.setMaxWorkers(count)
};
