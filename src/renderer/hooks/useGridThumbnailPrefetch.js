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
  // 当前真正需要的路径窗口，用于识别已经划出去的请求
  const requestedPaths = useRef(new Set());

  const collectRowPaths = useCallback((startRow, endRow) => {
    if (!gridRows?.length || typeof extractPathsFromRow !== 'function') {
      return [];
    }

    const normalizedStart = Math.max(0, startRow);
    const normalizedEnd = Math.min(gridRows.length - 1, endRow);

    if (normalizedStart > normalizedEnd) {
      return [];
    }

    const paths = [];
    for (let rowIndex = normalizedStart; rowIndex <= normalizedEnd; rowIndex += 1) {
      const row = gridRows[rowIndex];
      if (row) {
        paths.push(...extractPathsFromRow(row));
      }
    }
    return paths;
  }, [extractPathsFromRow, gridRows]);

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

  /**
   * 取消已经划出需求窗口的排队请求，避免它们继续占用解码并发位。
   *
   * 只影响尚未开始的任务；已经在解码的无法中断。若某张图被误取消，
   * 它一旦重新进入窗口会被再次请求，且 ImageCard 自身的 404 回退路径
   * 也会补发一次请求，因此取消是自愈的。
   */
  const cancelDroppedPaths = useCallback((droppedPaths) => {
    if (!enabled || !ipcRenderer || droppedPaths.length === 0) {
      return;
    }

    droppedPaths.forEach((imagePath) => {
      thumbnailPrefetchInFlight.current.delete(imagePath);
    });

    Promise.resolve(ipcRenderer.invoke(CHANNELS.CANCEL_THUMBNAILS, droppedPaths)).catch((error) => {
      console.error('取消缩略图请求失败:', error);
    });
  }, [enabled]);

  const syncRequestedWindow = useCallback((nextPaths) => {
    const next = new Set(nextPaths);
    const dropped = [];

    for (const imagePath of requestedPaths.current) {
      if (!next.has(imagePath)) {
        dropped.push(imagePath);
      }
    }

    requestedPaths.current = next;
    return dropped;
  }, []);

  const prefetchRows = useCallback((startRow, endRow, priority = 1) => {
    if (!enabled) {
      return;
    }

    const paths = collectRowPaths(startRow, endRow);
    if (paths.length) {
      prefetchThumbnails(paths, priority);
    }
  }, [collectRowPaths, enabled, prefetchThumbnails]);

  useEffect(() => {
    if (!enabled || !gridRows?.length) {
      return;
    }

    syncRequestedWindow(collectRowPaths(0, rowsAhead));
    prefetchRows(0, Math.min(gridRows.length - 1, rowsAhead), 0);
  }, [collectRowPaths, enabled, gridRows, prefetchRows, rowsAhead, syncRequestedWindow]);

  // 卸载时把整个窗口的排队请求一并取消
  useEffect(() => () => {
    const pending = Array.from(requestedPaths.current);
    requestedPaths.current = new Set();
    if (pending.length > 0 && ipcRenderer) {
      Promise.resolve(ipcRenderer.invoke(CHANNELS.CANCEL_THUMBNAILS, pending)).catch(() => {});
    }
  }, []);

  const handleRangeChanged = useCallback(({ startIndex, endIndex }) => {
    if (!enabled || !gridRows?.length) {
      return;
    }

    const normalizedEnd = Math.min(gridRows.length - 1, endIndex);

    // 真正需要覆盖的窗口：可见范围 + 后方回顾 + 前方前瞻
    const wanted = collectRowPaths(startIndex - rowsBehind, normalizedEnd + rowsAhead);
    const dropped = syncRequestedWindow(wanted);
    cancelDroppedPaths(dropped);

    prefetchRows(startIndex, normalizedEnd, 0);
    prefetchRows(startIndex - rowsBehind, startIndex - 1, 1);
    prefetchRows(normalizedEnd + 1, normalizedEnd + rowsAhead, 1);
  }, [
    cancelDroppedPaths,
    collectRowPaths,
    enabled,
    gridRows,
    prefetchRows,
    rowsAhead,
    rowsBehind,
    syncRequestedWindow
  ]);

  return {
    handleRangeChanged
  };
}

export default useGridThumbnailPrefetch;
