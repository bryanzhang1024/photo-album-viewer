import { useState, useCallback } from 'react';
import imageCache from '../utils/ImageCacheManager';
import { getDirname } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';

const ipcRenderer = window.electronAPI || null;
const FALLBACK_SORT = { sortBy: 'name', sortDirection: 'asc' };

function readSortPreference(parentPath) {
  const scopeKey = parentPath || '__root__';
  const scopedStorageKey = `sorting:folder:${scopeKey}`;
  const legacySortBy = localStorage.getItem('sortBy');
  const legacySortDirection = localStorage.getItem('sortDirection');

  try {
    const raw = localStorage.getItem(scopedStorageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const sortBy = parsed?.sortBy;
      const sortDirection = parsed?.sortDirection;
      const isValidSortBy = ['name', 'imageCount', 'lastModified'].includes(sortBy);
      const isValidDirection = sortDirection === 'asc' || sortDirection === 'desc';
      if (isValidSortBy && isValidDirection) {
        return { sortBy, sortDirection };
      }
    }
  } catch (error) {
    console.warn(`读取排序配置失败(${scopedStorageKey}):`, error);
  }

  const isValidLegacySortBy = ['name', 'imageCount', 'lastModified'].includes(legacySortBy);
  const isValidLegacyDirection = legacySortDirection === 'asc' || legacySortDirection === 'desc';
  if (isValidLegacySortBy && isValidLegacyDirection) {
    return { sortBy: legacySortBy, sortDirection: legacySortDirection };
  }

  return FALLBACK_SORT;
}

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
      const { sortBy, sortDirection } = readSortPreference(parentPath);
      const sortedAlbums = [...albums].sort((a, b) => {
        let comparison = 0;

        if (sortBy === 'name') {
          comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        } else if (sortBy === 'imageCount') {
          comparison = a.imageCount - b.imageCount;
        } else if (sortBy === 'lastModified') {
          comparison = new Date(a.lastModified) - new Date(b.lastModified);
        }

        return sortDirection === 'asc' ? comparison : -comparison;
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
