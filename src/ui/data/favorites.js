import { invoke, CHANNELS } from './ipc';

export async function loadFavorites() {
  return invoke(CHANNELS.LOAD_FAVORITES);
}

export async function saveFavorites(data) {
  const result = await invoke(CHANNELS.SAVE_FAVORITES, data, data?.version);
  return Boolean(result?.success);
}

export function isImageFavorited(favorites, imagePath) {
  return Boolean(favorites?.images?.some((item) => item.path === imagePath));
}

/** 切换单张图片收藏，写回同一份 favorites.json（与旧界面兼容）。 */
export async function toggleImageFavorite(image, albumPath, albumName) {
  const favorites = await loadFavorites();
  const images = Array.isArray(favorites.images) ? favorites.images : [];
  const exists = images.some((item) => item.path === image.path);
  const nextImages = exists
    ? images.filter((item) => item.path !== image.path)
    : [...images, {
      id: `image_${Date.now()}`,
      path: image.path,
      name: image.name,
      size: image.size || 0,
      lastModified: image.lastModified || Date.now(),
      albumPath: albumPath || '',
      albumName: albumName || '',
      addedAt: Date.now()
    }];
  const updated = await saveFavorites({ ...favorites, images: nextImages });
  if (!updated) throw new Error('收藏保存失败');
  return !exists;
}
