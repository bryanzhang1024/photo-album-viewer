const fs = require('fs');
const os = require('os');
const path = require('path');
const { listDirectoryFiles } = require('../../src/main/services/FileSystemService');

describe('listDirectoryFiles', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-files-'));
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'img');
    fs.writeFileSync(path.join(dir, 'b.mp4'), 'video');
    fs.writeFileSync(path.join(dir, 'c.zip'), 'archive');
    fs.writeFileSync(path.join(dir, 'd.txt'), 'text');
    fs.writeFileSync(path.join(dir, '.hidden.mp4'), 'hidden');
    fs.mkdirSync(path.join(dir, 'sub'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('只返回当前层的非图片、非隐藏文件，并带类型', async () => {
    const files = await listDirectoryFiles(dir);
    const names = files.map((file) => file.name);
    expect(names).toEqual(['b.mp4', 'c.zip', 'd.txt']);
    const byName = Object.fromEntries(files.map((file) => [file.name, file]));
    expect(byName['b.mp4'].kind).toBe('video');
    expect(byName['c.zip'].kind).toBe('archive');
    expect(byName['d.txt'].kind).toBe('document');
    expect(byName['b.mp4'].size).toBeGreaterThan(0);
    expect(Number.isFinite(byName['b.mp4'].mtimeMs)).toBe(true);
  });

  it('目录不存在时抛错，由调用方转成可读提示', async () => {
    await expect(listDirectoryFiles(path.join(dir, 'missing'))).rejects.toThrow();
  });
});
