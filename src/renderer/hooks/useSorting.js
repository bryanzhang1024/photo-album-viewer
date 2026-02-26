import { useState, useCallback, useMemo, useEffect } from 'react';

function loadScopedSorting(
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

function persistScopedSorting(storageKey, sortBy, sortDirection) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ sortBy, sortDirection }));
  } catch (error) {
    console.warn(`保存排序配置失败(${storageKey}):`, error);
  }
}

function useSorting(initialSortBy = 'name', initialSortDirection = 'asc', options = {}) {
  const {
    scopeKey = 'global',
    storageNamespace = 'sorting',
    allowedSortBy = null,
    legacyKeys = null
  } = options;
  const normalizedScopeKey = scopeKey || '__root__';
  const storageKey = useMemo(
    () => `${storageNamespace}:${normalizedScopeKey}`,
    [storageNamespace, normalizedScopeKey]
  );
  const [sortBy, setSortBy] = useState(() =>
    loadScopedSorting(
      storageKey,
      initialSortBy,
      initialSortDirection,
      allowedSortBy,
      legacyKeys,
      normalizedScopeKey
    ).sortBy
  );
  const [sortDirection, setSortDirection] = useState(() =>
    loadScopedSorting(
      storageKey,
      initialSortBy,
      initialSortDirection,
      allowedSortBy,
      legacyKeys,
      normalizedScopeKey
    ).sortDirection
  );

  useEffect(() => {
    const loaded = loadScopedSorting(
      storageKey,
      initialSortBy,
      initialSortDirection,
      allowedSortBy,
      legacyKeys,
      normalizedScopeKey
    );
    setSortBy(loaded.sortBy);
    setSortDirection(loaded.sortDirection);
  }, [storageKey, initialSortBy, initialSortDirection, allowedSortBy, legacyKeys, normalizedScopeKey]);

  const handleSortChange = useCallback((event) => {
    const newSortBy = event.target.value;
    if (allowedSortBy && !allowedSortBy.includes(newSortBy)) {
      return;
    }
    persistScopedSorting(storageKey, newSortBy, sortDirection);
    setSortBy(newSortBy);
  }, [storageKey, sortDirection, allowedSortBy]);

  const handleDirectionChange = useCallback(() => {
    setSortDirection(prev => {
      const newDirection = prev === 'asc' ? 'desc' : 'asc';
      persistScopedSorting(storageKey, sortBy, newDirection);
      return newDirection;
    });
  }, [storageKey, sortBy]);

  return {
    sortBy,
    sortDirection,
    handleSortChange,
    handleDirectionChange
  };
}

export default useSorting;
