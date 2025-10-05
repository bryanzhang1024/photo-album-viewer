import { useState, useCallback } from 'react';
import imageCache from '../utils/ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron?.ipcRenderer;

/**
 * 相簿图片加载 Hook
 * @param {string} albumPath - 相簿路径
 * @returns {Object} { images, loading, error, loadImages, refresh }
 */
export const useAlbumImages = (albumPath) => {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadImages = useCallback(async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return [];
      }

      if (!albumPath) {
        setImages([]);
        return [];
      }

      setLoading(true);
      setError('');

      // 使用统一缓存管理器
      const cachedData = imageCache.get('album', albumPath);
      if (cachedData) {
        setImages(cachedData);
        setLoading(false);
        return cachedData;
      }

      const result = await ipcRenderer.invoke(CHANNELS.GET_ALBUM_IMAGES, albumPath);

      // 缓存结果
      imageCache.set('album', albumPath, result);
      setImages(result);
      setLoading(false);

      return result;
    } catch (err) {
      setError('加载相簿图片时出错: ' + err.message);
      setLoading(false);
      return [];
    }
  }, [albumPath]);

  // 刷新（清除缓存后重新加载）
  const refresh = useCallback(() => {
    if (albumPath) {
      imageCache.delete('album', albumPath);
      loadImages();
    }
  }, [albumPath, loadImages]);

  return {
    images,
    loading,
    error,
    loadImages,
    refresh
  };
};

export default useAlbumImages;
