import imageCache from './ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

export const clearAllCache = () => {
  try {
    // 1. 清空 ImageCacheManager
    imageCache.clearAll();

    // 2. 清空 localStorage 中的相关缓存
    const lsKeysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('albums_cache_') || key.startsWith('album_images_') || key.startsWith('navigation_cache_'))) {
        lsKeysToRemove.push(key);
      }
    }
    lsKeysToRemove.forEach(key => localStorage.removeItem(key));

    // 3. 清空 sessionStorage 中的相关缓存
    const ssKeysToRemove = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && (key.startsWith('album_preview_') || key.startsWith('image_thumbnail_'))) {
        ssKeysToRemove.push(key);
      }
    }
    ssKeysToRemove.forEach(key => sessionStorage.removeItem(key));

    // 4. 通知主进程清空磁盘缓存
    if (ipcRenderer) {
      ipcRenderer.invoke(CHANNELS.CLEAR_THUMBNAIL_CACHE)
        .then(result => {
          if (result.success) {
            alert('所有缓存已成功清除。建议重新加载应用以确保所有更改生效。');
          } else {
            throw new Error(result.error || '未知错误');
          }
        })
        .catch(err => {
          console.error('清除主进程缓存时出错:', err);
          alert(`清除缓存时出错: ${err.message}`);
        });
    } else {
       alert('部分缓存已清除。主进程缓存无法访问，请尝试重启应用。');
    }
  } catch (error) {
    console.error('清除缓存时发生错误:', error);
    alert(`清除缓存时发生意外错误: ${error.message}`);
  }
};
