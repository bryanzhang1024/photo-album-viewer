/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CosLibraryService } = require('../../src/main/services/CosLibraryService');

describe('CosLibraryService', () => {
  let fixturePath;
  let rootPath;
  let configPath;
  let cachePath;

  beforeEach(() => {
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-library-'));
    rootPath = path.join(fixturePath, 'library');
    configPath = path.join(fixturePath, 'config', 'roots.json');
    cachePath = path.join(fixturePath, 'cache', 'catalog.json');
    const setPath = path.join(rootPath, 'set-one');
    fs.mkdirSync(setPath, { recursive: true });
    fs.writeFileSync(path.join(setPath, 'cosset.json'), JSON.stringify({
      schema: 'cosset/1',
      id: 'set-one',
      display_name: 'Alice｜初音未来·兔子洞',
      cosers: ['Alice'],
      characters: ['初音未来'],
      looks: ['兔子洞'],
      works: ['VOCALOID'],
      themes: [],
      type: '角色Cos'
    }));
    fs.writeFileSync(path.join(setPath, '01.jpg'), 'image');
  });

  afterEach(() => {
    fs.rmSync(fixturePath, { recursive: true, force: true });
  });

  test('serves a usable cached index before the online refresh finishes', async () => {
    const seeded = new CosLibraryService({ configPath, cachePath });
    await seeded.initialize();
    await seeded.addRoot(rootPath);
    const service = new CosLibraryService({ configPath, cachePath });
    let finish;
    jest.spyOn(service, 'refresh').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let ready = false;
    const initialization = service.initialize().then(status => { ready = true; return status; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(ready).toBe(true);
    expect(service.listSets({}).total).toBe(1);
    finish?.({ ok: true });
    await initialization;
  });

  test('supplies runtime favorite paths and cover previews without persisting absolute paths in the catalog cache', async () => {
    const service = new CosLibraryService({ configPath, cachePath });
    await service.initialize();
    await service.addRoot(rootPath);
    const before = fs.readFileSync(cachePath, 'utf8');
    const list = service.listSets({});
    const expected = [{ path: path.join(rootPath, 'set-one'), online: true,
      previewImagePath: path.join(rootPath, 'set-one', '01.jpg') }];
    expect(list.items[0].favoriteTargets).toEqual(expected);
    expect(service.getSet('set-one').favoriteTargets).toEqual(expected);
    expect(fs.readFileSync(cachePath, 'utf8')).toBe(before);
    expect(before).not.toContain(rootPath);

    fs.renameSync(rootPath, `${rootPath}-offline`);
    const restored = new CosLibraryService({ configPath, cachePath });
    await restored.initialize();
    expect(restored.getSet('set-one').favoriteTargets).toEqual([
      { path: path.join(rootPath, 'set-one'), online: false, previewImagePath: null }
    ]);
  });

  test('persists roots and a path-free cache, then keeps cached sets when the root is offline', async () => {
    const service = new CosLibraryService({ configPath, cachePath, now: () => 1234 });
    await service.initialize();
    expect(service.getStatus()).toMatchObject({ state: 'empty', roots: [] });

    const added = await service.addRoot(rootPath);
    expect(added).toMatchObject({ state: 'ready', summary: { setCount: 1 } });
    expect(added.roots[0]).toMatchObject({ label: 'library', status: 'online' });
    expect(added.roots[0]).not.toHaveProperty('path');
    expect(service.listCharacters().items[0]).toMatchObject({ name: '初音未来', setCount: 1 });
    expect(await service.resolveSetAlbumPath('set-one')).toBe(path.join(rootPath, 'set-one'));

    const cacheContents = fs.readFileSync(cachePath, 'utf8');
    expect(cacheContents).not.toContain(rootPath);
    expect(cacheContents.startsWith('{"version":2')).toBe(true);

    fs.renameSync(rootPath, `${rootPath}-offline`);
    const restored = new CosLibraryService({ configPath, cachePath, now: () => 5678 });
    await restored.initialize();

    expect(restored.getStatus()).toMatchObject({
      state: 'partial',
      summary: { setCount: 1 },
      roots: [{ label: 'library', status: 'offline' }]
    });
    expect(restored.listSets({ characterId: 'character:初音未来' }).total).toBe(1);
    expect(restored.getSet('set-one')).toMatchObject({ status: 'offline' });
    expect(await restored.resolveSetAlbumPath('set-one')).toBeNull();
    await expect(restored.refresh()).resolves.toMatchObject({ ok: false, code: 'OFFLINE_ROOTS' });
  });

  test('removes a configured root and clears the catalog when none remain', async () => {
    const service = new CosLibraryService({ configPath, cachePath });
    await service.initialize();
    const status = await service.addRoot(rootPath);
    const removed = await service.removeRoot(status.roots[0].id);

    expect(removed).toMatchObject({ state: 'empty', roots: [], summary: { setCount: 0 } });
    expect(service.listSets().total).toBe(0);
  });

  test('disambiguates configured roots that share the same folder name', async () => {
    const firstRoot = path.join(fixturePath, 'Collection', 'library');
    const secondRoot = path.join(fixturePath, 'CosPool', 'library');
    fs.mkdirSync(firstRoot, { recursive: true });
    fs.mkdirSync(secondRoot, { recursive: true });

    const service = new CosLibraryService({ configPath, cachePath });
    await service.initialize();
    await service.addRoot(firstRoot);
    const status = await service.addRoot(secondRoot);

    expect(status.roots.map((root) => root.label)).toEqual([
      'library · Collection',
      'library · CosPool'
    ]);
  });

  test('旧版共享快照迁移时，判断副本是否存在不解析它', async () => {
    const crypto = require('crypto');
    const rootId = `root:${crypto.createHash('sha1').update(rootPath).digest('hex')}`;

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      roots: [{ id: rootId, path: rootPath, label: 'library' }]
    }));
    // 旧版共享快照：有 catalog、没有 rootCatalogs，会走迁移分支
    fs.writeFileSync(cachePath, JSON.stringify({
      version: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      catalog: {
        sets: [{
          id: 'set-one',
          locations: [{ rootId, relativePath: 'set-one' }],
          media: [{ rootId, relativePath: 'set-one/01.jpg' }]
        }]
      }
    }));

    const pre34Path = `${cachePath}.pre-3.4.json`;
    const readSpy = jest.spyOn(fs.promises, 'readFile');

    try {
      const service = new CosLibraryService({ configPath, cachePath });
      await service.initialize();

      const readPaths = readSpy.mock.calls.map((call) => call[0]);
      // 副本实测 29MB；为了判断「它在不在」而把它读进来解析是纯浪费
      expect(readPaths).not.toContain(pre34Path);
      // 但迁移副本本身仍然要被写出来
      expect(fs.existsSync(pre34Path)).toBe(true);
    } finally {
      readSpy.mockRestore();
    }
  });
});
