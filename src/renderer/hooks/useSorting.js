import { useState, useCallback, useMemo, useEffect } from 'react';
import { loadScopedSorting, persistScopedSorting } from '../utils/sortPreference';

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
