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
});
