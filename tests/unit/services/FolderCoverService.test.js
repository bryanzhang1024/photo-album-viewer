/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createFolderCoverService } = require('../../../src/main/services/FolderCoverService');

function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-cover-'));
  for (const relative of spec) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');
  }
  return root;
}

describe('FolderCoverService', () => {
  test('容器文件夹会向下找到图片，返回相对来源根的路径', async () => {
    const root = makeTree([
      '容器/第一层/第二层/a.jpg',
      '容器/第一层/第二层/b.png',
      '容器/第一层/c.webp'
    ]);
    const service = createFolderCoverService();

    const result = await service.findCover(root, '容器');
    expect(result.samples.length).toBeGreaterThan(0);
    for (const sample of result.samples) {
      expect(sample.startsWith('容器/')).toBe(true);
    }
    expect(result.samples).toEqual(expect.arrayContaining(['容器/第一层/c.webp']));
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('跳过点开头的目录与非图片文件', async () => {
    const root = makeTree([
      '容器/.隐藏/secret.jpg',
      '容器/可见/ok.jpg',
      '容器/说明.txt'
    ]);
    const service = createFolderCoverService();

    const result = await service.findCover(root, '容器');
    expect(result.samples).toEqual(['容器/可见/ok.jpg']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('预算内凑够数量就停，不会扫穿整棵树', async () => {
    const spec = [];
    for (let i = 0; i < 30; i += 1) spec.push(`巨大/目录${String(i).padStart(2, '0')}/图${i}.jpg`);
    const root = makeTree(spec);
    let readdirCalls = 0;
    const service = createFolderCoverService({
      fsApi: {
        readdir: (...args) => {
          readdirCalls += 1;
          return fs.promises.readdir(...args);
        }
      },
      maxDirs: 5,
      maxSamples: 4
    });

    const result = await service.findCover(root, '巨大');
    expect(result.samples.length).toBeLessThanOrEqual(4);
    expect(readdirCalls).toBeLessThanOrEqual(5);
    expect(result.truncated).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('同一目录第二次调用走缓存，不再读盘', async () => {
    const root = makeTree(['容器/子/a.jpg']);
    let readdirCalls = 0;
    const service = createFolderCoverService({
      fsApi: {
        readdir: (...args) => {
          readdirCalls += 1;
          return fs.promises.readdir(...args);
        }
      }
    });

    const first = await service.findCover(root, '容器');
    const callsAfterFirst = readdirCalls;
    const second = await service.findCover(root, '容器');
    expect(second).toEqual(first);
    expect(readdirCalls).toBe(callsAfterFirst);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('目录不存在时返回空样本而不是抛错', async () => {
    const service = createFolderCoverService();
    await expect(service.findCover('/tmp/pav-not-exist-xyz', '子')).resolves.toMatchObject({
      samples: []
    });
  });
});
