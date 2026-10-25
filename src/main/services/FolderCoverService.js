const fs = require('fs');
const path = require('path');

const PORTABLE_SEPARATOR = '/';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
  '.heic', '.heif', '.avif', '.tif', '.tiff'
]);

/**
 * 文件夹封面取样：给「自己没图、但更深层有图」的文件夹找几张封面。
 *
 * 为什么按需做：整库扫描时给每个文件夹都往下钻，几千个目录会把浏览卡死。
 * 这里只在卡片进入可视区、且快照里没有封面时才调用，并按以下预算收敛：
 *   - 最多访问 maxDirs 个目录（默认 16）
 *   - 最多下钻 maxDepth 层（默认 3）
 *   - 凑够 maxSamples 张（默认 4）立即停
 * 目录按名称自然序访问，保证同一目录每次结果一致；结果进 LRU 缓存。
 */
function createFolderCoverService({
  fsApi = fs.promises,
  maxDirs = 16,
  maxDepth = 3,
  maxSamples = 4,
  cacheLimit = 2000
} = {}) {
  const cache = new Map();

  function remember(key, value) {
    if (cache.size >= cacheLimit) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, value);
  }

  function isImage(name) {
    return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
  }

  async function readEntries(dir) {
    try {
      const entries = await fsApi.readdir(dir, { withFileTypes: true });
      return entries
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN', { numeric: true }));
    } catch (_error) {
      return [];
    }
  }

  /**
   * @param {string} absoluteRoot 来源根目录（绝对路径）
   * @param {string} relativePath 相对来源根的路径（portable，'/' 分隔）
   * @returns {Promise<{samples: string[], dirsVisited: number, truncated: boolean}>}
   *          samples 是相对来源根的 portable 路径，可直接喂给缩略图管线。
   */
  async function findCover(absoluteRoot, relativePath = '') {
    const normalizedRelative = String(relativePath || '').replace(/\\/g, PORTABLE_SEPARATOR);
    const key = `${absoluteRoot}\u0000${normalizedRelative}`;
    if (cache.has(key)) return cache.get(key);

    const samples = [];
    let dirsVisited = 0;
    let truncated = false;
    const queue = [{
      absolute: path.join(absoluteRoot, ...normalizedRelative.split(PORTABLE_SEPARATOR).filter(Boolean)),
      relative: normalizedRelative,
      depth: 0
    }];

    while (queue.length > 0) {
      if (dirsVisited >= maxDirs || samples.length >= maxSamples) {
        truncated = queue.length > 0 || dirsVisited >= maxDirs;
        break;
      }
      const current = queue.shift();
      dirsVisited += 1;
      const entries = await readEntries(current.absolute);
      const childDirs = [];
      for (const entry of entries) {
        const childRelative = current.relative
          ? `${current.relative}${PORTABLE_SEPARATOR}${entry.name}`
          : entry.name;
        if (entry.isDirectory()) {
          childDirs.push({
            absolute: path.join(current.absolute, entry.name),
            relative: childRelative,
            depth: current.depth + 1
          });
          continue;
        }
        if (entry.isFile() && isImage(entry.name)) {
          samples.push(childRelative);
          if (samples.length >= maxSamples) break;
        }
      }
      if (current.depth + 1 <= maxDepth) {
        queue.push(...childDirs);
      } else if (childDirs.length > 0) {
        truncated = true;
      }
    }

    const result = { samples: samples.slice(0, maxSamples), dirsVisited, truncated };
    remember(key, result);
    return result;
  }

  function clearCache() {
    cache.clear();
  }

  return { findCover, clearCache };
}

module.exports = { createFolderCoverService, IMAGE_EXTENSIONS };
