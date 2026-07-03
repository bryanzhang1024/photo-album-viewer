import {
  loadFolderSortPreference,
  loadScopedSorting,
  getFolderSortScopeKey,
  compareByFolderSort,
  LEGACY_FOLDER_SORT_KEYS,
  FOLDER_SORT_FIELDS
} from '../../../src/renderer/utils/sortPreference';

describe('sortPreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('getFolderSortScopeKey falls back to rootPath before __root__', () => {
    expect(getFolderSortScopeKey('', '/photos/root')).toBe('/photos/root');
    expect(getFolderSortScopeKey('/photos/set', '/photos/root')).toBe('/photos/set');
    expect(getFolderSortScopeKey('', '')).toBe('__root__');
  });

  test('compareByFolderSort uses path as tie-breaker for same name', () => {
    const left = { name: 'Album', path: '/photos/a', imageCount: 1, lastModified: 0 };
    const right = { name: 'Album', path: '/photos/b', imageCount: 1, lastModified: 0 };

    expect(compareByFolderSort(left, right, 'name', 'asc')).toBeLessThan(0);
    expect(compareByFolderSort(right, left, 'name', 'asc')).toBeGreaterThan(0);
  });

  test('compareByFolderSort supports count fallback for display items', () => {
    expect(
      compareByFolderSort(
        { name: 'A', path: '/a', count: 2 },
        { name: 'B', path: '/b', count: 5 },
        'imageCount',
        'asc'
      )
    ).toBeLessThan(0);
  });

  test('loadFolderSortPreference uses default asc for non-root scope without scoped config', () => {
    localStorage.setItem('sortBy', 'name');
    localStorage.setItem('sortDirection', 'desc');

    expect(loadFolderSortPreference('/photos/new-folder')).toEqual({
      sortBy: 'name',
      sortDirection: 'asc'
    });
  });

  test('loadFolderSortPreference keeps legacy fallback for root scope', () => {
    localStorage.setItem('sortBy', 'name');
    localStorage.setItem('sortDirection', 'desc');

    expect(loadFolderSortPreference('')).toEqual({
      sortBy: 'name',
      sortDirection: 'desc'
    });
  });

  test('loadFolderSortPreference reads scoped folder config when present', () => {
    localStorage.setItem(
      'sorting:folder:/photos/set',
      JSON.stringify({ sortBy: 'lastModified', sortDirection: 'desc' })
    );

    expect(loadFolderSortPreference('/photos/set')).toEqual({
      sortBy: 'lastModified',
      sortDirection: 'desc'
    });
  });

  test('loadScopedSorting rejects invalid scoped values and falls back to defaults', () => {
    localStorage.setItem(
      'sorting:folder:/photos/set',
      JSON.stringify({ sortBy: 'invalid', sortDirection: 'desc' })
    );

    expect(
      loadScopedSorting(
        'sorting:folder:/photos/set',
        'name',
        'asc',
        FOLDER_SORT_FIELDS,
        LEGACY_FOLDER_SORT_KEYS,
        '/photos/set'
      )
    ).toEqual({
      sortBy: 'name',
      sortDirection: 'asc'
    });
  });
});
