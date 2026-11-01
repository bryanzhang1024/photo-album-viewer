/** @jest-environment node */
const fs = require('fs');
const { setupMainProcess } = require('../helpers/mainProcessHarness');
const channel = 'copy-images-to-clipboard';
const originalPlatform = process.platform;
const originalRoots = process.env.PAV_TEST_APPROVED_ROOTS;

describe('批量复制原始图片文件', () => {
  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    process.env.PAV_TEST_APPROVED_ROOTS = '/photos';
    jest.spyOn(fs.promises, 'access').mockResolvedValue();
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({ isFile: () => true });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env.PAV_TEST_APPROVED_ROOTS = originalRoots;
    jest.restoreAllMocks();
    jest.resetModules();
  });
  test('一次写入三份有序原图，保留文件名，转义 plist 特殊字符，不解码图片', async () => {
    const { electron } = setupMainProcess();
    const files = ['/photos/中文 3.png', '/photos/a&b<2>.jpg', '/photos/1.jpeg'];
    const result = await electron.ipcMain.invoke(channel, files);
    expect(result).toEqual({ success: true, count: 3, filePaths: files });
    expect(electron.clipboard.writeBuffer).toHaveBeenCalledTimes(1);
    const [format, buffer] = electron.clipboard.writeBuffer.mock.calls[0];
    expect(format).toBe('NSFilenamesPboardType');
    const xml = buffer.toString('utf8');
    expect(xml).toContain('/photos/a&amp;b&lt;2&gt;.jpg');
    expect(xml.indexOf('中文 3')).toBeLessThan(xml.indexOf('a&amp;b'));
    expect(xml.indexOf('a&amp;b')).toBeLessThan(xml.indexOf('/photos/1.jpeg'));
    expect(electron.nativeImage.createFromPath).not.toHaveBeenCalled();
  });
  test('重复路径只复制一次，保持首次出现顺序', async () => {
    const { electron } = setupMainProcess();
    expect(await electron.ipcMain.invoke(channel, ['/photos/2.png', '/photos/1.jpg', '/photos/2.png']))
      .toEqual({ success: true, count: 2, filePaths: ['/photos/2.png', '/photos/1.jpg'] });
  });
  test.each([[], null, 'x', [null], ['relative.png'], ['/photos/a.txt'], ['/outside/a.png']])
  ('拒绝无效输入 %p，保留原剪贴板', async (files) => {
    const { electron } = setupMainProcess();
    expect((await electron.ipcMain.invoke(channel, files)).success).toBe(false);
    expect(electron.clipboard.clear).not.toHaveBeenCalled();
    expect(electron.clipboard.writeBuffer).not.toHaveBeenCalled();
  });
  test.each(['missing', 'directory', 'unreadable'])('%s：全部核验成功前不覆盖剪贴板', async (kind) => {
    const { electron } = setupMainProcess();
    if (kind === 'missing') fs.promises.stat.mockRejectedValueOnce(new Error('ENOENT'));
    if (kind === 'directory') fs.promises.stat.mockResolvedValueOnce({ isFile: () => false });
    if (kind === 'unreadable') fs.promises.access.mockRejectedValueOnce(new Error('EACCES'));
    expect((await electron.ipcMain.invoke(channel, ['/photos/1.png', '/photos/2.png'])).success).toBe(false);
    expect(electron.clipboard.clear).not.toHaveBeenCalled();
    expect(electron.clipboard.writeBuffer).not.toHaveBeenCalled();
  });
  test('系统写入异常返回失败，不能显示复制成功', async () => {
    const { electron } = setupMainProcess();
    electron.clipboard.writeBuffer.mockImplementation(() => { throw new Error('pasteboard write failed'); });
    expect(await electron.ipcMain.invoke(channel, ['/photos/1.png'])).toEqual({ success: false, error: 'pasteboard write failed' });
  });
  test.each(['batch', 'single'])('慢的旧请求不能覆盖后发的 %s 复制', async latestMode => {
    const { electron } = setupMainProcess();
    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const pause = new Promise(resolve => { release = resolve; });
    fs.promises.stat.mockImplementation(async file => {
      if (file === '/photos/old.png') { entered(); await pause; }
      return { isFile: () => true };
    });
    const old = electron.ipcMain.invoke(channel, ['/photos/old.png']);
    await started;
    const latest = latestMode === 'batch'
      ? await electron.ipcMain.invoke(channel, ['/photos/latest.png'])
      : await electron.ipcMain.invoke('copy-image-to-clipboard', '/photos/latest.png', 'file');
    expect(latest.success).toBe(true);
    release();
    expect((await old).success).toBe(false);
    expect(electron.clipboard.writeBuffer).toHaveBeenCalledTimes(1);
    expect(electron.clipboard.writeBuffer.mock.calls[0][1].toString()).toContain('/photos/latest.png');
  });
  test('非 macOS 不写入 macOS 格式', async () => {
    const { electron } = setupMainProcess();
    Object.defineProperty(process, 'platform', { value: 'win32' });
    expect((await electron.ipcMain.invoke(channel, ['/photos/1.png'])).success).toBe(false);
    expect(electron.clipboard.writeBuffer).not.toHaveBeenCalled();
  });
});
