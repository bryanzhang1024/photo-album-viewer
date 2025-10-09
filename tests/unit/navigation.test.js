import {
  normalizeTargetPath,
  buildBrowseUrl,
  withLastPathTracking,
  getLastPath,
  setLastPath,
  clearLastPath
} from '../../src/renderer/utils/navigation';

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
