import { renderHook } from '@testing-library/react';
import useSorting from '../../../src/renderer/hooks/useSorting';

describe('useSorting legacy fallback behavior', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('uses default asc for non-root scope even when legacy sortDirection is desc', () => {
    localStorage.setItem('sortBy', 'name');
    localStorage.setItem('sortDirection', 'desc');

    const { result } = renderHook(() =>
      useSorting('name', 'asc', {
        scopeKey: '/photos/new-folder',
        storageNamespace: 'sorting:folder',
        allowedSortBy: ['name', 'imageCount', 'lastModified'],
        legacyKeys: { sortByKey: 'sortBy', sortDirectionKey: 'sortDirection' }
      })
    );

    expect(result.current.sortBy).toBe('name');
    expect(result.current.sortDirection).toBe('asc');
  });

  test('keeps legacy fallback for root scope', () => {
    localStorage.setItem('sortBy', 'name');
    localStorage.setItem('sortDirection', 'desc');

    const { result } = renderHook(() =>
      useSorting('name', 'asc', {
        scopeKey: '__root__',
        storageNamespace: 'sorting:folder',
        allowedSortBy: ['name', 'imageCount', 'lastModified'],
        legacyKeys: { sortByKey: 'sortBy', sortDirectionKey: 'sortDirection' }
      })
    );

    expect(result.current.sortDirection).toBe('desc');
  });
});
