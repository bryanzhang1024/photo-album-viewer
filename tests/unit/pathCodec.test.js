const {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  getRootPathFlavor,
  isPortableRelativePath,
  joinPortableRelativePath,
  normalizeAbsolutePath,
  resolvePortableRelativePath,
  splitPortableRelativePath
} = require('../../src/common/path-codec');

describe('path-codec', () => {
  test.each(['', '2026', '2026/旅行/杭州', 'MixedCase/相册 01'])(
    'accepts portable relative path %p',
    (value) => expect(isPortableRelativePath(value)).toBe(true)
  );

  test.each([
    '/absolute',
    'C:/photos',
    'C:\\photos',
    'C:foo',
    'z:album',
    '\\\\server\\share',
    'a\\b',
    'a//b',
    'a/./b',
    'a/../b',
    'a/',
    'a\0b'
  ])('rejects non-portable relative path %p', (value) => {
    expect(isPortableRelativePath(value)).toBe(false);
  });

  test('joins and splits portable relative paths without changing case', () => {
    expect(joinPortableRelativePath('2026/旅行', '杭州')).toBe('2026/旅行/杭州');
    expect(joinPortableRelativePath('', 'MixedCase')).toBe('MixedCase');
    expect(splitPortableRelativePath('2026/旅行/杭州')).toEqual(['2026', '旅行', '杭州']);
  });

  test('rejects Windows drive-relative child segments when joining', () => {
    expect(() => joinPortableRelativePath('', 'C:foo')).toThrow('Invalid portable path segment');
  });

  test('detects POSIX, Windows drive, and UNC roots', () => {
    expect(getRootPathFlavor('/Volumes/Photos')).toBe('posix');
    expect(getRootPathFlavor('C:\\Photos')).toBe('win32');
    expect(getRootPathFlavor('C:/Photos')).toBe('win32');
    expect(getRootPathFlavor('\\\\server\\share\\Photos')).toBe('win32');
    expect(getRootPathFlavor('relative/root')).toBeNull();
  });

  test('normalizes POSIX, drive, and UNC absolute paths to browser-safe separators', () => {
    expect(normalizeAbsolutePath('/Photos/Trip/')).toEqual({
      absolutePath: '/Photos/Trip',
      pathFlavor: 'posix'
    });
    expect(normalizeAbsolutePath('C:\\Photos\\Trip\\')).toEqual({
      absolutePath: 'C:/Photos/Trip',
      pathFlavor: 'win32'
    });
    expect(normalizeAbsolutePath('\\\\NAS\\Share\\Trip\\')).toEqual({
      absolutePath: '//NAS/Share/Trip',
      pathFlavor: 'win32'
    });
    expect(normalizeAbsolutePath('/')).toEqual({ absolutePath: '/', pathFlavor: 'posix' });
    expect(normalizeAbsolutePath('C:\\')).toEqual({
      absolutePath: 'C:/',
      pathFlavor: 'win32'
    });
  });

  test('rejects invalid absolute paths during normalization', () => {
    for (const value of ['', 'relative/path', 'C:relative', '//server', '/Photos/../escape']) {
      expect(() => normalizeAbsolutePath(value)).toThrow(
        expect.objectContaining({ code: 'INVALID_ABSOLUTE_PATH' })
      );
    }
  });

  test('gets portable relative paths using segment boundaries', () => {
    expect(getPortableRelativePath('/Photos', '/Photos/Trip')).toBe('Trip');
    expect(getPortableRelativePath('/Photos', '/Photos')).toBe('');
    expect(getPortableRelativePath('/photos', '/photos2/trip')).toBeNull();
    expect(getPortableRelativePath('C:\\Photos', 'c:/photos/Trip')).toBe('Trip');
    expect(getPortableRelativePath('\\\\NAS\\Share', '//nas/share/Trip')).toBe('Trip');
  });

  test('preserves POSIX case sensitivity and rejects path flavor mismatches', () => {
    expect(getPortableRelativePath('/Photos', '/photos/Trip')).toBeNull();
    expect(getPortableRelativePath('/Photos', 'C:/Photos/Trip')).toBeNull();
    expect(getPortableRelativePath('C:/Photos', '//server/share/Photos/Trip')).toBeNull();
    expect(getPortableRelativePath('C:/Photos', 'D:/Photos/Trip')).toBeNull();
  });

  test('resolves portable relative paths without Node path APIs', () => {
    expect(resolvePortableRelativePath('C:/Photos', 'Trip/2026'))
      .toBe('C:/Photos/Trip/2026');
    expect(resolvePortableRelativePath('//NAS/Share', '')).toBe('//NAS/Share');
    expect(resolvePortableRelativePath('/', 'Photos/Trip')).toBe('/Photos/Trip');
    expect(() => resolvePortableRelativePath('/Photos', '../escape')).toThrow(
      expect.objectContaining({ code: 'INVALID_RELATIVE_PATH' })
    );
  });

  test('finds the unique longest nested source root', () => {
    const sources = [
      { sourceId: 'src_parent', rootPath: '/Photos' },
      { sourceId: 'src_family', rootPath: '/Photos/Family' }
    ];

    expect(findUniqueLongestSourceRoot(sources, '/Photos/Family/Trip')).toEqual({
      status: 'resolved',
      source: sources[1],
      relativePath: 'Trip'
    });
    expect(findUniqueLongestSourceRoot(sources, '/Other/Trip')).toEqual({
      status: 'notFound'
    });
  });

  test('reports ambiguous equal-length source matches instead of selecting by order', () => {
    const sources = [
      { sourceId: 'src_first', rootPath: 'C:/Photos' },
      { sourceId: 'src_second', rootPath: 'c:\\photos' }
    ];

    expect(findUniqueLongestSourceRoot(sources, 'C:/Photos/Trip')).toEqual({
      status: 'ambiguous',
      sources,
      relativePath: 'Trip'
    });
  });
});
