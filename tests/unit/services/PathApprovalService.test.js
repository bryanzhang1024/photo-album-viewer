/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createPathApprovalService,
  isFilesystemRootPath
} = require('../../../src/main/services/PathApprovalService');

function makeService() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-approve-'));
  const service = createPathApprovalService({
    rootsFilePath: path.join(dir, 'approved-roots.json'),
    logger: { log: () => {}, warn: () => {} }
  });
  return { dir, service };
}

describe('PathApprovalService', () => {
  test('白名单为空时默认拒绝，也不允许只读入口自己登记', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'unauth-'));
    fs.writeFileSync(path.join(root, 'secret.jpg'), 'x');

    expect(await service.assert(path.join(root, 'secret.jpg'))).toBe(false);
    expect(await service.isWithin(path.join(root, 'secret.jpg'))).toBe(false);
  });

  test('登记后，根内文件与子目录放行，根外拒绝', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'photos-'));
    const sub = path.join(root, '套图');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, '1.jpg'), 'x');
    const outside = fs.mkdtempSync(path.join(dir, 'outside-'));
    fs.writeFileSync(path.join(outside, 'no.jpg'), 'x');

    expect(await service.register(root)).toBe(true);
    expect(await service.isWithin(path.join(sub, '1.jpg'))).toBe(true);
    expect(await service.isWithin(root)).toBe(true);
    expect(await service.isWithin(path.join(outside, 'no.jpg'))).toBe(false);
  });

  test('用 .. 跳出根目录会被拒绝', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'photos-'));
    fs.writeFileSync(path.join(dir, 'secret.jpg'), 'x');
    await service.register(root);

    expect(await service.isWithin(path.join(root, '..', 'secret.jpg'))).toBe(false);
    expect(await service.assert(path.join(root, '..', 'secret.jpg'))).toBe(false);
  });

  test('前缀相似但实际不同的目录不会被误放行', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'tmp-'));
    const lookalike = `${root}-other`;
    fs.mkdirSync(lookalike);
    fs.writeFileSync(path.join(lookalike, 'x.jpg'), 'x');
    await service.register(root);

    expect(await service.isWithin(path.join(lookalike, 'x.jpg'))).toBe(false);
    // 带尾斜杠的根写法也应该正常工作
    expect(await service.isWithin(`${root}/`)).toBe(true);
  });

  test('符号链接指向根外时被拒绝（按 realpath 判断）', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'photos-'));
    const outside = fs.mkdtempSync(path.join(dir, 'outside-'));
    fs.writeFileSync(path.join(outside, 'secret.jpg'), 'x');
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
      linked = true;
    } catch (_error) {
      linked = false;
    }
    if (!linked) return; // 文件系统不支持软链接时跳过

    await service.register(root);
    expect(await service.isWithin(path.join(root, 'link', 'secret.jpg'))).toBe(false);
  });

  test('bootstrapWhenEmpty 只给用户主动选择目录的入口用', async () => {
    const { dir, service } = makeService();
    const chosen = fs.mkdtempSync(path.join(dir, 'chosen-'));

    expect(await service.assert(chosen, { bootstrapWhenEmpty: true })).toBe(true);
    expect(await service.isWithin(path.join(chosen))).toBe(true);
  });

  test('移除根之后立刻失效', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'photos-'));
    fs.writeFileSync(path.join(root, '1.jpg'), 'x');

    await service.register(root);
    expect(await service.isWithin(path.join(root, '1.jpg'))).toBe(true);

    await service.unregister(root);
    expect(await service.isWithin(path.join(root, '1.jpg'))).toBe(false);
  });

  test('登记与移除会持久化，重建服务后仍生效', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'photos-'));
    await service.register(root);

    const reopened = createPathApprovalService({
      rootsFilePath: path.join(dir, 'approved-roots.json'),
      logger: { log: () => {}, warn: () => {} }
    });
    await reopened.load();
    expect(await reopened.isWithin(root)).toBe(true);
  });

  test('不存在的路径不会被放行', async () => {
    const { dir, service } = makeService();
    const root = fs.mkdtempSync(path.join(dir, 'photos-'));
    await service.register(root);
    expect(await service.isWithin(path.join(root, '不存在.jpg'))).toBe(false);
  });
});

describe('PathApprovalService · 整盘根', () => {
  test('识别整盘根目录', () => {
    expect(isFilesystemRootPath('/')).toBe(true);
    expect(isFilesystemRootPath('/Volumes')).toBe(false);
    expect(isFilesystemRootPath('/Users/clover')).toBe(false);
    expect(isFilesystemRootPath('relative/path')).toBe(false);
  });

  test('旧白名单里存了 / 也会在读入时被丢掉并回写', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-approve-root-'));
    const rootsFile = path.join(dir, 'approved-roots.json');
    fs.writeFileSync(rootsFile, JSON.stringify({ roots: ['/', '/Volumes'] }));

    const service = createPathApprovalService({
      rootsFilePath: rootsFile,
      logger: { log: () => {}, warn: () => {} }
    });
    await service.load();

    expect(await service.isWithin('/tmp')).toBe(false);
    const stored = JSON.parse(fs.readFileSync(rootsFile, 'utf8'));
    expect(stored.roots).not.toContain('/');
    expect(stored.roots).toContain('/Volumes');
  });
});
