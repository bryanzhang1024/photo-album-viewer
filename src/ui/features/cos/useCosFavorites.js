import { useCallback, useEffect, useState } from 'react';
import {
  loadFavorites,
  isFolderFavorited,
  isImageFavorited,
  toggleFolderFavorite,
  toggleImageFavorite
} from '../../data/favorites';

/**
 * Cos 页共用收藏状态：与文件夹页写同一份 favorites.json。
 * 套图收藏身份 = 套图目录的绝对路径（主进程在 favoriteTargets 里给出）；
 * 照片收藏身份 = 图片绝对路径。收藏页按路径去重，两处看到的是同一条。
 */
export default function useCosFavorites() {
  const [favorites, setFavorites] = useState(null);

  const reload = useCallback(async () => {
    try {
      setFavorites(await loadFavorites());
    } catch (_error) {
      // 收藏读取失败时按未收藏显示，不阻塞浏览
    }
  }, []);

  useEffect(() => {
    let alive = true;
    loadFavorites()
      .then((data) => { if (alive) setFavorites(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const isAlbumFavorited = useCallback(
    (albumPath) => (albumPath ? isFolderFavorited(favorites, albumPath) : false),
    [favorites]
  );
  const isPhotoFavorited = useCallback(
    (imagePath) => (imagePath ? isImageFavorited(favorites, imagePath) : false),
    [favorites]
  );
  const toggleAlbum = useCallback(async (entry) => {
    if (!entry?.path) return;
    try {
      await toggleFolderFavorite(entry);
      await reload();
    } catch (error) {
      console.warn('收藏失败:', error?.message);
    }
  }, [reload]);
  const togglePhoto = useCallback(async (image, albumPath, albumName) => {
    if (!image?.path) return;
    try {
      await toggleImageFavorite(image, albumPath, albumName);
      await reload();
    } catch (error) {
      console.warn('收藏失败:', error?.message);
    }
  }, [reload]);

  return { favorites, isAlbumFavorited, isPhotoFavorited, toggleAlbum, togglePhoto, reload };
}
