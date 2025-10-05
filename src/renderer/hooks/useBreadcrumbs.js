import { useState, useCallback } from 'react';
import imageCache from '../utils/ImageCacheManager';
import { getBreadcrumbPaths } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';

const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron?.ipcRenderer;

/**
 * 面包屑导航 Hook
 * @param {string} albumPath - 当前相簿路径
 * @param {string} rootPath - 根路径
 * @returns {Object} { breadcrumbs, metadata, loadBreadcrumbs }
 */
export const useBreadcrumbs = (albumPath, rootPath) => {
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [metadata, setMetadata] = useState(null);

  const loadBreadcrumbs = useCallback(async () => {
    try {
      if (!albumPath) {
        setBreadcrumbs([]);
        setMetadata(null);
        return;
      }

      // 直接请求当前路径的导航信息，让主进程生成完整的面包屑
      const cachedData = imageCache.get('navigation', albumPath);
      if (cachedData && cachedData.breadcrumbs) {
        setBreadcrumbs(cachedData.breadcrumbs);
        setMetadata(cachedData.metadata);
        return;
      }

      if (ipcRenderer) {
        const response = await ipcRenderer.invoke(CHANNELS.SCAN_NAVIGATION_LEVEL, albumPath);
        if (response.success) {
          // 直接缓存和使用主进程返回的完整面包屑
          imageCache.set('navigation', albumPath, response);
          setBreadcrumbs(response.breadcrumbs);
          setMetadata(response.metadata);
        } else {
          // Fallback: 如果API失败，至少显示基于路径的简单面包屑
          setBreadcrumbs(getBreadcrumbPaths(albumPath, rootPath));
          setMetadata(null);
        }
      } else {
        setBreadcrumbs(getBreadcrumbPaths(albumPath, rootPath));
        setMetadata(null);
      }
    } catch (error) {
      console.error('加载面包屑数据失败:', error);
      setBreadcrumbs(getBreadcrumbPaths(albumPath, rootPath));
      setMetadata(null);
    }
  }, [albumPath, rootPath]);

  return {
    breadcrumbs,
    metadata,
    loadBreadcrumbs
  };
};

export default useBreadcrumbs;
