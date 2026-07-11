const {
  getRootPathFlavor,
  isPortableRelativePath,
  joinPortableRelativePath,
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
});
