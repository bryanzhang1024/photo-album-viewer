import { useState, useCallback, useRef, useMemo } from 'react';
import imageCache from '../utils/ImageCacheManager';
import CHANNELS from '../../common/ipc-channels';

const ipcRenderer = window.electronAPI || null;

export const DEFAULT_ALBUM_PAGE_SIZE = 200;

function buildQueryOptions({
  offset,
  limit,
  sortBy,
  sortDirection,
  searchQuery,
  locatePath
}) {
  return {
    offset,
    limit,
    sortBy,
    sortDirection,
    searchQuery: searchQuery || '',
    ...(locatePath ? { locatePath } : {})
  };
}

/**
 * 相簿图片分页加载 Hook
 * @param {string} albumPath - 相簿路径
 * @param {Object} options - 分页与排序选项
 * @returns {Object} 分页状态与操作方法
 */
export const useAlbumImages = (albumPath, options = {}) => {
  const {
    sortBy = 'name',
    sortDirection = 'asc',
    searchQuery = '',
    pageSize = DEFAULT_ALBUM_PAGE_SIZE
  } = options;

  const [images, setImages] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const nextOffsetRef = useRef(0);
  const loadGenerationRef = useRef(0);

  const queryKey = useMemo(
    () => JSON.stringify({
      sortBy,
      sortDirection,
      searchQuery: (searchQuery || '').trim().toLowerCase(),
      pageSize
    }),
    [sortBy, sortDirection, searchQuery, pageSize]
  );

  const fetchPage = useCallback(async (offset, locatePath = null) => {
    const response = await ipcRenderer.invoke(
      CHANNELS.GET_ALBUM_IMAGES,
      albumPath,
      buildQueryOptions({
        offset,
        limit: pageSize,
        sortBy,
        sortDirection,
        searchQuery,
        locatePath
      })
    );

    if (!response || response.success === false) {
      throw new Error(response?.error || '加载相簿图片失败');
    }

    return response;
  }, [albumPath, pageSize, sortBy, sortDirection, searchQuery]);

  const applyPageResponse = useCallback((response, append) => {
    const pageImages = Array.isArray(response.images) ? response.images : [];
    setImages((prevImages) => (append ? [...prevImages, ...pageImages] : pageImages));
    setTotalCount(response.totalCount || 0);
    setHasMore(Boolean(response.hasMore));
    nextOffsetRef.current = (response.offset || 0) + pageImages.length;
    return pageImages;
  }, []);

  const loadImages = useCallback(async () => {
    try {
      if (!ipcRenderer) {
        setError('无法访问ipcRenderer, Electron可能没有正确加载');
        return [];
      }

      if (!albumPath) {
        setImages([]);
        setTotalCount(0);
        setHasMore(false);
        return [];
      }

      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;

      setLoading(true);
      setError('');
      nextOffsetRef.current = 0;

      const response = await fetchPage(0);
      if (generation !== loadGenerationRef.current) {
        return [];
      }

      const pageImages = applyPageResponse(response, false);
      setLoading(false);
      return pageImages;
    } catch (err) {
      setError(`加载相簿图片时出错: ${err.message}`);
      setLoading(false);
      return [];
    }
  }, [albumPath, applyPageResponse, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!albumPath || !hasMore || loading || loadingMore) {
      return [];
    }

    const generation = loadGenerationRef.current;

    try {
      setLoadingMore(true);
      const response = await fetchPage(nextOffsetRef.current);
      if (generation !== loadGenerationRef.current) {
        return [];
      }

      const pageImages = applyPageResponse(response, true);
      setLoadingMore(false);
      return pageImages;
    } catch (err) {
      if (generation === loadGenerationRef.current) {
        setError(`加载更多图片时出错: ${err.message}`);
        setLoadingMore(false);
      }
      return [];
    }
  }, [albumPath, applyPageResponse, fetchPage, hasMore, loading, loadingMore]);

  const ensureImageLoaded = useCallback(async (imagePath) => {
    if (!albumPath || !imagePath) {
      return [];
    }

    if (images.some((image) => image.path === imagePath)) {
      const globalIndex = images.findIndex((image) => image.path === imagePath);
      return {
        images,
        globalIndex,
        offset: 0
      };
    }

    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;

    try {
      setLoading(true);
      setError('');

      const response = await fetchPage(0, imagePath);
      if (generation !== loadGenerationRef.current) {
        return [];
      }

      applyPageResponse(response, false);
      setLoading(false);
      return {
        images: response.images || [],
        globalIndex: response.globalIndex,
        offset: response.offset || 0
      };
    } catch (err) {
      if (generation === loadGenerationRef.current) {
        setError(`定位图片时出错: ${err.message}`);
        setLoading(false);
      }
      return {
        images: [],
        globalIndex: -1,
        offset: 0
      };
    }
  }, [albumPath, applyPageResponse, fetchPage]);

  const refresh = useCallback(() => {
    if (albumPath) {
      imageCache.deleteEntry('album', albumPath);
      loadGenerationRef.current += 1;
      return loadImages();
    }
    return Promise.resolve([]);
  }, [albumPath, loadImages]);

  const removeImage = useCallback((imagePath) => {
    if (!albumPath || !imagePath) {
      return;
    }

    setImages((prevImages) => prevImages.filter((image) => image.path !== imagePath));
    setTotalCount((prevCount) => Math.max(0, prevCount - 1));
  }, [albumPath]);

  const resetForQueryChange = useCallback(() => {
    loadGenerationRef.current += 1;
    setImages([]);
    setTotalCount(0);
    setHasMore(false);
    nextOffsetRef.current = 0;
  }, []);

  return {
    images,
    totalCount,
    hasMore,
    loading,
    loadingMore,
    error,
    queryKey,
    loadImages,
    loadMore,
    ensureImageLoaded,
    refresh,
    removeImage,
    resetForQueryChange
  };
};

export default useAlbumImages;
