import {
  normalizeTargetPath,
  buildBrowseUrl,
  buildNavigationTargetUrl,
  parseBrowseLocation,
  withLastPathTracking,
  getLastPath,
  setLastPath,
  clearLastPath
} from '../../src/renderer/utils/navigation';

const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

describe('navigation helpers', () => {
  beforeEach(() => {
    clearLastPath();
    jest.clearAllMocks();
  });

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

  describe('buildBrowseUrl', () => {
    test('builds base browse url when no target', () => {
      expect(buildBrowseUrl('', 'folder')).toBe('/browse');
    });

    test('encodes folder target path', () => {
      expect(buildBrowseUrl('/photos', 'folder')).toBe('/browse/%2Fphotos');
    });

    test('appends view and image params for album', () => {
      expect(buildBrowseUrl('/photos', 'album', 'cover.jpg')).toBe(
        '/browse/%2Fphotos?view=album&image=cover.jpg'
      );
    });

    test.each([
      [
        'C:\\Photos\\Trip',
        'folder',
        null,
        '/browse/C%3A%2FPhotos%2FTrip'
      ],
      [
        '\\\\NAS\\Photos\\Trip',
        'folder',
        null,
        '/browse/%2F%2FNAS%2FPhotos%2FTrip'
      ],
      [
        '/Photos/Trip',
        'album',
        '/Photos/Trip/001.jpg',
        '/browse/%2FPhotos%2FTrip?view=album&image=%252FPhotos%252FTrip%252F001.jpg'
      ]
    ])('keeps legacy URL output stable for %s', (targetPath, viewMode, image, expected) => {
      expect(buildBrowseUrl(targetPath, viewMode, image)).toBe(expected);
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
        + '&view=album'
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
        `?sourceId=${SOURCE_ID}&relativePath=&view=folder`
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
  });

  describe('browse route parsing', () => {
    test('parses the existing encoded absolute route and its double-encoded image', () => {
      const legacyUrl = buildBrowseUrl(
        '/Photos/Trip',
        'album',
        '/Photos/Trip/001.jpg'
      );
      const [pathname, search] = legacyUrl.split('?');

      expect(parseBrowseLocation(pathname, `?${search}`)).toEqual({
        kind: 'legacyAbsolute',
        legacyAbsolutePath: '/Photos/Trip',
        viewMode: 'album',
        legacyInitialMediaPath: '/Photos/Trip/001.jpg'
      });
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

  describe('last path tracking', () => {
    test('stores normalized paths', () => {
      setLastPath('foo');
      expect(getLastPath()).toBe('/foo');

      setLastPath('/bar/baz');
      expect(getLastPath()).toBe('/bar/baz');
    });

    test('clears storage on empty input', () => {
      setLastPath('');
      expect(getLastPath()).toBe('');
    });
  });

  describe('withLastPathTracking', () => {
    test('wraps navigate function and records last path', () => {
      const spy = jest.fn();
      const trackedNavigate = withLastPathTracking(spy);

      trackedNavigate('gallery/2024', { viewMode: 'folder' });
      expect(getLastPath()).toBe('/gallery/2024');
      expect(spy).toHaveBeenCalledWith('/browse/%2Fgallery%2F2024', {});

      trackedNavigate('/gallery/2025', {
        viewMode: 'album',
        initialImage: '001.jpg',
        state: { from: 'test' }
      });
      expect(getLastPath()).toBe('/gallery/2025');
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith(
        '/browse/%2Fgallery%2F2025?view=album&image=001.jpg',
        { state: { from: 'test' } }
      );
    });

    test('throws when navigateFn is missing', () => {
      expect(() => withLastPathTracking()).toThrow('navigateFn is required');
    });
  });
});
