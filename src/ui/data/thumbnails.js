import { resolvePortableRelativePath } from '../../common/path-codec';
import { invoke, CHANNELS } from './ipc';

const cache = new Map();

/**
 * 取缩略图 URL。主进程负责生成并返回 thumbnail-protocol 地址；
 * 结果按绝对路径缓存，同一张图不会重复请求。
 */
export async function loadThumbnail(rootPath, relativePath) {
  if (!rootPath || !relativePath) return null;
  const absolutePath = resolvePortableRelativePath(rootPath, relativePath);
  if (cache.has(absolutePath)) return cache.get(absolutePath);
  const url = await invoke(CHANNELS.GET_THUMBNAIL, absolutePath, 0);
  if (url) cache.set(absolutePath, url);
  return url || null;
}
