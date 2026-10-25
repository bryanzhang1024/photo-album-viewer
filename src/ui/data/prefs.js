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
