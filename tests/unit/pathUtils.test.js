import { isValidPath } from '../../src/renderer/utils/pathUtils';

describe('pathUtils.isValidPath', () => {
  test('accepts Windows absolute paths', () => {
    expect(isValidPath('C:\\Users\\clover\\Photos')).toBe(true);
  });

  test('rejects additional colon in Windows path body', () => {
    expect(isValidPath('C:\\Users\\clover\\bad:path')).toBe(false);
  });

  test('accepts Unix paths containing colon', () => {
    expect(isValidPath('/tmp/photos:2026')).toBe(true);
  });
});
