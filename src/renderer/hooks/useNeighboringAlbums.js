import { useState, useCallback } from 'react';
import imageCache from '../utils/ImageCacheManager';
import { getDirname } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron?.ipcRenderer;

/**
 * 相邻相簿导航 Hook
 * @param {string} albumPath - 当前相簿路径
 * @returns {Object} { neighboringAlbums, siblingAlbums, loadNeighboringAlbums }
 */
export const useNeighboringAlbums = (albumPath) => {
  const [neighboringAlbums, setNeighboringAlbums] = useState({
    prev: null,
    next: null,
    currentIndex: -1,
    total: 0
  });
  const [siblingAlbums, setSiblingAlbums] = useState([]);

  const loadNeighboringAlbums = useCallback(async () => {
    try {
      if (!ipcRenderer || !albumPath) return;

      const parentPath = getDirname(albumPath);
      if (!parentPath || parentPath === albumPath) {
        setNeighboringAlbums({ prev: null, next: null, currentIndex: -1, total: 0 });
        setSiblingAlbums([]);
        return;
      }

      // 性能优化: 优先使用缓存，避免重复扫描同一父目录
      const cachedResponse = imageCache.get('navigation', parentPath);
      let response;

      if (cachedResponse) {
        // 缓存命中，直接使用
        response = cachedResponse;
      } else {
        // 缓存未命中，调用IPC扫描父目录
        response = await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, parentPath);

        if (!response.success) {
          throw new Error(response.error?.message || 'Failed to scan parent directory');
        }

        // 存入缓存供后续使用
        imageCache.set('navigation', parentPath, response);
      }

      // 从节点中只筛选出相册
      const albums = response.nodes.filter(node => node.type === 'album');

      if (albums.length === 0) {
        setNeighboringAlbums({ prev: null, next: null, currentIndex: -1, total: 0 });
        setSiblingAlbums([]);
        return;
      }

      // 使用与HomePage相同的排序逻辑
      const sortedAlbums = [...albums].sort((a, b) => {
        let comparison = 0;
        const savedSortBy = localStorage.getItem('sortBy') || 'name';
        const savedSortDirection = localStorage.getItem('sortDirection') || 'asc';

        if (savedSortBy === 'name') {
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        } else if (savedSortBy === 'imageCount') {
          comparison = a.imageCount - b.imageCount;
        } else if (savedSortBy === 'lastModified') {
          comparison = new Date(a.lastModified) - new Date(b.lastModified);
        }

        return savedSortDirection === 'asc' ? comparison : -comparison;
      });

      const currentIndex = sortedAlbums.findIndex(album => album.path === albumPath);

      setSiblingAlbums(sortedAlbums);

      if (currentIndex !== -1) {
        setNeighboringAlbums({
          prev: currentIndex > 0 ? sortedAlbums[currentIndex - 1] : null,
          next: currentIndex < sortedAlbums.length - 1 ? sortedAlbums[currentIndex + 1] : null,
          currentIndex,
          total: sortedAlbums.length
        });
      }
    } catch (err) {
      console.error('加载相邻相簿信息失败:', err);
      setNeighboringAlbums({ prev: null, next: null, currentIndex: -1, total: 0 });
      setSiblingAlbums([]);
    }
  }, [albumPath]);

  return {
    neighboringAlbums,
    siblingAlbums,
    loadNeighboringAlbums
  };
};

export default useNeighboringAlbums;
