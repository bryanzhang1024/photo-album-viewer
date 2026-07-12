const path = require('path');

const {
  LEGACY_NAVIGATION_FILES,
  resetLegacyNavigationFiles
} = require('../../../src/main/services/NavigationStateCutover');

describe('NavigationStateCutover', () => {
  test('removes only legacy navigation files from userData', async () => {
    const rm = jest.fn().mockResolvedValue(undefined);
    const userDataPath = '/state/photo-album-viewer';

    const result = await resetLegacyNavigationFiles(userDataPath, { rm });

    expect(result).toEqual({ removed: [...LEGACY_NAVIGATION_FILES], failed: [] });
    expect(rm.mock.calls).toEqual(LEGACY_NAVIGATION_FILES.map((fileName) => [
      path.join(userDataPath, fileName),
      { force: true }
    ]));
    expect(rm).not.toHaveBeenCalledWith(
      path.join(userDataPath, 'favorites.json'),
      expect.anything()
    );
  });

  test('continues after a cleanup failure and reports the failed file', async () => {
    const error = new Error('permission denied');
    const rm = jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);

    const result = await resetLegacyNavigationFiles('/state', { rm });

    expect(result.removed).toEqual([LEGACY_NAVIGATION_FILES[1]]);
    expect(result.failed).toEqual([{ fileName: LEGACY_NAVIGATION_FILES[0], error }]);
    expect(rm).toHaveBeenCalledTimes(LEGACY_NAVIGATION_FILES.length);
  });
});
