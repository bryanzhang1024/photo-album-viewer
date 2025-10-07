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

/**
 * ThumbnailService - 缩略图生成服务
 *
 * Linus式设计:
 * - 初始化时检查目录，避免重复检查
 * - 并发控制，最多3个Sharp进程
 * - 请求去重，相同请求合并
 * - 自动清理，7天TTL + 500MB限制
 */
class ThumbnailService {
  constructor() {
    this.cacheDir = THUMBNAIL_CACHE_DIR;
    this.cacheDirReady = false;
    this.pendingTasks = new Map(); // 请求去重
    this.activeWorkers = 0;
    this.MAX_WORKERS = 3; // 最大并发Sharp进程
    this.MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB
    this.CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7天
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

  /**
   * 生成缩略图 - 带并发控制和请求去重
   */
  async generateThumbnail(imagePath, width = 300, height = 300) {
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
      return `file://${cacheFilenames.webp}`;
    }

    if (fs.existsSync(cacheFilenames.png)) {
      return `file://${cacheFilenames.png}`;
    }

    // 问题3+4解决: 任务队列 + 并发控制
    return this.enqueueTask(imagePath, width, height, cacheFilenames);
  }

  /**
   * 任务队列 - 去重和并发控制
   */
  async enqueueTask(imagePath, width, height, cacheFilenames) {
    const key = `${imagePath}:${width}:${height}`;

    // 去重: 相同请求合并
    if (this.pendingTasks.has(key)) {
      return this.pendingTasks.get(key);
    }

    const promise = this.processThumbnail(imagePath, width, height, cacheFilenames);
    this.pendingTasks.set(key, promise);

    promise.finally(() => this.pendingTasks.delete(key));
    return promise;
  }

  async processThumbnail(imagePath, width, height, cacheFilenames) {
    const systemThumbnail = await this.trySystemThumbnail(imagePath, width, height, cacheFilenames);
    if (systemThumbnail) {
      return systemThumbnail;
    }

    return this.waitAndGenerate(imagePath, width, height, cacheFilenames.webp);
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
      const image = await nativeImage.createThumbnailFromPath(imagePath, { width, height });
      if (!image || image.isEmpty()) {
        return null;
      }

      const buffer = image.toPNG();
      await writeFile(cacheFilenames.png, buffer);
      return `file://${cacheFilenames.png}`;
    } catch (error) {
      console.warn('系统缩略图获取失败，回退到Sharp:', error?.message || error);
      return null;
    }
  }

  /**
   * 等待并生成 - 并发控制
   */
  async waitAndGenerate(imagePath, width, height, cacheFilename) {
    // 并发控制: 等待空闲worker
    while (this.activeWorkers >= this.MAX_WORKERS) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.activeWorkers++;
    try {
      return await this.doGenerate(imagePath, width, height, cacheFilename);
    } finally {
      this.activeWorkers--;
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
        .webp({ quality: 80 })
        .toFile(cacheFilename);

      return `file://${cacheFilename}`;
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

async function generateThumbnail(imagePath, width, height) {
  return thumbnailService.generateThumbnail(imagePath, width, height);
}

module.exports = {
  thumbnailService,
  ensureCacheDir,
  generateThumbnail,
  THUMBNAIL_CACHE_DIR,
  setMaxWorkers: (count) => thumbnailService.setMaxWorkers(count)
};
