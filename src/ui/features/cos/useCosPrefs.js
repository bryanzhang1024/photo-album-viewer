import { useCallback, useEffect, useState } from 'react';
import { DENSITY_LEVELS, defaultSortDirection } from '../../data/prefs';

const DENSITY_KEY = 'pav.cos.density.v1';
const SORT_KEY = (pageKey) => `pav.cos.sort.v1:${pageKey}`;
const FIT_KEY = (setId) => `pav.cos.fit.v1:${setId}`;

function readNumber(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch (_error) {
    // 存储不可用时只在本页生效
  }
}

/**
 * Cos 各页共用一个缩略图密度偏好：Cos 图库是一整库，不像文件夹那样按目录记忆。
 * 缺省与照片来源一致（紧凑 148）。
 */
export function useCosDensity() {
  const [density, setDensityState] = useState(() => {
    const value = readNumber(DENSITY_KEY, 0);
    return value >= 0 && value <= 2 ? value : 0;
  });
  const setDensity = useCallback((next) => {
    setDensityState(next);
    write(DENSITY_KEY, next);
  }, []);
  return [density, setDensity, DENSITY_LEVELS[density] || DENSITY_LEVELS[0]];
}

/** 排序偏好：每类页面各记一份（全部作品 / 某个署名下的套图 / 某套照片）。 */
export function useCosSort(pageKey, field = 'name') {
  const [sort, setSortState] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SORT_KEY(pageKey));
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.field === 'string') {
        return { field: parsed.field, direction: parsed.direction === 'desc' ? 'desc' : 'asc' };
      }
    } catch (_error) {
      // 退回默认
    }
    return { field, direction: defaultSortDirection(field) };
  });
  const setSort = useCallback((next) => {
    setSortState(next);
    try {
      window.localStorage.setItem(SORT_KEY(pageKey), JSON.stringify(next));
    } catch (_error) {
      // 存储不可用时只在本页生效
    }
  }, [pageKey]);
  return [sort, setSort];
}

/** 套图照片页的「完整显示」开关：按套图记住，与文件夹页的按目录记忆一致。 */
export function useCosFit(setId) {
  const [fit, setFitState] = useState(() => {
    try {
      return window.localStorage.getItem(FIT_KEY(setId)) === '1';
    } catch (_error) {
      return false;
    }
  });
  useEffect(() => {
    try {
      setFitState(window.localStorage.getItem(FIT_KEY(setId)) === '1');
    } catch (_error) {
      setFitState(false);
    }
  }, [setId]);
  const setFit = useCallback((next) => {
    setFitState(next);
    try {
      window.localStorage.setItem(FIT_KEY(setId), next ? '1' : '0');
    } catch (_error) {
      // 存储不可用时只在本页生效
    }
  }, [setId]);
  return [fit, setFit];
}
