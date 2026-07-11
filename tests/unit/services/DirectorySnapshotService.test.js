/** @jest-environment node */

const fs = require('fs');
const { createFsMock } = require('../../helpers/fsMock');
const { createDirectoryLevelRequestV1 } = require('../../helpers/directoryContractFixtures');
const {
  validateDirectorySnapshotV1
} = require('../../../src/common/contracts/directory-contract-v1');

const OBSERVED_AT = 1783728000000;

function createStats(type, overrides = {}) {
  return {
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    size: type === 'file' ? 10 : 0,
    mtimeMs: OBSERVED_AT,
    ...overrides
  };
}

function createIoError(code) {
  return Object.assign(new Error(code), { code });
}

function createMappedFs({ directories, stats, calls = null }) {
  return {
    async readdir(target) {
      calls?.push(['readdir', target]);
      const value = directories.get(target);
      if (value instanceof Error) throw value;
      if (!value) throw createIoError('ENOENT');
      return [...value];
    },
    async stat(target) {
      calls?.push(['stat', target]);
      const value = stats.get(target);
      if (value instanceof Error) throw value;
      if (!value) throw createIoError('ENOENT');
      return value;
    }
  };
}

async function waitForCondition(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(message);
}

function trackArrayIndexReads(values, reads) {
  return new Proxy([...values], {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) {
        reads.push(Number(property));
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

describe('DirectorySnapshotService', () => {
  let mockFs;

  afterEach(() => {
    jest.restoreAllMocks();
    mockFs?.restore();
    mockFs = null;
  });

  function loadService(overrides = {}) {
    const { createDirectorySnapshotService } = require(
      '../../../src/main/services/DirectorySnapshotService'
    );
    return createDirectorySnapshotService({
      fsApi: fs.promises,
      now: () => OBSERVED_AT,
      makeRevision: () => 'snap_test_1',
      ...overrides
    });
  }

  function resolveRoot(service, requestOverrides = {}) {
    return service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1(requestOverrides));
  }

  test('returns the five ready child truth-table rows and aggregate root evidence', async () => {
    mockFs = createFsMock({
      '/photos': {
        'cover.jpg': Buffer.from('cover'),
        photo: { '1.jpg': Buffer.from('photo') },
        container: { nested: {} },
        hybrid: { '2.jpg': Buffer.from('hybrid'), nested: {} },
        empty: {},
        documents: { 'notes.txt': 'not media' }
      }
    });
    const service = loadService();
    const snapshot = await service.scanDirectorySnapshot(resolveRoot(service));

    expect(snapshot).toMatchObject({
      contractVersion: 1,
      ref: { relativePath: '' },
      locator: { absolutePath: '/photos' },
      name: 'photos',
      status: 'ready',
      observedAt: OBSERVED_AT,
      revision: 'snap_test_1',
      completeness: { entries: 'complete', directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 1, childDirectoryCount: 5 },
      approximate: {
        coverSamples: ['cover.jpg', 'hybrid/2.jpg', 'photo/1.jpg'],
        hasDescendantMedia: 'yes',
        observedAt: OBSERVED_AT,
        truncated: true
      }
    });
    expect(snapshot.children.map((child) => child.name)).toEqual([
      'container', 'documents', 'empty', 'hybrid', 'photo'
    ]);

    const children = Object.fromEntries(snapshot.children.map((child) => [child.name, child]));
    expect(children.photo).toMatchObject({
      status: 'ready',
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 1, childDirectoryCount: 0 },
      approximate: {
        coverSamples: ['photo/1.jpg'],
        hasDescendantMedia: 'yes',
        truncated: false
      }
    });
    expect(children.container).toMatchObject({
      status: 'ready',
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 1 },
      approximate: { coverSamples: [], hasDescendantMedia: 'unknown', truncated: true }
    });
    expect(children.hybrid).toMatchObject({
      status: 'ready',
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 1, childDirectoryCount: 1 },
      approximate: {
        coverSamples: ['hybrid/2.jpg'],
        hasDescendantMedia: 'yes',
        truncated: true
      }
    });
    for (const name of ['empty', 'documents']) {
      expect(children[name]).toMatchObject({
        status: 'ready',
        completeness: { directMedia: 'complete', children: 'complete' },
        facts: { directMediaCount: 0, childDirectoryCount: 0 },
        approximate: { coverSamples: [], hasDescendantMedia: 'no', truncated: false }
      });
    }

    expect(validateDirectorySnapshotV1(snapshot)).toEqual({
      valid: true,
      issues: [],
      value: snapshot
    });
    expect(Object.keys(snapshot).sort()).toEqual([
      'approximate', 'children', 'completeness', 'contractVersion', 'directMedia', 'facts',
      'locator', 'name', 'observedAt', 'ref', 'revision', 'status'
    ]);
    expect(snapshot).not.toHaveProperty('success');
    expect(snapshot).not.toHaveProperty('nodes');
    expect(snapshot).not.toHaveProperty('metadata');
    expect(snapshot.children[0]).not.toHaveProperty('contentKind');
    expect(snapshot.children[0]).not.toHaveProperty('canBrowseChildren');

    mockFs.restore();
    mockFs = createFsMock({ '/photos': { 'UPPER.JPG': Buffer.from('uppercase') } });
    const uppercaseService = loadService();
    const uppercaseSnapshot = await uppercaseService.scanDirectorySnapshot(
      resolveRoot(uppercaseService)
    );
    expect(uppercaseSnapshot.directMedia.map((entry) => entry.name)).toEqual(['UPPER.JPG']);

    mockFs.restore();
    mockFs = null;
    for (const order of [
      ['album10', 'a', 'album2', 'A'],
      ['A', 'album2', 'album10', 'a']
    ]) {
      const directories = new Map([['/photos', order]]);
      const stats = new Map(order.map((name) => [`/photos/${name}`, createStats('directory')]));
      for (const name of order) directories.set(`/photos/${name}`, []);
      const orderedService = loadService({ fsApi: createMappedFs({ directories, stats }) });
      const orderedSnapshot = await orderedService.scanDirectorySnapshot(resolveRoot(orderedService));
      expect(orderedSnapshot.children.map((child) => child.name)).toEqual([
        'A', 'a', 'album2', 'album10'
      ]);
    }
  });

  test('preserves nested target refs', async () => {
    mockFs = createFsMock({
      '/photos': {
        2026: {
          trip: {
            '1.jpg': Buffer.from('one'),
            nested: {}
          }
        }
      }
    });
    const service = loadService();
    const request = createDirectoryLevelRequestV1({ ref: { relativePath: '2026/trip' } });
    const locator = service.resolveDirectoryLocatorV1(request);
    const snapshot = await service.scanDirectorySnapshot(locator);

    expect(snapshot.ref.relativePath).toBe('2026/trip');
    expect(snapshot.directMedia[0].relativePath).toBe('2026/trip/1.jpg');
    expect(snapshot.children[0].ref.relativePath).toBe('2026/trip/nested');
    expect(snapshot.locator).toEqual({ absolutePath: '/photos/2026/trip' });
    expect(snapshot.name).toBe('trip');
  });

  test('skips non-portable disk entries and keeps lower bounds internally consistent', async () => {
    const rootDirectories = new Map([
      ['/photos', ['bad\\entry', 'C:photo.jpg', 'portable']],
      ['/photos/portable', []]
    ]);
    const rootStats = new Map([
      ['/photos/portable', createStats('directory')]
    ]);
    const rootService = loadService({
      fsApi: createMappedFs({ directories: rootDirectories, stats: rootStats })
    });
    const rootSnapshot = await rootService.scanDirectorySnapshot(resolveRoot(rootService));

    expect(rootSnapshot.status).toBe('ready');
    expect(rootSnapshot.completeness).toEqual({
      entries: 'partial', directMedia: 'partial', children: 'partial'
    });
    expect(rootSnapshot.facts).toEqual({
      directMediaCount: rootSnapshot.directMedia.length,
      childDirectoryCount: rootSnapshot.children.length
    });
    expect(rootSnapshot.directMedia).toHaveLength(0);
    expect(rootSnapshot.children.map((child) => child.name)).toEqual(['portable']);

    const childDirectories = new Map([
      ['/photos', ['child']],
      ['/photos/child', ['bad\\entry', 'C:photo.jpg', '1.jpg', 'nested']]
    ]);
    const childStats = new Map([
      ['/photos/child', createStats('directory')],
      ['/photos/child/1.jpg', createStats('file')],
      ['/photos/child/nested', createStats('directory')]
    ]);
    const childService = loadService({
      fsApi: createMappedFs({ directories: childDirectories, stats: childStats })
    });
    const childSnapshot = await childService.scanDirectorySnapshot(resolveRoot(childService));

    expect(childSnapshot.completeness).toEqual({
      entries: 'complete', directMedia: 'complete', children: 'complete'
    });
    expect(childSnapshot.children[0]).toMatchObject({
      name: 'child',
      status: 'ready',
      completeness: { directMedia: 'partial', children: 'partial' },
      facts: { directMediaCount: 1, childDirectoryCount: 1 }
    });
    expect(childSnapshot.children[0].facts.directMediaCount).toBe(
      childSnapshot.children[0].approximate.coverSamples.length
    );
  });

  test('maps child and root I/O failures without guessing sourceOffline', async () => {
    for (const [code, expectedStatus] of [
      ['ENOENT', 'missing'],
      ['ENOTDIR', 'missing'],
      ['EACCES', 'unreadable'],
      ['EPERM', 'unreadable'],
      ['EIO', 'unreadable']
    ]) {
      const directories = new Map([
        ['/photos', ['child']],
        ['/photos/child', createIoError(code)]
      ]);
      const stats = new Map([['/photos/child', createStats('directory')]]);
      const service = loadService({ fsApi: createMappedFs({ directories, stats }) });
      const snapshot = await service.scanDirectorySnapshot(resolveRoot(service));
      const child = snapshot.children[0];

      expect(child).toMatchObject({
        name: 'child',
        status: expectedStatus,
        completeness: { directMedia: 'partial', children: 'partial' },
        facts: { directMediaCount: 0, childDirectoryCount: 0 },
        approximate: {
          coverSamples: [],
          hasDescendantMedia: 'unknown',
          truncated: true
        }
      });
      expect(child.status).not.toBe('sourceOffline');
    }

    const childStatDirectories = new Map([
      ['/photos', ['child']],
      ['/photos/child', ['1.jpg', 'nested', 'unknown-entry']]
    ]);
    const childStatStats = new Map([
      ['/photos/child', createStats('directory')],
      ['/photos/child/1.jpg', createStats('file')],
      ['/photos/child/nested', createStats('directory')],
      ['/photos/child/unknown-entry', createIoError('EIO')]
    ]);
    const childStatService = loadService({
      fsApi: createMappedFs({ directories: childStatDirectories, stats: childStatStats })
    });
    const childStatSnapshot = await childStatService.scanDirectorySnapshot(
      resolveRoot(childStatService)
    );
    expect(childStatSnapshot.children[0]).toMatchObject({
      status: 'ready',
      completeness: { directMedia: 'partial', children: 'partial' },
      facts: { directMediaCount: 1, childDirectoryCount: 1 }
    });

    const rootStatDirectories = new Map([
      ['/photos', ['1.jpg', 'child', 'unknown-entry']],
      ['/photos/child', []]
    ]);
    const rootStatStats = new Map([
      ['/photos/1.jpg', createStats('file')],
      ['/photos/child', createStats('directory')],
      ['/photos/unknown-entry', createIoError('EIO')]
    ]);
    const rootStatService = loadService({
      fsApi: createMappedFs({ directories: rootStatDirectories, stats: rootStatStats })
    });
    const rootStatSnapshot = await rootStatService.scanDirectorySnapshot(
      resolveRoot(rootStatService)
    );
    expect(rootStatSnapshot.status).toBe('ready');
    expect(rootStatSnapshot.completeness).toEqual({
      entries: 'partial', directMedia: 'partial', children: 'partial'
    });
    expect(rootStatSnapshot.facts).toEqual({
      directMediaCount: rootStatSnapshot.directMedia.length,
      childDirectoryCount: rootStatSnapshot.children.length
    });

    for (const [code, expectedStatus] of [
      ['ENOENT', 'missing'],
      ['ENOTDIR', 'missing'],
      ['EACCES', 'unreadable'],
      ['EPERM', 'unreadable'],
      ['EIO', 'unreadable']
    ]) {
      const directories = new Map([['/photos', createIoError(code)]]);
      const service = loadService({
        fsApi: createMappedFs({ directories, stats: new Map() })
      });
      await expect(service.scanDirectorySnapshot(resolveRoot(service))).rejects.toMatchObject({
        directoryStatus: expectedStatus
      });
    }
  });

  test('resolves portable locators and preserves their path flavor', async () => {
    const service = loadService();

    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      ref: { relativePath: '2026/trip' }
    }))).toMatchObject({
      absolutePath: '/photos/2026/trip',
      name: 'trip',
      pathFlavor: 'posix'
    });
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: 'C:\\photos' },
      ref: { relativePath: '2026/trip' }
    }))).toMatchObject({
      absolutePath: 'C:\\photos\\2026\\trip',
      name: 'trip',
      pathFlavor: 'win32'
    });
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: '\\\\server\\share\\photos' },
      ref: { relativePath: '2026/trip' }
    }))).toMatchObject({
      absolutePath: '\\\\server\\share\\photos\\2026\\trip',
      name: 'trip',
      pathFlavor: 'win32'
    });
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: '/' }
    }))).toMatchObject({ absolutePath: '/', name: '/', pathFlavor: 'posix' });
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: 'C:\\' }
    }))).toMatchObject({ absolutePath: 'C:\\', name: 'C:\\', pathFlavor: 'win32' });
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      ref: { relativePath: '..foo' }
    }))).toMatchObject({ absolutePath: '/photos/..foo', name: '..foo' });

    await expect(Promise.resolve().then(() => service.resolveDirectoryLocatorV1(
      createDirectoryLevelRequestV1({ ref: { relativePath: '../escape' } })
    ))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    for (const rootPath of ['C:\\photos', '\\\\server\\share\\photos']) {
      const calls = [];
      const childPath = `${rootPath}\\album`;
      const coverPath = `${rootPath}\\cover.jpg`;
      const childMediaPath = `${childPath}\\1.jpg`;
      const directories = new Map([
        [rootPath, ['album', 'cover.jpg']],
        [childPath, ['1.jpg']]
      ]);
      const stats = new Map([
        [childPath, createStats('directory')],
        [coverPath, createStats('file')],
        [childMediaPath, createStats('file')]
      ]);
      const windowsService = loadService({
        fsApi: createMappedFs({ directories, stats, calls })
      });
      const locator = windowsService.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
        runtimeSource: { rootPath }
      }));
      const snapshot = await windowsService.scanDirectorySnapshot(locator);

      expect(snapshot.locator.absolutePath).toBe(rootPath);
      expect(calls.map(([, target]) => target)).toEqual(expect.arrayContaining([
        rootPath, childPath, coverPath, childMediaPath
      ]));
      for (const [, target] of calls) {
        expect(target).not.toContain('/');
      }
    }
  });

  test('performs a single-level scan with bounded leaf I/O', async () => {
    function createTrackedFs() {
      const calls = [];
      let active = 0;
      let peak = 0;
      const directories = new Map([
        ['/photos', ['direct.jpg', 'container', 'hybrid']],
        ['/photos/container', ['nested']],
        ['/photos/hybrid', ['1.jpg', 'nested']]
      ]);
      const stats = new Map([
        ['/photos/direct.jpg', createStats('file')],
        ['/photos/container', createStats('directory')],
        ['/photos/hybrid', createStats('directory')],
        ['/photos/container/nested', createStats('directory')],
        ['/photos/hybrid/1.jpg', createStats('file')],
        ['/photos/hybrid/nested', createStats('directory')]
      ]);
      const run = async (kind, target, lookup) => {
        calls.push([kind, target]);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        const value = lookup.get(target);
        if (!value) throw createIoError('ENOENT');
        return Array.isArray(value) ? [...value] : value;
      };
      return {
        calls,
        getPeak: () => peak,
        fsApi: {
          readdir: (target) => run('readdir', target, directories),
          stat: (target) => run('stat', target, stats)
        }
      };
    }

    const serialIo = createTrackedFs();
    const serialService = loadService({ fsApi: serialIo.fsApi });
    const serialScan = serialService.scanDirectorySnapshot(
      resolveRoot(serialService),
      { concurrencyLimit: 1 }
    );
    await expect(Promise.race([
      serialScan,
      new Promise((_, reject) => setTimeout(() => reject(new Error('scan deadlocked')), 1000))
    ])).resolves.toMatchObject({ status: 'ready' });
    expect(serialIo.getPeak()).toBe(1);
    expect(serialIo.calls.filter(([kind, target]) => kind === 'readdir' && target === '/photos'))
      .toHaveLength(1);
    expect(serialIo.calls.filter(([kind, target]) => kind === 'readdir'
      && target === '/photos/container')).toHaveLength(1);
    expect(serialIo.calls.filter(([kind, target]) => kind === 'readdir'
      && target === '/photos/hybrid')).toHaveLength(1);
    expect(serialIo.calls).not.toContainEqual(['readdir', '/photos/container/nested']);
    expect(serialIo.calls).not.toContainEqual(['readdir', '/photos/hybrid/nested']);

    const parallelIo = createTrackedFs();
    const parallelService = loadService({ fsApi: parallelIo.fsApi });
    await parallelService.scanDirectorySnapshot(
      resolveRoot(parallelService),
      { concurrencyLimit: 2 }
    );
    expect(parallelIo.getPeak()).toBeGreaterThan(1);
    expect(parallelIo.getPeak()).toBeLessThanOrEqual(2);
  });

  test('pulls root entry names only as stat capacity becomes available', async () => {
    const indexReads = [];
    const rootEntries = trackArrayIndexReads(['album', '2.jpg', '3.jpg'], indexReads);
    const stats = new Map([
      ['/photos/album', createStats('directory')],
      ['/photos/2.jpg', createStats('file')],
      ['/photos/3.jpg', createStats('file')]
    ]);
    let firstStatStarted = false;
    let releaseFirstStat;
    const firstStatGate = new Promise((resolve) => {
      releaseFirstStat = resolve;
    });
    const service = loadService({
      fsApi: {
        async readdir(target) {
          if (target === '/photos') return rootEntries;
          if (target === '/photos/album') return [];
          throw createIoError('ENOENT');
        },
        async stat(target) {
          if (!firstStatStarted) {
            firstStatStarted = true;
            await firstStatGate;
          }
          return stats.get(target);
        }
      }
    });

    const scan = service.scanDirectorySnapshot(resolveRoot(service), { concurrencyLimit: 1 });
    await waitForCondition(() => firstStatStarted, 'first root stat did not start');
    const readsBeforeRelease = [...indexReads];
    releaseFirstStat();
    await scan;

    expect(readsBeforeRelease).toEqual([0]);
  });

  test('pulls child entry names only as stat capacity becomes available', async () => {
    const indexReads = [];
    const childEntries = trackArrayIndexReads(['1.jpg', '2.jpg', '3.jpg'], indexReads);
    const stats = new Map([
      ['/photos/album', createStats('directory')],
      ['/photos/album/1.jpg', createStats('file')],
      ['/photos/album/2.jpg', createStats('file')],
      ['/photos/album/3.jpg', createStats('file')]
    ]);
    let firstChildStatStarted = false;
    let releaseFirstChildStat;
    const firstChildStatGate = new Promise((resolve) => {
      releaseFirstChildStat = resolve;
    });
    const service = loadService({
      fsApi: {
        async readdir(target) {
          if (target === '/photos') return ['album'];
          if (target === '/photos/album') return childEntries;
          throw createIoError('ENOENT');
        },
        async stat(target) {
          if (target === '/photos/album/1.jpg') {
            firstChildStatStarted = true;
            await firstChildStatGate;
          }
          return stats.get(target);
        }
      }
    });

    const scan = service.scanDirectorySnapshot(resolveRoot(service), { concurrencyLimit: 1 });
    await waitForCondition(() => firstChildStatStarted, 'first child stat did not start');
    const readsBeforeRelease = [...indexReads];
    releaseFirstChildStat();
    await scan;

    expect(readsBeforeRelease).toEqual([0]);
  });

  test('normalizes fractional concurrency limits to an integer worker count', async () => {
    let active = 0;
    let peak = 0;
    let releaseStats;
    const statsGate = new Promise((resolve) => {
      releaseStats = resolve;
    });
    const service = loadService({
      fsApi: {
        async readdir(target) {
          if (target === '/photos') return ['1.jpg', '2.jpg', '3.jpg'];
          throw createIoError('ENOENT');
        },
        async stat(target) {
          active += 1;
          peak = Math.max(peak, active);
          await statsGate;
          active -= 1;
          return createStats('file', { size: target.length });
        }
      }
    });

    const scan = service.scanDirectorySnapshot(resolveRoot(service), { concurrencyLimit: 1.9 });
    await waitForCondition(() => active > 0, 'root stat did not start');
    await new Promise((resolve) => setImmediate(resolve));
    const peakBeforeRelease = peak;
    releaseStats();
    await scan;

    expect(peakBeforeRelease).toBe(1);
  });

  test('aggregates root approximate evidence from children', async () => {
    const cases = [
      {
        tree: { '/photos': { album: { '1.jpg': Buffer.from('one') } } },
        expected: {
          facts: { directMediaCount: 0, childDirectoryCount: 1 },
          approximate: {
            coverSamples: ['album/1.jpg'],
            hasDescendantMedia: 'yes',
            truncated: true
          }
        }
      },
      {
        tree: { '/photos': { container: { nested: {} } } },
        expected: {
          facts: { directMediaCount: 0, childDirectoryCount: 1 },
          approximate: { coverSamples: [], hasDescendantMedia: 'unknown', truncated: true }
        }
      },
      {
        tree: { '/photos': {} },
        expected: {
          facts: { directMediaCount: 0, childDirectoryCount: 0 },
          approximate: { coverSamples: [], hasDescendantMedia: 'no', truncated: false }
        }
      }
    ];

    for (const { tree, expected } of cases) {
      mockFs = createFsMock(tree);
      const service = loadService();
      const snapshot = await service.scanDirectorySnapshot(resolveRoot(service));
      expect(snapshot).toMatchObject(expected);
      mockFs.restore();
      mockFs = null;
    }
  });

  test('exports and validates the public API', async () => {
    mockFs = createFsMock({ '/photos': {} });
    const moduleApi = require('../../../src/main/services/DirectorySnapshotService');
    expect(moduleApi.createDirectorySnapshotService).toEqual(expect.any(Function));
    expect(moduleApi.resolveDirectoryLocatorV1).toEqual(expect.any(Function));
    expect(moduleApi.scanDirectorySnapshot).toEqual(expect.any(Function));

    expect(() => moduleApi.resolveDirectoryLocatorV1({})).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST' })
    );

    const invalidResponseService = loadService({ makeRevision: () => '' });
    const rejection = await invalidResponseService.scanDirectorySnapshot(
      resolveRoot(invalidResponseService)
    ).catch((error) => error);
    expect(rejection).toMatchObject({
      code: 'INVALID_RESPONSE',
      message: 'Invalid directory snapshot'
    });
    expect(Object.prototype.hasOwnProperty.call(rejection, 'issues')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rejection, 'details')).toBe(false);
  });
});
