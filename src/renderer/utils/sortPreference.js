export const FOLDER_SORT_FIELDS = ['name', 'imageCount', 'lastModified'];
export const LEGACY_FOLDER_SORT_KEYS = {
  sortByKey: 'sortBy',
  sortDirectionKey: 'sortDirection'
};

export function getFolderSortScopeKey(folderPath, rootPath = '') {
  return folderPath || rootPath || '__root__';
}

export function loadScopedSorting(
  storageKey,
  initialSortBy,
  initialSortDirection,
  allowedSortBy = null,
  legacyKeys = null,
  scopeKey = '__root__'
) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const storedSortBy = parsed?.sortBy;
      const storedDirection = parsed?.sortDirection;
      const isValidSortBy = !allowedSortBy || allowedSortBy.includes(storedSortBy);
      const isValidDirection = storedDirection === 'asc' || storedDirection === 'desc';

      if (isValidSortBy && isValidDirection) {
        return {
          sortBy: storedSortBy,
          sortDirection: storedDirection
        };
      }
    }
  } catch (error) {
    console.warn(`读取排序配置失败(${storageKey}):`, error);
  }

  // 兼容旧版全局排序键时，仅在根作用域应用回退；
  // 非根路径应使用当前页面默认值（通常为 asc），避免新目录继承历史倒序。
  if (legacyKeys && scopeKey === '__root__') {
    const legacySortBy = localStorage.getItem(legacyKeys.sortByKey);
    const legacyDirection = localStorage.getItem(legacyKeys.sortDirectionKey);
    const isValidLegacySortBy = !allowedSortBy || allowedSortBy.includes(legacySortBy);
    const isValidLegacyDirection = legacyDirection === 'asc' || legacyDirection === 'desc';

    if (isValidLegacySortBy && isValidLegacyDirection) {
      return {
        sortBy: legacySortBy,
        sortDirection: legacyDirection
      };
    }
  }

  return {
    sortBy: initialSortBy,
    sortDirection: initialSortDirection
  };
}

export function loadFolderSortPreference(parentPath, rootPath = '') {
  const scopeKey = getFolderSortScopeKey(parentPath, rootPath);
  const storageKey = `sorting:folder:${scopeKey}`;

  return loadScopedSorting(
    storageKey,
    'name',
    'asc',
    FOLDER_SORT_FIELDS,
    LEGACY_FOLDER_SORT_KEYS,
    scopeKey
  );
}

export function persistScopedSorting(storageKey, sortBy, sortDirection) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ sortBy, sortDirection }));
  } catch (error) {
    console.warn(`保存排序配置失败(${storageKey}):`, error);
  }
}
