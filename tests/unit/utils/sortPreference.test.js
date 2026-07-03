import {
  loadFolderSortPreference,
  loadScopedSorting,
  LEGACY_FOLDER_SORT_KEYS,
  FOLDER_SORT_FIELDS
} from '../../../src/renderer/utils/sortPreference';

describe('sortPreference', () => {
  beforeEach(() => {
    localStorage.clear();
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
