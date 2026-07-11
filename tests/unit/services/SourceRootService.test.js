/** @jest-environment node */

const {
  SECOND_SOURCE_ID,
  SOURCE_ID,
  createNavigationTargetV1,
  createSourceRootRegistryV1,
  createSourceRootV1
} = require('../../helpers/sourceRootFixtures');
const {
  validateSourceRootV1
} = require('../../../src/common/contracts/navigation-contract-v1');

const REGISTRY_PATH = '/state/library-sources.json';
const SECOND_UUID = '22222222-2222-4222-8222-222222222222';
const THIRD_UUID = '33333333-3333-4333-8333-333333333333';
const PREEXISTING_TEMP_CONTENTS = 'pre-existing temp file';

function createIoError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function createFakeFs({
  directories = ['/Photos'],
  initialRegistry,
  openHandles = true,
  renameFailures = 0,
  writeCollisions = 0
} = {}) {
  const files = new Map();
  if (initialRegistry !== undefined) {
    files.set(
      REGISTRY_PATH,
      typeof initialRegistry === 'string' ? initialRegistry : JSON.stringify(initialRegistry)
    );
  }
  const directorySet = new Set(directories);
  const calls = [];
  let remainingRenameFailures = renameFailures;
  let remainingWriteCollisions = writeCollisions;
  const collidingTempPaths = [];

  const fsApi = {
    async readFile(target, encoding) {
      calls.push(['readFile', target, encoding]);
      if (!files.has(target)) throw createIoError('ENOENT');
      return files.get(target);
    },
    async mkdir(target, options) {
      calls.push(['mkdir', target, options]);
    },
    async writeFile(target, contents, options) {
      calls.push(['writeFile', target, contents, options]);
      if (remainingWriteCollisions > 0) {
        remainingWriteCollisions -= 1;
        collidingTempPaths.push(target);
        files.set(target, PREEXISTING_TEMP_CONTENTS);
        throw createIoError('EEXIST');
      }
      if (options?.flag === 'wx' && files.has(target)) throw createIoError('EEXIST');
      files.set(target, contents);
    },
    async rename(from, to) {
      calls.push(['rename', from, to]);
      if (remainingRenameFailures > 0) {
        remainingRenameFailures -= 1;
        throw createIoError('EIO', 'rename failed');
      }
      if (!files.has(from)) throw createIoError('ENOENT');
      files.set(to, files.get(from));
      files.delete(from);
    },
    async unlink(target) {
      calls.push(['unlink', target]);
      if (!files.delete(target)) throw createIoError('ENOENT');
    },
    async stat(target) {
      calls.push(['stat', target]);
      if (directorySet.has(target)) {
        return { isDirectory: () => true };
      }
      if (files.has(target)) {
        return { isDirectory: () => false };
      }
      throw createIoError('ENOENT');
    }
  };

  if (openHandles) {
    fsApi.open = async (target, flags) => {
      calls.push(['open', target, flags]);
      if (!files.has(target)) throw createIoError('ENOENT');
      return {
        async sync() {
          calls.push(['sync', target]);
        },
        async close() {
          calls.push(['close', target]);
        }
      };
    };
  }

  return {
    calls,
    collidingTempPaths,
    files,
    fsApi,
    getRegistryDocument() {
      return files.has(REGISTRY_PATH) ? JSON.parse(files.get(REGISTRY_PATH)) : null;
    }
  };
}

function sequenceRandomUUID(...values) {
  let index = 0;
  return jest.fn(() => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  });
}

function loadService(fakeFs, overrides = {}) {
  const { createSourceRootService } = require('../../../src/main/services/SourceRootService');
  return createSourceRootService({
    registryPath: REGISTRY_PATH,
    fsApi: fakeFs.fsApi,
    randomUUID: sequenceRandomUUID(SECOND_UUID),
    ...overrides
  });
}

function writeTargets(fakeFs) {
  return fakeFs.calls
    .filter(([operation]) => operation === 'writeFile')
    .map(([, target]) => target);
}

