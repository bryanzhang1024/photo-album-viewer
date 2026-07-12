import {
  normalizeTargetPath,
  buildNavigationTargetUrl,
  parseBrowseLocation
} from '../../src/renderer/utils/navigation';

const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

describe('navigation helpers', () => {
  describe('normalizeTargetPath', () => {
    test('ensures POSIX-style leading slash', () => {
      expect(normalizeTargetPath('foo/bar')).toBe('/foo/bar');
      expect(normalizeTargetPath('/foo/bar')).toBe('/foo/bar');
    });

    test('preserves Windows absolute paths', () => {
      expect(normalizeTargetPath('C:/Users/test')).toBe('C:/Users/test');
    });

    test('normalizes Windows drive root path', () => {
      expect(normalizeTargetPath('C:')).toBe('C:/');
    });

    test('returns empty string for falsy input', () => {
      expect(normalizeTargetPath('')).toBe('');
      expect(normalizeTargetPath()).toBe('');
    });
  });

  describe('canonical navigation targets', () => {
    const target = {
      sourceId: SOURCE_ID,
      relativePath: '2026/旅行',
      viewMode: 'photoSet',
      initialMediaRelativePath: '2026/旅行/001.jpg'
    };

    test('builds a canonical /browse query without an absolute locator', () => {
      const url = buildNavigationTargetUrl(target);

      expect(url).toBe(
        `/browse?sourceId=${SOURCE_ID}`
        + '&relativePath=2026%2F%E6%97%85%E8%A1%8C'
        + '&view=photoSet'
        + '&image=2026%2F%E6%97%85%E8%A1%8C%2F001.jpg'
      );
      const params = new URLSearchParams(url.split('?')[1]);
      expect([...params.keys()]).toEqual(['sourceId', 'relativePath', 'view', 'image']);
      expect(url).not.toMatch(/rootPath|title|Volumes|%2FVolumes/);
    });

    test('parses canonical query fields back into a directory BrowserLocation', () => {
      const url = buildNavigationTargetUrl(target);
      const [pathname, search] = url.split('?');

      expect(parseBrowseLocation(pathname, `?${search}`)).toEqual({
        kind: 'directory',
        target
      });
    });

    test('treats an explicitly empty relativePath as the canonical source root', () => {
      expect(parseBrowseLocation(
        '/browse',
        `?sourceId=${SOURCE_ID}&relativePath=&view=browse`
      )).toEqual({
        kind: 'directory',
        target: {
          sourceId: SOURCE_ID,
          relativePath: '',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }
      });
    });

    test.each([
      ['invalid source id', { sourceId: 'not-a-source-id' }],
      ['parent traversal relative path', { relativePath: '../escape' }],
      ['absolute relative path', { relativePath: '/escape' }],
      ['backslash relative path', { relativePath: '2026\\escape' }],
      ['absolute initial media', { initialMediaRelativePath: '/etc/passwd' }],
      ['traversal initial media', { initialMediaRelativePath: '2026/../escape.jpg' }],
      ['backslash initial media', { initialMediaRelativePath: '2026\\escape.jpg' }],
      ['empty initial media', { initialMediaRelativePath: '' }],
      ['media equal to target directory', { initialMediaRelativePath: '2026/旅行' }],
      ['sibling initial media', { initialMediaRelativePath: '2026/其他/escape.jpg' }],
      ['prefix-sibling initial media', { initialMediaRelativePath: '2026/旅行2/escape.jpg' }],
      ['legacy view mode', { viewMode: 'album' }]
    ])('refuses to build a canonical URL with %s', (_name, overrides) => {
      expect(() => buildNavigationTargetUrl({ ...target, ...overrides })).toThrow(TypeError);
    });

    test.each([
      ['invalid source id', { sourceId: 'not-a-source-id' }],
      ['parent traversal relative path', { relativePath: '../escape' }],
      ['absolute relative path', { relativePath: '/escape' }],
      ['backslash relative path', { relativePath: '2026\\escape' }],
      ['absolute initial media', { image: '/etc/passwd' }],
      ['traversal initial media', { image: '2026/../escape.jpg' }],
      ['backslash initial media', { image: '2026\\escape.jpg' }],
      ['empty initial media', { image: '' }],
      ['media equal to target directory', { image: '2026/Trip' }],
      ['sibling initial media', { image: '2026/Other/escape.jpg' }],
      ['prefix-sibling initial media', { image: '2026/Trip2/escape.jpg' }],
      ['legacy view name', { view: 'album' }],
      ['unknown view', { view: 'grid' }]
    ])('rejects a canonical query with %s', (_name, overrides) => {
      const values = {
        sourceId: SOURCE_ID,
        relativePath: '2026/Trip',
        view: 'browse',
        ...overrides
      };
      const search = `?${new URLSearchParams(values).toString()}`;

      expect(parseBrowseLocation('/browse', search)).toBeNull();
    });
  });

  describe('browse route parsing', () => {
    test('drops an encoded absolute route instead of restoring legacy navigation', () => {
      expect(parseBrowseLocation(
        '/browse/%2FPhotos%2FTrip',
        '?view=album&image=%2FPhotos%2FTrip%2F001.jpg'
      )).toEqual({ kind: 'landing' });
    });

    test.each([
      ['/', '', { kind: 'landing' }],
      ['/favorites', '', { kind: 'favorites' }],
      ['/browse', '', { kind: 'landing' }],
      ['/browse', `?sourceId=${SOURCE_ID}`, { kind: 'landing' }]
    ])('parses non-directory location %s%s', (pathname, search, expected) => {
      expect(parseBrowseLocation(pathname, search)).toEqual(expected);
    });

    test('leaves the old /album route outside this helper', () => {
      expect(parseBrowseLocation('/album/%2FPhotos%2FTrip', '')).toBeNull();
    });
  });

});
