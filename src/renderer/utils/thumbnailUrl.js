/**
 * 在渲染进程中预算缩略图 URL，绕过 IPC 直接加载磁盘缓存。
 *
 * 算法必须与 ThumbnailService.generateCacheFilename() 保持一致：
 *   hash = md5(imagePath + width + height)
 *   filename = hash + '.webp'
 *
 * 默认分辨率 600 与主进程 DEFAULT_PERFORMANCE_SETTINGS.thumbnailResolution 保持一致。
 */

let crypto = null;
try {
  crypto = window.require ? window.require('crypto') : null;
} catch (e) {
  // 非 Electron 环境，降级为 IPC 加载
}

const DEFAULT_RESOLUTION = 600;

/**
 * 返回给定图片的预算缩略图 URL。
 * 若 crypto 不可用（非 Electron 环境）则返回 null，调用方应回退到 IPC。
 *
 * @param {string} imagePath  原始图片的绝对路径
 * @param {number} resolution 缩略图宽度（默认 600）
 * @returns {string|null}
 */
export function getThumbnailUrl(imagePath, resolution = DEFAULT_RESOLUTION) {
  if (!crypto || !imagePath) return null;
  const width = resolution;
  const height = resolution * 1.5;
  // 拼接规则与主进程一致：imagePath + width + height（数字隐式转字符串）
  const hash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
  return `thumbnail-protocol://${hash}.webp`;
}