describe('SourceRootService', () => {
  test('initializes a missing registry as an empty in-memory registry', async () => {
    const fakeFs = createFakeFs();
    const service = loadService(fakeFs);

    await expect(service.initialize()).resolves.toBeUndefined();
    await expect(service.listSourceRoots()).resolves.toEqual([]);
    expect(fakeFs.files.has(REGISTRY_PATH)).toBe(false);
    expect(writeTargets(fakeFs)).toEqual([]);
  });

  test('reloads a valid versioned registry', async () => {
    const document = createSourceRootRegistryV1();
    const fakeFs = createFakeFs({ initialRegistry: document });
    const service = loadService(fakeFs);

    await service.initialize();

    await expect(service.listSourceRoots()).resolves.toEqual(document.sources);
    await expect(service.getSourceRoot(SOURCE_ID)).resolves.toEqual(document.sources[0]);
    await expect(service.getSourceRoot(SECOND_SOURCE_ID)).resolves.toBeNull();
  });

  test.each([
    ['invalid JSON', '{not json'],
    ['unknown schema', { schemaVersion: 2, sources: [] }],
    ['unknown field', { schemaVersion: 1, sources: [], legacy: true }],
    ['invalid source', createSourceRootRegistryV1({
      sources: [createSourceRootV1({ sourceGeneration: 0 })]
    })]
  ])('retains %s corruption and refuses to overwrite the registry', async (_name, initialRegistry) => {
    const fakeFs = createFakeFs({ initialRegistry });
    const original = fakeFs.files.get(REGISTRY_PATH);
    const service = loadService(fakeFs);

    await expect(service.initialize()).rejects.toMatchObject({
      code: 'SOURCE_ROOT_REGISTRY_CORRUPT'
    });
    await expect(service.saveSourceRoot({
      sourceId: null,
      rootPath: '/Photos',
      label: null
    })).rejects.toMatchObject({ code: 'SOURCE_ROOT_REGISTRY_CORRUPT' });

    expect(fakeFs.files.get(REGISTRY_PATH)).toBe(original);
    expect(writeTargets(fakeFs)).toEqual([]);
    expect(fakeFs.calls.filter(([operation]) => operation === 'rename')).toEqual([]);
  });

  test('ensures an existing equivalent root idempotently', async () => {
    const existing = createSourceRootV1({ rootPath: 'C:/Photos' });
    const fakeFs = createFakeFs({
      directories: ['c:/photos'],
      initialRegistry: createSourceRootRegistryV1({ sources: [existing] })
    });
    const service = loadService(fakeFs);
    await service.initialize();

    await expect(service.saveSourceRoot({
      sourceId: null,
      rootPath: 'c:\\photos\\',
      label: 'Ignored replacement label'
    })).resolves.toEqual({ source: existing, created: false });

    expect(writeTargets(fakeFs)).toEqual([]);
    expect(fakeFs.getRegistryDocument().sources).toEqual([existing]);
  });

  test('creates a source with a deterministic UUID and an atomically persisted registry', async () => {
    const fakeFs = createFakeFs();
    const randomUUID = sequenceRandomUUID(SECOND_UUID);
    const service = loadService(fakeFs, { randomUUID });
    await service.initialize();

    const result = await service.saveSourceRoot({
      sourceId: null,
      rootPath: '/Photos/',
      label: null
    });

    expect(result).toEqual({
      created: true,
      source: {
        schemaVersion: 1,
        sourceId: SECOND_SOURCE_ID,
        label: 'Photos',
        rootPath: '/Photos',
        sourceGeneration: 1
      }
    });
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(fakeFs.getRegistryDocument()).toEqual({
      schemaVersion: 1,
      sources: [result.source]
    });
    expect(writeTargets(fakeFs)).toHaveLength(1);
    expect(writeTargets(fakeFs)[0]).not.toBe(REGISTRY_PATH);
    expect(fakeFs.calls).toEqual(expect.arrayContaining([
      expect.arrayContaining(['sync']),
      expect.arrayContaining(['close'])
    ]));
    expect(fakeFs.calls.filter(([operation, , to]) => (
      operation === 'rename' && to === REGISTRY_PATH
    ))).toHaveLength(1);
  });

  test.each([
    ['overlong', `/${'a'.repeat(201)}`, 'a'.repeat(200)],
    ['blank', '/   ', '照片来源']
  ])('creates a reloadable contract-valid default label for an %s basename', async (
    _name,
    rootPath,
    expectedLabel
  ) => {
    const fakeFs = createFakeFs({ directories: [rootPath] });
    const service = loadService(fakeFs);
    await service.initialize();

    const result = await service.saveSourceRoot({ sourceId: null, rootPath, label: null });

    expect(result.source.label).toBe(expectedLabel);
    expect(validateSourceRootV1(result.source).valid).toBe(true);
    const reloadedService = loadService(fakeFs);
    await expect(reloadedService.initialize()).resolves.toBeUndefined();
    await expect(reloadedService.listSourceRoots()).resolves.toEqual([result.source]);
  });

  test('retries a colliding generated UUID', async () => {
    const existing = createSourceRootV1();
    const fakeFs = createFakeFs({
      directories: ['/Photos', '/Other'],
      initialRegistry: createSourceRootRegistryV1({ sources: [existing] })
    });
    const randomUUID = sequenceRandomUUID(
      '11111111-1111-4111-8111-111111111111',
      SECOND_UUID
    );
    const service = loadService(fakeFs, { randomUUID });
    await service.initialize();

    const result = await service.saveSourceRoot({
      sourceId: null,
      rootPath: '/Other',
      label: '其他'
    });

    expect(result.source.sourceId).toBe(SECOND_SOURCE_ID);
    expect(randomUUID).toHaveBeenCalledTimes(2);
  });

  test('allows nested roots while resolving the unique longest legacy match', async () => {
    const fakeFs = createFakeFs({ directories: ['/Photos', '/Photos/Family'] });
    const service = loadService(fakeFs, {
      randomUUID: sequenceRandomUUID(SECOND_UUID, THIRD_UUID)
    });
    await service.initialize();
    const parent = await service.saveSourceRoot({
      sourceId: null, rootPath: '/Photos', label: '照片'
    });
    const nested = await service.saveSourceRoot({
      sourceId: null, rootPath: '/Photos/Family', label: '家庭'
    });

    await expect(service.listSourceRoots()).resolves.toHaveLength(2);
    expect(service.matchLegacyAbsolutePath('/Photos/Family/Trip')).toEqual({
      status: 'resolved',
      source: nested.source,
      relativePath: 'Trip'
    });
    expect(service.matchLegacyAbsolutePath('/Photos/Other')).toEqual({
      status: 'resolved',
      source: parent.source,
      relativePath: 'Other'
    });
  });

  test('relinks with a stable id and generation while label-only updates do not bump it', async () => {
    const existing = createSourceRootV1();
    const fakeFs = createFakeFs({
      directories: ['/Photos', '/Moved'],
      initialRegistry: createSourceRootRegistryV1({ sources: [existing] })
    });
    const service = loadService(fakeFs);
    await service.initialize();

    const labelUpdate = await service.saveSourceRoot({
      sourceId: SOURCE_ID,
      rootPath: '/Photos',
      label: '新标签'
    });
    expect(labelUpdate).toEqual({
      created: false,
      source: { ...existing, label: '新标签' }
    });

    const relink = await service.saveSourceRoot({
      sourceId: SOURCE_ID,
      rootPath: '/Moved',
      label: null
    });
    expect(relink).toEqual({
      created: false,
      source: {
        ...existing,
        label: '新标签',
        rootPath: '/Moved',
        sourceGeneration: 2
      }
    });
  });

  test('treats an equivalent relink as a no-op', async () => {
    const existing = createSourceRootV1({ rootPath: 'C:/Photos' });
    const fakeFs = createFakeFs({
      directories: ['c:/photos'],
      initialRegistry: createSourceRootRegistryV1({ sources: [existing] })
    });
    const service = loadService(fakeFs);
    await service.initialize();

    await expect(service.saveSourceRoot({
      sourceId: SOURCE_ID,
      rootPath: 'c:\\photos\\',
      label: null
    })).resolves.toEqual({ source: existing, created: false });
    expect(writeTargets(fakeFs)).toEqual([]);
  });

  test('rejects replacement with a root already owned by another source', async () => {
    const sources = [
      createSourceRootV1(),
      createSourceRootV1({ sourceId: SECOND_SOURCE_ID, rootPath: '/Other', label: '其他' })
    ];
    const fakeFs = createFakeFs({
      directories: ['/Photos', '/Other'],
      initialRegistry: createSourceRootRegistryV1({ sources })
    });
    const service = loadService(fakeFs);
    await service.initialize();

    await expect(service.saveSourceRoot({
      sourceId: SOURCE_ID,
      rootPath: '/Other',
      label: null
    })).rejects.toMatchObject({ code: 'SOURCE_ROOT_CONFLICT' });
    expect(writeTargets(fakeFs)).toEqual([]);
  });

  test('rejects roots that are missing or not directories', async () => {
    const fakeFs = createFakeFs({ directories: [] });
    fakeFs.files.set('/regular-file.jpg', 'contents');
    const service = loadService(fakeFs);
    await service.initialize();

    await expect(service.saveSourceRoot({
      sourceId: null, rootPath: '/Missing', label: null
    })).rejects.toMatchObject({ code: 'SOURCE_ROOT_MISSING' });
    await expect(service.saveSourceRoot({
      sourceId: null, rootPath: '/regular-file.jpg', label: null
    })).rejects.toMatchObject({ code: 'SOURCE_ROOT_NOT_DIRECTORY' });
    expect(writeTargets(fakeFs)).toEqual([]);
  });

  test('returns defensive copies from list, get, and save', async () => {
    const fakeFs = createFakeFs();
    const service = loadService(fakeFs);
    await service.initialize();
    const saved = await service.saveSourceRoot({
      sourceId: null, rootPath: '/Photos', label: '照片'
    });

    saved.source.label = 'mutated save result';
    const listed = await service.listSourceRoots();
    listed[0].label = 'mutated list result';
    listed.push(createSourceRootV1());
    const fetched = await service.getSourceRoot(SECOND_SOURCE_ID);
    fetched.label = 'mutated get result';

    await expect(service.getSourceRoot(SECOND_SOURCE_ID)).resolves.toMatchObject({ label: '照片' });
    await expect(service.listSourceRoots()).resolves.toHaveLength(1);
  });

  test('serializes concurrent saves without losing either mutation', async () => {
    const fakeFs = createFakeFs({ directories: ['/Photos', '/Other'] });
    const service = loadService(fakeFs, {
      randomUUID: sequenceRandomUUID(SECOND_UUID, THIRD_UUID)
    });
    await service.initialize();

    const results = await Promise.all([
      service.saveSourceRoot({ sourceId: null, rootPath: '/Photos', label: null }),
      service.saveSourceRoot({ sourceId: null, rootPath: '/Other', label: null })
    ]);

    expect(results.map(({ source }) => source.sourceId)).toEqual([
      SECOND_SOURCE_ID,
      `src_${THIRD_UUID}`
    ]);
    expect(fakeFs.getRegistryDocument().sources.map(({ rootPath }) => rootPath))
      .toEqual(['/Photos', '/Other']);
    expect(writeTargets(fakeFs)).toHaveLength(2);
    expect(new Set(writeTargets(fakeFs)).size).toBe(2);
    expect(writeTargets(fakeFs)).not.toContain(REGISTRY_PATH);
  });

  test('preserves the old file and memory when atomic rename fails', async () => {
    const existing = createSourceRootV1();
    const fakeFs = createFakeFs({
      directories: ['/Photos'],
      initialRegistry: createSourceRootRegistryV1({ sources: [existing] }),
      renameFailures: 1
    });
    const original = fakeFs.files.get(REGISTRY_PATH);
    const service = loadService(fakeFs);
    await service.initialize();

    await expect(service.saveSourceRoot({
      sourceId: SOURCE_ID,
      rootPath: '/Photos',
      label: '未写入'
    })).rejects.toMatchObject({ code: 'SOURCE_ROOT_PERSIST_FAILED' });

    expect(fakeFs.files.get(REGISTRY_PATH)).toBe(original);
    await expect(service.getSourceRoot(SOURCE_ID)).resolves.toEqual(existing);
    expect(writeTargets(fakeFs)).not.toContain(REGISTRY_PATH);
    expect(fakeFs.calls.some(([operation]) => operation === 'unlink')).toBe(true);
  });

  test('preserves a pre-existing temp file when exclusive creation collides', async () => {
    const fakeFs = createFakeFs({ writeCollisions: 1 });
    const service = loadService(fakeFs);
    await service.initialize();

    await expect(service.saveSourceRoot({
      sourceId: null,
      rootPath: '/Photos',
      label: null
    })).rejects.toMatchObject({ code: 'SOURCE_ROOT_PERSIST_FAILED' });

    expect(fakeFs.collidingTempPaths).toHaveLength(1);
    const [collidingPath] = fakeFs.collidingTempPaths;
    expect(fakeFs.files.get(collidingPath)).toBe(PREEXISTING_TEMP_CONTENTS);
    expect(fakeFs.calls).not.toContainEqual(['unlink', collidingPath]);
    expect(fakeFs.files.has(REGISTRY_PATH)).toBe(false);
  });

  test('continues the mutation queue after a rejected save', async () => {
    const fakeFs = createFakeFs({ directories: ['/Photos'] });
    const service = loadService(fakeFs);
    await service.initialize();

    const failed = service.saveSourceRoot({
      sourceId: null, rootPath: '/Missing', label: null
    });
    const succeeded = service.saveSourceRoot({
      sourceId: null, rootPath: '/Photos', label: null
    });

    await expect(failed).rejects.toMatchObject({ code: 'SOURCE_ROOT_MISSING' });
    await expect(succeeded).resolves.toMatchObject({ created: true });
    expect(fakeFs.getRegistryDocument().sources).toHaveLength(1);
  });

  test('resolves canonical navigation targets without changing their portable fields', async () => {
    const source = createSourceRootV1();
    const fakeFs = createFakeFs({ initialRegistry: createSourceRootRegistryV1() });
    const service = loadService(fakeFs);
    await service.initialize();
    const target = createNavigationTargetV1();

    await expect(service.resolveNavigationTarget(target)).resolves.toEqual({
      source,
      target,
      absolutePath: '/Photos/2026/旅行',
      initialMediaAbsolutePath: '/Photos/2026/旅行/001.jpg'
    });
    await expect(service.resolveNavigationTarget(createNavigationTargetV1({
      viewMode: 'folder'
    }))).rejects.toMatchObject({ code: 'INVALID_NAVIGATION_TARGET' });
    await expect(service.resolveNavigationTarget(createNavigationTargetV1({
      sourceId: SECOND_SOURCE_ID
    }))).rejects.toMatchObject({ code: 'SOURCE_ROOT_NOT_FOUND' });
  });
});
