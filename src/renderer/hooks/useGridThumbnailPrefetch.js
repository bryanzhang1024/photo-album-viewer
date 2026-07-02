import { useCallback, useEffect, useRef } from 'react';
import imageCache from '../utils/ImageCacheManager';
import { getBasename } from '../utils/pathUtils';
import CHANNELS from '../../common/ipc-channels';

const ipcRenderer = window.electronAPI || null;

export const DEFAULT_PREFETCH_ROWS_AHEAD = 4;
export const DEFAULT_PREFETCH_ROWS_BEHIND = 1;

export function extractAlbumImageRowPaths(row) {
  if (!Array.isArray(row)) {
    return [];
  }

  return row.flatMap((image) => (image?.path ? [image.path] : []));
}

export function extractHomePageRowPaths(row) {
  if (!Array.isArray(row)) {
    return [];
  }

  return row.flatMap((item) => {
    if (item?.itemKind === 'image' && item.image?.path) {
      return [item.image.path];
    }

    if (item?.itemKind === 'node') {
      const samples = item.node?.samples || item.node?.previewSamples || [];
      return samples[0] ? [samples[0]] : [];
    }

    return [];
  });
}

export function extractFavoriteAlbumRowPaths(row) {
  if (!Array.isArray(row)) {
    return [];
  }

  return row.flatMap((album) => {
    const previewImages = Array.isArray(album?.previewImages)
      ? album.previewImages.map((image) => (typeof image === 'string' ? image : image?.path)).filter(Boolean)
      : [];
    const samples = album?.previewSamples || album?.samples || previewImages;
    return samples[0] ? [samples[0]] : [];
  });
}

export function useGridThumbnailPrefetch({
  gridRows,
  extractPathsFromRow,
  rowsAhead = DEFAULT_PREFETCH_ROWS_AHEAD,
  rowsBehind = DEFAULT_PREFETCH_ROWS_BEHIND,
  enabled = true
}) {
  const thumbnailPrefetchInFlight = useRef(new Set());

  const prefetchThumbnails = useCallback(async (paths, priority = 1) => {
    if (!enabled || !ipcRenderer || !Array.isArray(paths) || paths.length === 0) {
      return;
    }

    const uniquePaths = Array.from(new Set(paths)).filter((imagePath) => {
      if (!imagePath) return false;
      if (thumbnailPrefetchInFlight.current.has(imagePath)) return false;
      if (imageCache.get('thumbnail', imagePath)) return false;
      return true;
    });

    if (!uniquePaths.length) {
      return;
    }

    uniquePaths.forEach((path) => thumbnailPrefetchInFlight.current.add(path));

    try {
      const results = await ipcRenderer.invoke(CHANNELS.GET_BATCH_THUMBNAILS, uniquePaths, priority);

      if (results && typeof results === 'object') {
        uniquePaths.forEach((imagePath) => {
          const url = results[imagePath];
          if (!url) return;
          const thumbnailUrl = `thumbnail-protocol://${getBasename(url)}`;
          imageCache.set('thumbnail', imagePath, thumbnailUrl);
        });
      }
    } catch (error) {
      console.error('预取缩略图失败:', error);
    } finally {
      uniquePaths.forEach((path) => thumbnailPrefetchInFlight.current.delete(path));
    }
  }, [enabled]);

  const prefetchRows = useCallback((startRow, endRow, priority = 1) => {
    if (!enabled || !gridRows?.length || typeof extractPathsFromRow !== 'function') {
      return;
    }

    const normalizedStart = Math.max(0, startRow);
    const normalizedEnd = Math.min(gridRows.length - 1, endRow);

    if (normalizedStart > normalizedEnd) {
      return;
    }

    const paths = [];

    for (let rowIndex = normalizedStart; rowIndex <= normalizedEnd; rowIndex += 1) {
      paths.push(...extractPathsFromRow(gridRows[rowIndex]));
    }

    if (paths.length) {
      prefetchThumbnails(paths, priority);
    }
  }, [enabled, extractPathsFromRow, gridRows, prefetchThumbnails]);

  useEffect(() => {
    if (!enabled || !gridRows?.length) {
      return;
    }

    prefetchRows(0, Math.min(gridRows.length - 1, rowsAhead), 0);
  }, [enabled, gridRows, prefetchRows, rowsAhead]);

  const handleRangeChanged = useCallback(({ startIndex, endIndex }) => {
    prefetchRows(startIndex, endIndex, 0);
    prefetchRows(startIndex - rowsBehind, startIndex - 1, 1);
    prefetchRows(endIndex + 1, endIndex + rowsAhead, 1);
  }, [prefetchRows, rowsAhead, rowsBehind]);

  return {
    handleRangeChanged
  };
}

export default useGridThumbnailPrefetch;
