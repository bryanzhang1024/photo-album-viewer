/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CosCatalogService,
  MIXED_LOOK_ID,
  UNSPECIFIED_LOOK_ID,
  UNKNOWN_COSER_ID
} = require('../../src/main/services/CosCatalogService');

function writeSet(rootPath, folderName, metadata, imageNames = ['01.jpg']) {
  const setPath = path.join(rootPath, folderName);
  fs.mkdirSync(setPath, { recursive: true });
  fs.writeFileSync(path.join(setPath, 'cosset.json'), JSON.stringify(metadata));
  imageNames.forEach((name) => {
    fs.writeFileSync(path.join(setPath, name), 'image');
  });
  return setPath;
}

function metadata(overrides = {}) {
  return {
    schema: 'cosset/1',
    id: 'set-default',
    display_name: '默认套图',
    cosers: [],
    characters: [],
    looks: [],
    works: [],
    themes: [],
    type: '角色Cos',
    ...overrides
  };
}

describe('CosCatalogService', () => {
  let fixturePath;
  let rootA;
  let rootB;
  let service;
  let summary;

  beforeEach(async () => {
    fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'cos-catalog-'));
    rootA = path.join(fixturePath, 'root-a');
    rootB = path.join(fixturePath, 'root-b');
    fs.mkdirSync(rootA);
    fs.mkdirSync(rootB);

    writeSet(rootA, 'single', metadata({
      id: 'set-single',
      display_name: '初音未来 兔子洞',
      cosers: ['Alice'],
      characters: ['初音未来'],
      looks: ['兔子洞'],
      works: ['VOCALOID']
    }), ['10.jpg', '2.jpg', 'notes.txt']);

    writeSet(rootA, 'multi-coser', metadata({
      id: 'set-multi-coser',
      display_name: '双人 韶华',
      cosers: ['Alice', 'Bob'],
      characters: ['初音未来'],
      looks: ['韶华']
    }));

    writeSet(rootA, 'ambiguous', metadata({
      id: 'set-ambiguous',
      display_name: '双角色双造型',
      cosers: ['Bob'],
      characters: ['初音未来', '镜音铃'],
      looks: ['兔子洞', '泳装']
    }));

    writeSet(rootA, 'no-look', metadata({
      id: 'set-no-look',
      display_name: '未标造型',
      characters: ['镜音铃']
    }));

    const brokenPath = path.join(rootA, 'broken');
    fs.mkdirSync(brokenPath);
    fs.writeFileSync(path.join(brokenPath, 'cosset.json'), '{broken-json');

    writeSet(rootB, 'single-copy', metadata({
      id: 'set-single',
      display_name: '初音未来 兔子洞',
      cosers: ['Alice'],
      characters: ['初音未来'],
      looks: ['兔子洞'],
      works: ['VOCALOID']
    }), ['2.jpg']);

    service = new CosCatalogService();
    summary = await service.buildIndex([
      { id: 'root-a', path: rootA, label: 'A' },
      { id: 'root-b', path: rootB, label: 'B' }
    ]);
  });

  afterEach(() => {
    fs.rmSync(fixturePath, { recursive: true, force: true });
  });

  test('builds one logical record per stable set id and reports bad metadata', () => {
    expect(summary).toMatchObject({
      setCount: 4,
      characterCount: 2,
      coserCount: 2,
      coserCategoryCount: 3,
      errorCount: 1
    });

    const record = service.getSet('set-single');
    expect(record).toMatchObject({
      id: 'set-single',
      displayName: '初音未来 兔子洞',
      imageCount: 2
    });
    expect(record.locations).toHaveLength(2);
    expect(record.coverMediaId).toEqual(expect.any(String));
    expect(record).not.toHaveProperty('absolutePath');
    expect(service.getErrors()[0]).toMatchObject({ rootId: 'root-a' });
  });

  test('adds multi-valued sets to every character and coser without duplicating sets', () => {
    const characters = service.listCharacters().items;
    expect(characters.map(({ name, setCount }) => [name, setCount])).toEqual([
      ['初音未来', 3],
      ['镜音铃', 2]
    ]);

    const cosers = service.listCosers().items;
    expect(cosers.map(({ id, name, setCount }) => [id, name, setCount])).toEqual([
      ['coser:Alice', 'Alice', 2],
      ['coser:Bob', 'Bob', 2],
      [UNKNOWN_COSER_ID, '未知 Coser', 1]
    ]);

    expect(service.listSets({ coserId: 'coser:Bob' }).items.map((item) => item.id).sort()).toEqual([
      'set-ambiguous',
      'set-multi-coser'
    ]);
  });

  test('uses mixed look for ambiguous character-look pairing instead of a cross product', () => {
    const hatsuneLooks = service.listLooks({ characterId: 'character:初音未来' }).items;
    expect(hatsuneLooks.map(({ id, name, setCount }) => [id, name, setCount])).toEqual([
      [MIXED_LOOK_ID, '混合造型', 1],
      ['look:兔子洞', '兔子洞', 1],
      ['look:韶华', '韶华', 1]
    ]);

    expect(service.listSets({
      characterId: 'character:初音未来',
      lookId: 'look:兔子洞'
    }).items.map((item) => item.id)).toEqual(['set-single']);

    expect(service.listSets({
      characterId: 'character:初音未来',
      lookId: MIXED_LOOK_ID
    }).items.map((item) => item.id)).toEqual(['set-ambiguous']);

    expect(service.listSets({
      characterId: 'character:初音未来'
    }).total).toBe(3);
  });

  test('puts a missing look into the unclassified bucket', () => {
    const rinLooks = service.listLooks({ characterId: 'character:镜音铃' }).items;
    expect(rinLooks.map(({ id, name, setCount }) => [id, name, setCount])).toEqual([
      [MIXED_LOOK_ID, '混合造型', 1],
      [UNSPECIFIED_LOOK_ID, '未细分', 1]
    ]);
  });

  test('searches metadata, paginates set cards, and naturally orders media', () => {
    expect(service.listSets({ query: 'vocaloid' }).items.map((item) => item.id)).toEqual([
      'set-single'
    ]);

    const page = service.listSets({ offset: 1, limit: 2 });
    expect(page).toMatchObject({ total: 4, offset: 1, limit: 2 });
    expect(page.items).toHaveLength(2);

    const media = service.listSetMedia('set-single');
    expect(media.items.map((item) => item.name)).toEqual(['2.jpg', '10.jpg']);
    expect(media.items[0]).not.toHaveProperty('absolutePath');
    expect(service.resolveMediaPath(media.items[0].id)).toBe(path.join(rootA, 'single', '2.jpg'));
  });

  test('round-trips a path-free cache snapshot and marks media offline by root status', () => {
    const snapshot = service.exportSnapshot();
    expect(JSON.stringify(snapshot)).not.toContain(rootA);
    expect(JSON.stringify(snapshot)).not.toContain(rootB);
    expect(snapshot.version).toBe(2);
    expect(snapshot.sets.find((item) => item.id === 'set-single').media).toMatchObject({
      rootId: 'root-a',
      directory: 'single',
      names: ['2.jpg', '10.jpg']
    });

    const restored = new CosCatalogService();
    restored.importSnapshot(snapshot, [
      { id: 'root-a', path: rootA, status: 'offline' },
      { id: 'root-b', path: rootB, status: 'online' }
    ]);

    expect(restored.listSets({ characterId: 'character:初音未来' }).total).toBe(3);
    expect(restored.getSet('set-single')).toMatchObject({ status: 'online', imageCount: 2 });
    expect(restored.getSet('set-multi-coser')).toMatchObject({ status: 'offline' });
    expect(restored.resolveMediaPath(restored.getSet('set-single').coverMediaId)).toBeNull();
  });
});
