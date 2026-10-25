const DEFAULT_VIEW = 'grid';
const DEFAULT_SORT = 'name';

const viewKey = (sourceId, relativePath) => `pav.view.v1:${sourceId}:${relativePath}`;
const sortKey = (sourceId, relativePath) => `pav.sort.v1:${sourceId}:${relativePath}`;

export function getFolderView(sourceId, relativePath) {
  try {
    return window.localStorage.getItem(viewKey(sourceId, relativePath)) || DEFAULT_VIEW;
  } catch (_error) {
    return DEFAULT_VIEW;
  }
}

export function setFolderView(sourceId, relativePath, viewMode) {
  try {
    window.localStorage.setItem(viewKey(sourceId, relativePath), viewMode);
  } catch (_error) {
    // 存储不可用时退回全局状态
  }
}

export function getFolderSort(sourceId, relativePath) {
  try {
    return window.localStorage.getItem(sortKey(sourceId, relativePath)) || DEFAULT_SORT;
  } catch (_error) {
    return DEFAULT_SORT;
  }
}

export function setFolderSort(sourceId, relativePath, field) {
  try {
    window.localStorage.setItem(sortKey(sourceId, relativePath), field);
  } catch (_error) {
    // 存储不可用时只在本页生效
  }
}
