import { invoke, CHANNELS } from './ipc';

/**
 * 收藏 identity 统一为「绝对路径」：folders 与 albums 两个数组里的同路径记录
 * 视为同一条收藏，kind 只用于分组展示，不参与身份判断。
 */
function mergeFolderCollections(data) {
  if (!data || typeof data !== 'object') return data;
  const folders = Array.isArray(data.folders) ? data.folders : [];
  const albums = Array.isArray(data.albums) ? data.albums : [];
  if (folders.length === 0 && albums.length === 0) return data;

  const byPath = new Map();
  [...folders, ...albums].forEach((entry) => {
    if (!entry || typeof entry.path !== 'string') return;
    const existing = byPath.get(entry.path);
    if (!existing) {
      byPath.set(entry.path, entry);
      return;
    }
    // 同路径保留信息更全的一条（张数、封面、收藏时间取较早的）
    byPath.set(entry.path, {
      ...existing,
      ...entry,
      imageCount: Math.max(existing.imageCount || 0, entry.imageCount || 0),
      previewImages: (entry.previewImages?.length || 0) >= (existing.previewImages?.length || 0)
        ? entry.previewImages
        : existing.previewImages,
      addedAt: Math.min(existing.addedAt || Number.MAX_SAFE_INTEGER, entry.addedAt || Number.MAX_SAFE_INTEGER)
    });
  });

  const merged = [...byPath.values()];
  const normalizedFolders = merged.filter((entry) => entry.kind === 'folder' || entry.kind === undefined);
  const normalizedAlbums = merged.filter((entry) => entry.kind === 'photoSet' || entry.kind === 'album');
  // 没有 kind 的历史记录按 folders 归类，保证旧数据不丢
  return {
    ...data,
    folders: normalizedFolders,
    albums: normalizedAlbums
  };
}

export async function loadFavorites() {
  return mergeFolderCollections(await invoke(CHANNELS.LOAD_FAVORITES));
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

/** 在 folders 与 albums 两个数组里按路径查找，二者视为同一身份。 */
export function findFolderFavorite(favorites, folderPath) {
  if (!folderPath) return null;
  const inAlbums = (favorites?.albums || []).find((item) => item.path === folderPath);
  if (inAlbums) return inAlbums;
  return (favorites?.folders || []).find((item) => item.path === folderPath) || null;
}

export function isFolderFavorited(favorites, folderPath) {
  return Boolean(findFolderFavorite(favorites, folderPath));
}

// 旧名字保留，行为改为跨两数组判断
export const isAlbumFavorited = isFolderFavorited;

/**
 * 切换文件夹/相簿收藏。entry: { path, name, kind, imageCount, previewImages, previewImagePath }
 * kind 只影响分组展示：只有图片的目录用 'photoSet'，有子文件夹的用 'folder'。
 */
export async function toggleFolderFavorite(entry) {
  const favorites = await loadFavorites();
  const exists = isFolderFavorited(favorites, entry.path);
  const folders = (favorites.folders || []).filter((item) => item.path !== entry.path);
  const albums = (favorites.albums || []).filter((item) => item.path !== entry.path);

  if (exists) {
    const updated = await saveFavorites({ ...favorites, folders, albums });
    if (!updated) throw new Error('收藏保存失败');
    return false;
  }

  const kind = entry.kind === 'photoSet' ? 'photoSet' : 'folder';
  const record = {
    id: `${kind}_${Date.now()}`,
    kind,
    path: entry.path,
    name: entry.name,
    imageCount: entry.imageCount || 0,
    previewImages: entry.previewImages || [],
    previewImagePath: entry.previewImagePath || '',
    addedAt: Date.now()
  };
  const next = kind === 'photoSet'
    ? { ...favorites, folders, albums: [...albums, record] }
    : { ...favorites, albums, folders: [...folders, record] };
  const updated = await saveFavorites(next);
  if (!updated) throw new Error('收藏保存失败');
  return true;
}

export const toggleAlbumFavorite = toggleFolderFavorite;
