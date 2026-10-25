import { resolvePortableRelativePath } from '../../common/path-codec';
import { invoke, CHANNELS } from './ipc';

/** 相簿图片的绝对路径。 */
export function albumImageAbsolutePath(rootPath, relativePath) {
  return resolvePortableRelativePath(rootPath, relativePath);
}

/** 整图 URL（local-image-protocol）。 */
export function localImageUrl(absolutePath) {
  const api = window.electronAPI;
  if (!api?.getLocalImageUrl || !absolutePath) return '';
  return api.getLocalImageUrl(absolutePath);
}

/** 相簿分页读取（大目录用；当前 S2 主要用快照里的 directMedia）。 */
export async function getAlbumImages(source, relativePath, { offset = 0, limit = 200 } = {}) {
  const albumPath = resolvePortableRelativePath(source.rootPath, relativePath);
  const response = await invoke(CHANNELS.GET_ALBUM_IMAGES, albumPath, { offset, limit });
  if (!response?.success) {
    throw new Error(response?.error || '读取相簿失败');
  }
  return {
    images: response.images || [],
    totalCount: response.totalCount || 0,
    offset: response.offset || 0,
    hasMore: Boolean(response.hasMore)
  };
}
