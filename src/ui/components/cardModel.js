/**
 * 卡片文字的唯一格式化入口。
 *
 * 文件夹页与 Cos 页都从这里取次行文字，避免同一套规则在组件/CSS 里各抄一份
 * （4.0 时期 cos.css 曾复制 folder.css 的卡片规则，两边逐渐走样）。
 */

/** 目录与照片共用的日期写法。 */
export function formatDate(mtimeMs) {
  if (!mtimeMs) return '—';
  const date = new Date(mtimeMs);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 目录卡次行：容器目录给子文件夹数与直系张数，叶子目录给张数与修改日期。
 * 与 4.4.1 之前 GridCard 里的规则完全一致，只改成可复用函数。
 */
export function folderMeta(item) {
  if (item.childCount > 0) return `${item.childCount} 个子文件夹 · ${item.imageCount} 张`;
  return `${item.imageCount} 张${item.mtimeMs ? ` · ${formatDate(item.mtimeMs)}` : ''}`;
}

/**
 * 照片卡次行：大小与修改日期。
 * item 可以是目录快照的图片（mtimeMs），也可以是 Cos 媒体（lastModified 为 Date）。
 */
export function imageMeta(item) {
  const size = Number.isFinite(item.size) ? Math.round(item.size / 1024) : 0;
  return `${size} KB · ${formatDate(item.mtimeMs || item.lastModified)}`;
}
