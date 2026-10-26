const DEFAULT_VIEW = 'grid';
const DEFAULT_SORT_FIELD = 'name';

const SORT_DEFAULT_DIRECTION = {
  name: 'asc',
  imageCount: 'desc',
  childCount: 'desc',
  size: 'desc',
  mtimeMs: 'desc'
};

const viewKey = (sourceId, relativePath) => `pav.view.v1:${sourceId}:${relativePath}`;
const sortKey = (sourceId, relativePath) => `pav.sort.v1:${sourceId}:${relativePath}`;

export function defaultSortDirection(field) {
  return SORT_DEFAULT_DIRECTION[field] || 'asc';
}

export function getFolderView(sourceId, relativePath, fallback = DEFAULT_VIEW) {
  try {
    return window.localStorage.getItem(viewKey(sourceId, relativePath)) || fallback;
  } catch (_error) {
    return fallback;
  }
}

export function setFolderView(sourceId, relativePath, viewMode) {
  try {
    window.localStorage.setItem(viewKey(sourceId, relativePath), viewMode);
  } catch (_error) {
    // 存储不可用时退回全局状态
  }
}

/** 返回 { field, direction }；兼容早期只存字段名的旧值。 */
export function getFolderSort(sourceId, relativePath) {
  const fallback = { field: DEFAULT_SORT_FIELD, direction: defaultSortDirection(DEFAULT_SORT_FIELD) };
  try {
    const raw = window.localStorage.getItem(sortKey(sourceId, relativePath));
    if (!raw) return fallback;
    if (raw.startsWith('{')) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.field === 'string') {
        return {
          field: parsed.field,
          direction: parsed.direction === 'desc' ? 'desc' : 'asc'
        };
      }
      return fallback;
    }
    // 旧格式：只存字段名
    return { field: raw, direction: defaultSortDirection(raw) };
  } catch (_error) {
    return fallback;
  }
}

export function setFolderSort(sourceId, relativePath, sort) {
  try {
    const payload = typeof sort === 'string'
      ? { field: sort, direction: defaultSortDirection(sort) }
      : { field: sort.field, direction: sort.direction === 'desc' ? 'desc' : 'asc' };
    window.localStorage.setItem(sortKey(sourceId, relativePath), JSON.stringify(payload));
  } catch (_error) {
    // 存储不可用时只在本页生效
  }
}

const densityKey = (sourceId, relativePath) => `pav.density.v1:${sourceId}:${relativePath}`;

/** 缩略图密度三档：文件夹页与 Cos 页共用同一份尺寸定义。 */
export const DENSITY_LEVELS = [
  { key: 'compact', minWidth: 148 },
  { key: 'standard', minWidth: 168 },
  { key: 'comfortable', minWidth: 196 }
];

/**
 * 缺省档位：紧凑（148）。
 * 2026-10-26 用户拍板「默认密度跟照片来源保持一致」，即保持照片来源当前观感；
 * 4.4.1 之前靠 Number(null) === 0 恰好落到这一档，现在改为显式返回，行为不变。
 */
export const DEFAULT_DENSITY = 0;
export const DEFAULT_MIN_ITEM_WIDTH = DENSITY_LEVELS[DEFAULT_DENSITY].minWidth;

export function getFolderDensity(sourceId, relativePath) {
  try {
    const raw = window.localStorage.getItem(densityKey(sourceId, relativePath));
    if (raw === null) return DEFAULT_DENSITY;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 2 ? value : DEFAULT_DENSITY;
  } catch (_error) {
    return DEFAULT_DENSITY;
  }
}

export function setFolderDensity(sourceId, relativePath, density) {
  try {
    window.localStorage.setItem(densityKey(sourceId, relativePath), String(density));
  } catch (_error) {
    // 存储不可用时只在本页生效
  }
}
