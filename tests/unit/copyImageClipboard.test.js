/** @jest-environment node */

const fs = require('fs');
const CHANNELS = require('../../src/common/ipc-channels');
const { setupMainProcess } = require('../helpers/mainProcessHarness');

const originalPlatform = process.platform;

const setPlatform = (platform) => {
  Object.defineProperty(process, 'platform', {
    value: platform
  });
};

describe('copy image to clipboard', () => {
  beforeEach(() => {
    jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    });
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('writes macOS file copy data as plist and avoids generic URL formats in file mode', async () => {
    setPlatform('darwin');
    const { electron } = setupMainProcess();
    const filePath = '/Volumes/1TB/Collection/600-Cos Weibo/XHS@20260405/[🌸梅梅面包机]海岸线的场照生了[9](20260412).jpeg';

    const result = await electron.ipcMain.invoke(CHANNELS.COPY_IMAGE_TO_CLIPBOARD, filePath, 'file');

    expect(result.success).toBe(true);
    expect(electron.clipboard.clear).toHaveBeenCalledTimes(1);
    expect(electron.clipboard.writeBookmark).not.toHaveBeenCalled();
    expect(electron.clipboard.writeBuffer).toHaveBeenCalledTimes(1);

    const writes = new Map(
      electron.clipboard.writeBuffer.mock.calls.map(([format, buffer]) => [format, buffer.toString('utf8')])
    );

    expect(writes.get('NSFilenamesPboardType')).toContain('<plist version="1.0">');
    expect(writes.get('NSFilenamesPboardType')).toContain(`<string>${filePath}</string>`);
    expect(writes.has('Apple URL pasteboard type')).toBe(false);
    expect(writes.has('public.file-url')).toBe(false);
    expect(writes.has('public.url')).toBe(false);
    expect(writes.has('text/uri-list')).toBe(false);
  });
});
