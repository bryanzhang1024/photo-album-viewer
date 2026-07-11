# Directory Snapshot V1 Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可验证的 `DirectorySnapshot v1`、独立 canonical 单层扫描服务与 `GET_DIRECTORY_LEVEL_V1` IPC，同时让全部旧 renderer、route、IPC 与用户可见行为保持不变。

**Architecture:** Phase 1 采用双轨迁移：旧 `scanNavigationLevel` 与 `SCAN_NAVIGATION_LEVEL` 保持原样服务现有 UI；新 `DirectorySnapshotService` 直接读取文件系统事实，绝不从 legacy DTO 反推 canonical。新请求携带仅运行期有效的 `runtimeSource + DirectoryRef`，Phase 2 再把 runtime source 的所有权切换到持久化 SourceRoot registry。

**Tech Stack:** Electron 27、Node.js CommonJS、Jest 30、mock-fs、React 18、webpack 5。

## Global Constraints

- Contract version 固定为 `1`；新 IPC 固定为 `GET_DIRECTORY_LEVEL_V1: "get-directory-level-v1"`。
- 请求固定为 `{ contractVersion: 1, runtimeSource: { sourceId, rootPath }, ref: { sourceId, relativePath } }`；Phase 1 不接受裸绝对 `targetPath` 充当 canonical identity。
- `runtimeSource` 仅为运行期解析上下文，不得写入 session、favorites、sort 或任何 canonical persistence；Phase 1 不实现 SourceRoot registry。
- `sourceId` 必须使用 `src_<uuid-v4>`，不得由 path/hash 派生；同一请求中 `runtimeSource.sourceId === ref.sourceId`。
- `relativePath` 根为 `""`，嵌套路径统一 `/`；拒绝绝对路径、Windows drive/UNC、反斜杠、NUL、空 segment、`.`、`..` 与尾 `/`。
- 顶层 target missing/unreadable 统一返回 `ok:false` envelope；父级成功扫描中观察到的 child missing/unreadable 保留在 `ok:true` snapshot 中。
- `sourceOffline` 只能由未来 SourceRoot/mount 状态明确提供；Phase 1 禁止从 `ENOENT` 或 `EIO` 猜测。
- canonical snapshot 禁止出现 `type`、`kind`、`canOpenAlbum`、`hasImages`、`imageCount`、`childFolders` 等 legacy 字段。
- 旧 `SCAN_NAVIGATION_LEVEL` handler、progress event、旧 DTO、所有 `src/renderer/**` 文件必须保持不变；renderer 不调用新 IPC。
- Phase 1 不实现 cache、TTL、epoch、invalidation、direct-media pagination、favorites/session/sort v2 或 legacy 删除。
- 所有生产代码严格遵守 TDD：先运行新测试并看到因缺少接口而失败，再写最小实现，再运行 GREEN。
- 应用版本从 `2.5.14` 升为 `2.6.0`，同步 `package.json`、`package-lock.json`、`CHANGELOG.md`。
- 交付前必须运行完整 `npm test -- --runInBand --silent`、`npm run build`、`git diff --check`；不运行 `build:release`。
- 不新增依赖，不运行 `npm audit fix`；已知依赖审计风险单独维护。
- 只创建本地提交与本地 `--no-ff` 合并；不 push、不创建 Pull Request。

---

### Task 1: Add the shared V1 path and directory contract

**Files:**
- Create: `src/common/path-codec.js`
- Create: `src/common/contracts/directory-contract-v1.js`
- Create: `tests/helpers/directoryContractFixtures.js`
- Create: `tests/unit/pathCodec.test.js`
- Create: `tests/unit/contracts/directoryContractV1.test.js`
- Track: `docs/superpowers/plans/2026-07-11-directory-contract-v1.md`

**Interfaces:**
- Produces: portable relative-path validation; V1 request/snapshot/envelope validation; tri-state capability projection; complete reusable contract fixtures.
- Consumes: no production module from later tasks.

- [ ] **Step 1: Write failing path-codec tests**

Create `tests/unit/pathCodec.test.js`:

```js
const {
  getRootPathFlavor,
  isPortableRelativePath,
  joinPortableRelativePath,
  splitPortableRelativePath
} = require('../../src/common/path-codec');

describe('path-codec', () => {
  test.each(['', '2026', '2026/旅行/杭州', 'MixedCase/相册 01'])(
    'accepts portable relative path %p',
    (value) => expect(isPortableRelativePath(value)).toBe(true)
  );

  test.each([
    '/absolute',
    'C:/photos',
    'C:\\photos',
    '\\\\server\\share',
    'a\\b',
    'a//b',
    'a/./b',
    'a/../b',
    'a/',
    'a\0b'
  ])('rejects non-portable relative path %p', (value) => {
    expect(isPortableRelativePath(value)).toBe(false);
  });

  test('joins and splits portable relative paths without changing case', () => {
    expect(joinPortableRelativePath('2026/旅行', '杭州')).toBe('2026/旅行/杭州');
    expect(joinPortableRelativePath('', 'MixedCase')).toBe('MixedCase');
    expect(splitPortableRelativePath('2026/旅行/杭州')).toEqual(['2026', '旅行', '杭州']);
  });

  test('detects POSIX, Windows drive, and UNC roots', () => {
    expect(getRootPathFlavor('/Volumes/Photos')).toBe('posix');
    expect(getRootPathFlavor('C:\\Photos')).toBe('win32');
    expect(getRootPathFlavor('C:/Photos')).toBe('win32');
    expect(getRootPathFlavor('\\\\server\\share\\Photos')).toBe('win32');
    expect(getRootPathFlavor('relative/root')).toBeNull();
  });
});
```

- [ ] **Step 2: Run RED for path codec**

```bash
npx jest tests/unit/pathCodec.test.js --runInBand --silent
```

Expected: FAIL because `src/common/path-codec.js` does not exist.

- [ ] **Step 3: Implement the pure path codec**

Create `src/common/path-codec.js`:

```js
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ROOT = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/;

function getRootPathFlavor(rootPath) {
  if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.includes('\0')) {
    return null;
  }
  if (WINDOWS_DRIVE_ROOT.test(rootPath) || WINDOWS_UNC_ROOT.test(rootPath)) {
    return 'win32';
  }
  if (rootPath.startsWith('/')) {
    return 'posix';
  }
  return null;
}

function isPortableRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  if (value === '') return true;
  if (value.startsWith('/') || value.includes('\\') || WINDOWS_DRIVE_ROOT.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function splitPortableRelativePath(value) {
  if (!isPortableRelativePath(value)) {
    const error = new Error('Invalid portable relative path');
    error.code = 'INVALID_RELATIVE_PATH';
    throw error;
  }
  return value === '' ? [] : value.split('/');
}

function joinPortableRelativePath(parent, childName) {
  if (!isPortableRelativePath(parent) || typeof childName !== 'string'
      || childName.length === 0 || childName.includes('/') || childName.includes('\\')
      || childName === '.' || childName === '..' || childName.includes('\0')) {
    const error = new Error('Invalid portable path segment');
    error.code = 'INVALID_RELATIVE_PATH';
    throw error;
  }
  return parent ? `${parent}/${childName}` : childName;
}

module.exports = {
  getRootPathFlavor,
  isPortableRelativePath,
  joinPortableRelativePath,
  splitPortableRelativePath
};
```

- [ ] **Step 4: Run GREEN for path codec**

```bash
npx jest tests/unit/pathCodec.test.js --runInBand --silent
```

Expected: 1 suite PASS.

- [ ] **Step 5: Add complete contract fixtures**

Create `tests/helpers/directoryContractFixtures.js`:

```js
const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

function createRuntimeSourceV1(overrides = {}) {
  return { sourceId: SOURCE_ID, rootPath: '/photos', ...overrides };
}

function createDirectoryRefV1(overrides = {}) {
  return { sourceId: SOURCE_ID, relativePath: '', ...overrides };
}

function createDirectoryLevelRequestV1(overrides = {}) {
  return {
    contractVersion: 1,
    runtimeSource: createRuntimeSourceV1(overrides.runtimeSource),
    ref: createDirectoryRefV1(overrides.ref),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'runtimeSource' && key !== 'ref')
    )
  };
}

function createDirectorySnapshotV1(overrides = {}) {
  return {
    contractVersion: 1,
    ref: createDirectoryRefV1(),
    locator: { absolutePath: '/photos' },
    name: 'photos',
    status: 'ready',
    observedAt: 1783728000000,
    revision: 'snap_fixture_1',
    completeness: { entries: 'complete', directMedia: 'complete', children: 'complete' },
    facts: { directMediaCount: 1, childDirectoryCount: 1 },
    directMedia: [
      { relativePath: 'cover.jpg', name: 'cover.jpg', size: 1234, mtimeMs: 1783728000000 }
    ],
    children: [
      {
        ref: createDirectoryRefV1({ relativePath: 'album' }),
        name: 'album',
        status: 'ready',
        completeness: { directMedia: 'complete', children: 'complete' },
        facts: { directMediaCount: 1, childDirectoryCount: 0 },
        approximate: {
          coverSamples: ['album/1.jpg'],
          hasDescendantMedia: 'yes',
          observedAt: 1783728000000,
          truncated: false
        }
      }
    ],
    approximate: {
      coverSamples: ['cover.jpg'],
      hasDescendantMedia: 'yes',
      observedAt: 1783728000000,
      truncated: true
    },
    ...overrides
  };
}

module.exports = {
  SOURCE_ID,
  createDirectoryLevelRequestV1,
  createDirectoryRefV1,
  createDirectorySnapshotV1,
  createRuntimeSourceV1
};
```

- [ ] **Step 6: Write failing contract tests**

Create `tests/unit/contracts/directoryContractV1.test.js` with tests that import the APIs listed below and assert:

```js
const {
  DIRECTORY_CONTRACT_VERSION,
  createDirectoryErrorEnvelopeV1,
  createDirectorySuccessEnvelopeV1,
  deriveDirectoryCapabilitiesV1,
  validateDirectoryEnvelopeV1,
  validateDirectoryLevelRequestV1,
  validateDirectorySnapshotV1
} = require('../../../src/common/contracts/directory-contract-v1');
const {
  createDirectoryLevelRequestV1,
  createDirectorySnapshotV1
} = require('../../helpers/directoryContractFixtures');

describe('directory-contract-v1', () => {
  test('accepts a canonical runtimeSource plus DirectoryRef request', () => {
    const result = validateDirectoryLevelRequestV1(createDirectoryLevelRequestV1());
    expect(DIRECTORY_CONTRACT_VERSION).toBe(1);
    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  test('rejects unsupported version and mismatched source ids', () => {
    const wrongVersion = validateDirectoryLevelRequestV1(
      createDirectoryLevelRequestV1({ contractVersion: 2 })
    );
    const mismatch = validateDirectoryLevelRequestV1(
      createDirectoryLevelRequestV1({ ref: { sourceId: 'src_22222222-2222-4222-8222-222222222222' } })
    );
    expect(wrongVersion.valid).toBe(false);
    expect(wrongVersion.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.contractVersion', code: 'enum' })
    ]));
    expect(mismatch.valid).toBe(false);
    expect(mismatch.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.ref.sourceId', code: 'invariant' })
    ]));
  });

  test('derives tri-state capabilities and content kinds from facts', () => {
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 2, childDirectoryCount: 1 }
    })).toEqual({ canViewDirectMedia: true, canBrowseChildren: true, contentKind: 'hybrid' });
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 0 }
    })).toEqual({ canViewDirectMedia: false, canBrowseChildren: false, contentKind: 'empty' });
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'partial', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 1 }
    })).toEqual({ canViewDirectMedia: 'unknown', canBrowseChildren: true, contentKind: 'unknown' });
  });

  test('validates a complete snapshot and rejects recursive or legacy fields', () => {
    expect(validateDirectorySnapshotV1(createDirectorySnapshotV1()).valid).toBe(true);
    expect(validateDirectorySnapshotV1(createDirectorySnapshotV1({ type: 'album' })).valid).toBe(false);
    const recursive = createDirectorySnapshotV1();
    recursive.children[0].children = [];
    expect(validateDirectorySnapshotV1(recursive).valid).toBe(false);
  });

  test('validates success and failure envelopes with one shape each', () => {
    const success = createDirectorySuccessEnvelopeV1(createDirectorySnapshotV1());
    const failure = createDirectoryErrorEnvelopeV1('ENOENT', '目录不存在', { retryable: false });
    expect(validateDirectoryEnvelopeV1(success).valid).toBe(true);
    expect(validateDirectoryEnvelopeV1(failure).valid).toBe(true);
    expect(success).not.toHaveProperty('error');
    expect(failure).not.toHaveProperty('data');
  });
});
```

- [ ] **Step 7: Run RED for the contract**

```bash
npx jest tests/unit/contracts/directoryContractV1.test.js --runInBand --silent
```

Expected: FAIL because `directory-contract-v1.js` does not exist.

- [ ] **Step 8: Implement `directory-contract-v1.js`**

Implement these exact exports without a schema dependency:

```js
const DIRECTORY_CONTRACT_VERSION = 1;
const DIRECTORY_STATUSES = Object.freeze(['ready', 'unreadable', 'missing', 'sourceOffline']);
const COMPLETENESS_STATUSES = Object.freeze(['complete', 'partial']);
const DESCENDANT_MEDIA_STATUSES = Object.freeze(['yes', 'no', 'unknown']);
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_FIELDS = Object.freeze([
  'type', 'kind', 'canOpenAlbum', 'canViewAsPhotoSet', 'hasImages',
  'imageCount', 'directImageCount', 'childFolders'
]);
```

The module must export:

```js
{
  DIRECTORY_CONTRACT_VERSION,
  DIRECTORY_STATUSES,
  COMPLETENESS_STATUSES,
  DESCENDANT_MEDIA_STATUSES,
  createDirectoryErrorEnvelopeV1,
  createDirectorySuccessEnvelopeV1,
  deriveDirectoryCapabilitiesV1,
  validateDirectoryEnvelopeV1,
  validateDirectoryLevelRequestV1,
  validateDirectoryRefV1,
  validateDirectorySnapshotV1,
  validateRuntimeSourceV1
}
```

All validators return `{ valid: boolean, issues: Array<{ path, code, message }>, value? }`; issue `code` is one of `required|type|format|enum|invariant`. Required validation rules are the Global Constraints plus:

```js
// count projection
function deriveTriState(count, completeness) {
  if (Number.isInteger(count) && count > 0) return true;
  if (completeness === 'complete' && count === 0) return false;
  return 'unknown';
}

function deriveDirectoryCapabilitiesV1(record) {
  const canViewDirectMedia = deriveTriState(
    record?.facts?.directMediaCount,
    record?.completeness?.directMedia
  );
  const canBrowseChildren = deriveTriState(
    record?.facts?.childDirectoryCount,
    record?.completeness?.children
  );
  let contentKind = 'unknown';
  if (canViewDirectMedia === true && canBrowseChildren === true) contentKind = 'hybrid';
  if (canViewDirectMedia === true && canBrowseChildren === false) contentKind = 'photoSet';
  if (canViewDirectMedia === false && canBrowseChildren === true) contentKind = 'container';
  if (canViewDirectMedia === false && canBrowseChildren === false) contentKind = 'empty';
  return { canViewDirectMedia, canBrowseChildren, contentKind };
}
```

Snapshot validation must enforce:

- valid root `ref`, non-empty `locator.absolutePath`, `name`, `revision`, non-negative finite `observedAt`;
- allowed status/completeness/descendant enum values;
- non-negative integer counts and complete root `directMediaCount === directMedia.length`;
- every media/ref uses the root `sourceId` and is exactly one segment below the root `relativePath`;
- children are summaries and cannot contain nested `children` or `directMedia`;
- no object in the canonical graph owns any `LEGACY_FIELDS` key;
- success envelope owns `data` but not `error`; failure owns `error` but not `data`.

- [ ] **Step 9: Run the focused shared-contract tests**

```bash
npx jest tests/unit/pathCodec.test.js tests/unit/contracts/directoryContractV1.test.js --runInBand --silent
```

Expected: 2 suites PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add src/common/path-codec.js src/common/contracts/directory-contract-v1.js tests/helpers/directoryContractFixtures.js tests/unit/pathCodec.test.js tests/unit/contracts/directoryContractV1.test.js docs/superpowers/plans/2026-07-11-directory-contract-v1.md
git diff --cached --check
git commit -m "feat(contract): add directory snapshot v1 schema"
```

---

### Task 2: Add the canonical single-level DirectorySnapshot service

**Files:**
- Create: `src/main/services/DirectorySnapshotService.js`
- Create: `tests/unit/services/DirectorySnapshotService.test.js`

**Interfaces:**
- Consumes: Task 1 request/snapshot contract and portable path helpers; `SUPPORTED_FORMATS` from `FileSystemService` only.
- Produces: `createDirectorySnapshotService()`, `resolveDirectoryLocatorV1(request)`, `scanDirectorySnapshot(locator, options)`.

- [ ] **Step 1: Write failing service tests**

Create `tests/unit/services/DirectorySnapshotService.test.js`. Use `createFsMock`, restore mock-fs after every test, and construct the service after the filesystem mock. Required tests:

```js
/** @jest-environment node */

const fs = require('fs');
const { createFsMock } = require('../../helpers/fsMock');
const { createDirectoryLevelRequestV1 } = require('../../helpers/directoryContractFixtures');

describe('DirectorySnapshotService', () => {
  let mockFs;
  afterEach(() => {
    jest.restoreAllMocks();
    mockFs?.restore();
    mockFs = null;
  });

  function loadService(overrides = {}) {
    const { createDirectorySnapshotService } = require('../../../src/main/services/DirectorySnapshotService');
    return createDirectorySnapshotService({
      fsApi: fs.promises,
      now: () => 1783728000000,
      makeRevision: () => 'snap_test_1',
      ...overrides
    });
  }

  test('returns canonical facts for photo, container, hybrid, empty, and unsupported-only children', async () => {
    mockFs = createFsMock({
      '/photos': {
        'cover.jpg': Buffer.from('root'),
        photo: { '1.jpg': Buffer.from('one') },
        container: { nested: {} },
        hybrid: { '2.jpg': Buffer.from('two'), nested: {} },
        empty: {},
        documents: { 'notes.txt': 'ignored' }
      }
    });
    const service = loadService();
    const locator = service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1());
    const snapshot = await service.scanDirectorySnapshot(locator, { concurrencyLimit: 2 });

    expect(snapshot.status).toBe('ready');
    expect(snapshot.facts).toEqual({ directMediaCount: 1, childDirectoryCount: 5 });
    expect(snapshot.directMedia[0]).toMatchObject({ relativePath: 'cover.jpg', name: 'cover.jpg' });
    expect(snapshot.children.map((child) => child.name)).toEqual([
      'container', 'documents', 'empty', 'hybrid', 'photo'
    ]);
    expect(snapshot.children.find((child) => child.name === 'empty')).toMatchObject({
      status: 'ready',
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 0 },
      approximate: { hasDescendantMedia: 'no', truncated: false }
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/"(type|kind|canOpenAlbum|hasImages|imageCount|childFolders)"/);
  });

  test('keeps an unreadable child as a partial child summary', async () => {
    mockFs = createFsMock({ '/photos': { locked: { '1.jpg': Buffer.from('one') } } });
    const originalReaddir = fs.promises.readdir.bind(fs.promises);
    jest.spyOn(fs.promises, 'readdir').mockImplementation((target) => {
      if (String(target) === '/photos/locked') {
        return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      }
      return originalReaddir(target);
    });
    const service = loadService();
    const snapshot = await service.scanDirectorySnapshot(
      service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1())
    );
    expect(snapshot.children[0]).toMatchObject({
      name: 'locked',
      status: 'unreadable',
      completeness: { directMedia: 'partial', children: 'partial' },
      approximate: { hasDescendantMedia: 'unknown', truncated: true }
    });
  });

  test('marks counts partial when one immediate stat fails', async () => {
    mockFs = createFsMock({ '/photos': { good: {}, broken: {} } });
    const originalStat = fs.promises.stat.bind(fs.promises);
    jest.spyOn(fs.promises, 'stat').mockImplementation((target) => {
      if (String(target) === '/photos/broken') {
        return Promise.reject(Object.assign(new Error('stale'), { code: 'ESTALE' }));
      }
      return originalStat(target);
    });
    const service = loadService();
    const snapshot = await service.scanDirectorySnapshot(
      service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1())
    );
    expect(snapshot.completeness).toEqual({
      entries: 'partial', directMedia: 'partial', children: 'partial'
    });
    expect(snapshot.facts.childDirectoryCount).toBe(1);
  });

  test.each([
    ['ENOENT', 'missing'],
    ['EACCES', 'unreadable']
  ])('throws %s with directoryStatus %s for an unavailable root', async (code, directoryStatus) => {
    const service = loadService({
      fsApi: {
        readdir: jest.fn().mockRejectedValue(Object.assign(new Error(code), { code })),
        stat: jest.fn()
      }
    });
    await expect(service.scanDirectorySnapshot({
      ref: createDirectoryLevelRequestV1().ref,
      absolutePath: '/photos',
      name: 'photos'
    })).rejects.toMatchObject({ code, directoryStatus });
  });

  test('resolves POSIX, Windows drive, and UNC locators without escaping the root', () => {
    const service = loadService();
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: '/photos' }, ref: { relativePath: '2026/trip' }
    })).absolutePath).toBe('/photos/2026/trip');
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: 'C:\\Photos' }, ref: { relativePath: '2026/trip' }
    })).absolutePath).toBe('C:\\Photos\\2026\\trip');
    expect(service.resolveDirectoryLocatorV1(createDirectoryLevelRequestV1({
      runtimeSource: { rootPath: '\\\\server\\share\\Photos' }, ref: { relativePath: '2026/trip' }
    })).absolutePath).toBe('\\\\server\\share\\Photos\\2026\\trip');
  });
});
```

- [ ] **Step 2: Run RED for the service**

```bash
npx jest tests/unit/services/DirectorySnapshotService.test.js --runInBand --silent
```

Expected: FAIL because `DirectorySnapshotService.js` does not exist.

- [ ] **Step 3: Implement the service with one shared I/O scheduler**

Create `src/main/services/DirectorySnapshotService.js` with these exact public APIs:

```js
function createDirectorySnapshotService({
  fsApi = fs.promises,
  now = () => Date.now(),
  makeRevision = () => `snap_${crypto.randomUUID()}`,
  supportedFormats = SUPPORTED_FORMATS
} = {}) {
  return { resolveDirectoryLocatorV1, scanDirectorySnapshot };
}

module.exports = {
  createDirectorySnapshotService,
  resolveDirectoryLocatorV1: defaultService.resolveDirectoryLocatorV1,
  scanDirectorySnapshot: defaultService.scanDirectorySnapshot
};
```

Implementation requirements:

```js
function createScheduler(limit) {
  const max = Math.max(1, Math.min(8, Number(limit) || 5));
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < max && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        drain();
      });
    }
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}
```

- `resolveDirectoryLocatorV1()` first calls `validateDirectoryLevelRequestV1`; invalid requests throw the first issue with code `INVALID_REQUEST`.
- Choose `path.posix` or `path.win32` from `getRootPathFlavor(runtimeSource.rootPath)`; split only via `splitPortableRelativePath()`.
- Resolve root and target, then reject a `path.relative(root, target)` beginning with `..` or absolute using error code `PATH_OUTSIDE_SOURCE`.
- `scanDirectorySnapshot()` creates one scheduler per snapshot and wraps every `readdir/stat` call with it; never hold a scheduler slot while scheduling nested I/O.
- Read root immediate entries once, classify each entry by `stat`, and then read each identified child exactly one level for its summary. Do not recurse into grandchildren.
- Any individual entry `stat` failure keeps status `ready` but marks all affected completeness values `partial`; counts are lower bounds.
- A child `readdir` error produces child `status: missing|unreadable`, partial completeness, zero lower-bound facts, `unknown`, `truncated:true`.
- Root `readdir` `ENOENT|ENOTDIR` throws with `directoryStatus:'missing'`; `EACCES|EPERM` throws with `directoryStatus:'unreadable'`; other errors throw unchanged with `directoryStatus:'unreadable'`.
- `hasDescendantMedia`: direct media found → `yes`; complete leaf with 0 media/0 child → `no`; otherwise `unknown`.
- `coverSamples` uses up to four naturally sorted direct media relative paths; `truncated` is true for partial observations or when child directories exist and grandchildren were not scanned.
- Root and child names sort via `localeCompare(undefined, { numeric:true, sensitivity:'base' })`.
- Build a single-layer snapshot exactly matching the Task 1 contract and validate it before return; invalid output throws `INVALID_RESPONSE` without exposing issues through IPC stack traces.

- [ ] **Step 4: Run GREEN and legacy regression tests**

```bash
npx jest tests/unit/services/DirectorySnapshotService.test.js tests/unit/fileSystemService.test.js --runInBand --silent
```

Expected: both suites PASS; existing legacy assertions remain unchanged.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/main/services/DirectorySnapshotService.js tests/unit/services/DirectorySnapshotService.test.js
git diff --cached --check
git commit -m "feat(main): add canonical directory snapshot scanner"
```

---

### Task 3: Expose GET_DIRECTORY_LEVEL_V1 without changing legacy navigation

**Files:**
- Modify: `src/common/ipc-channels.js`
- Modify: `src/main/preload.js`
- Modify: `src/main/main.js`
- Modify: `tests/helpers/mainProcessHarness.js`
- Create: `tests/unit/mainDirectoryLevelV1Ipc.test.js`
- Create: `tests/unit/preloadIpcAllowlist.test.js`

**Interfaces:**
- Consumes: Task 1 validators/envelopes and Task 2 resolver/scanner.
- Produces: allowlisted `GET_DIRECTORY_LEVEL_V1` with a single versioned envelope; old navigation handler remains isolated.

- [ ] **Step 1: Write failing IPC and preload tests**

Create `tests/unit/mainDirectoryLevelV1Ipc.test.js` using `setupMainProcess()` and the complete fixture factories. Required assertions:

```js
/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');
const { setupMainProcess } = require('../helpers/mainProcessHarness');
const {
  createDirectoryLevelRequestV1,
  createDirectorySnapshotV1
} = require('../helpers/directoryContractFixtures');

describe('GET_DIRECTORY_LEVEL_V1 IPC', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns one success envelope for a valid snapshot', async () => {
    const request = createDirectoryLevelRequestV1();
    const locator = { ref: request.ref, absolutePath: '/photos', name: 'photos' };
    const snapshot = createDirectorySnapshotV1();
    const resolveDirectoryLocatorV1 = jest.fn(() => locator);
    const scanDirectorySnapshot = jest.fn().mockResolvedValue(snapshot);
    const { electron } = setupMainProcess({
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot }
    });
    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);
    expect(result).toEqual({ contractVersion: 1, ok: true, data: snapshot });
    expect(resolveDirectoryLocatorV1).toHaveBeenCalledWith(request);
    expect(scanDirectorySnapshot).toHaveBeenCalledWith(locator, { concurrencyLimit: expect.any(Number) });
  });

  test('rejects unsupported versions without scanning', async () => {
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({ directorySnapshotService: { scanDirectorySnapshot } });
    const result = await electron.ipcMain.invoke(
      CHANNELS.GET_DIRECTORY_LEVEL_V1,
      createDirectoryLevelRequestV1({ contractVersion: 2 })
    );
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: { code: 'UNSUPPORTED_CONTRACT_VERSION', retryable: false }
    });
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    ['ENOENT', 'ENOENT', false],
    ['EPERM', 'EACCES', false],
    ['EIO', 'IO_ERROR', true]
  ])('maps %s without leaking a raw error', async (sourceCode, expectedCode, retryable) => {
    const error = Object.assign(new Error('scan failed'), { code: sourceCode });
    const request = createDirectoryLevelRequestV1();
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({ ref: request.ref, absolutePath: '/photos', name: 'photos' })),
        scanDirectorySnapshot: jest.fn().mockRejectedValue(error)
      }
    });
    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: { code: expectedCode, message: 'scan failed', retryable }
    });
    expect(result.error).not.toHaveProperty('stack');
  });

  test('keeps legacy SCAN_NAVIGATION_LEVEL isolated from V1', async () => {
    const legacyResponse = { success: true, nodes: [], directImages: [], metadata: { totalNodes: 0 } };
    const scanNavigationLevel = jest.fn().mockResolvedValue(legacyResponse);
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({
      fileSystemService: { scanNavigationLevel },
      directorySnapshotService: { scanDirectorySnapshot }
    });
    const handler = electron.ipcMain._handlers.get(CHANNELS.SCAN_NAVIGATION_LEVEL);
    const event = { sender: { isDestroyed: jest.fn(() => false), send: jest.fn() } };
    const result = await handler(event, '/legacy');
    expect(result).toBe(legacyResponse);
    expect(scanNavigationLevel).toHaveBeenCalledWith('/legacy', expect.objectContaining({
      concurrencyLimit: expect.any(Number), onProgress: expect.any(Function)
    }));
    expect(event.sender.send).toHaveBeenCalledWith(
      CHANNELS.SCAN_NAVIGATION_PROGRESS,
      expect.objectContaining({ done: true, targetPath: '/legacy' })
    );
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });
});
```

Create `tests/unit/preloadIpcAllowlist.test.js` with a reusable loader that mocks Electron `contextBridge`, captures the exposed API, and asserts:

```js
/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');

function loadPreload({ useFallback = false } = {}) {
  jest.resetModules();
  const exposed = {};
  const electron = {
    contextBridge: { exposeInMainWorld: jest.fn((name, api) => { exposed[name] = api; }) },
    ipcRenderer: {
      invoke: jest.fn().mockResolvedValue('ok'), send: jest.fn(), on: jest.fn(),
      once: jest.fn(), removeListener: jest.fn()
    },
    webUtils: { getPathForFile: jest.fn(() => '') }
  };
  jest.doMock('electron', () => electron);
  if (useFallback) {
    jest.doMock('../../src/common/ipc-channels', () => { throw new Error('unavailable'); });
  }
  require('../../src/main/preload');
  return { api: exposed.electronAPI, electron };
}

describe('preload IPC allowlist', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.dontMock('../../src/common/ipc-channels');
  });

  test.each([false, true])('allows GET_DIRECTORY_LEVEL_V1 (fallback=%s)', async (useFallback) => {
    const { api, electron } = loadPreload({ useFallback });
    const request = { contractVersion: 1 };
    await expect(api.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request)).resolves.toBe('ok');
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith('get-directory-level-v1', request);
  });

  test('continues blocking unknown invoke channels', () => {
    const { api } = loadPreload();
    expect(() => api.invoke('unknown-channel')).toThrow('Blocked IPC invoke channel');
  });
});
```

- [ ] **Step 2: Run RED for IPC integration**

```bash
npx jest tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/preloadIpcAllowlist.test.js --runInBand --silent
```

Expected: FAIL because the channel, handler, allowlist, and harness service boundary do not exist.

- [ ] **Step 3: Implement the new channel and preload allowlist**

Add to shared and fallback CHANNELS:

```js
GET_DIRECTORY_LEVEL_V1: 'get-directory-level-v1'
```

Add `CHANNELS.GET_DIRECTORY_LEVEL_V1` once to `INVOKE_CHANNELS`. Do not modify renderer code or unrelated duplicate allowlist entries.

- [ ] **Step 4: Extend the main-process harness**

Change the signature to:

```js
const setupMainProcess = ({
  fileSystemService = {},
  directorySnapshotService = {},
  configureElectron
} = {}) => { /* existing setup */ };
```

Mock `../../src/main/services/DirectorySnapshotService` with defaults:

```js
const resolvedDirectorySnapshotService = {
  resolveDirectoryLocatorV1: jest.fn(),
  scanDirectorySnapshot: jest.fn(),
  ...directorySnapshotService
};
```

Return `{ electron, fileSystemService: resolvedFileSystemService, directorySnapshotService: resolvedDirectorySnapshotService }`.

- [ ] **Step 5: Implement the versioned main handler**

Import Task 1 contract helpers and Task 2 service. Add a new handler after the unchanged legacy handler. Validation/error behavior:

```js
ipcMain.handle(CHANNELS.GET_DIRECTORY_LEVEL_V1, async (event, request) => {
  const validation = validateDirectoryLevelRequestV1(request);
  if (!validation.valid) {
    const versionIssue = validation.issues.some((issue) => issue.path === '$.contractVersion');
    const sourceIssue = validation.issues.some(
      (issue) => issue.path === '$.ref.sourceId' && issue.code === 'invariant'
    );
    const code = versionIssue
      ? 'UNSUPPORTED_CONTRACT_VERSION'
      : (sourceIssue ? 'SOURCE_ID_MISMATCH' : 'INVALID_REQUEST');
    return createDirectoryErrorEnvelopeV1(code, validation.issues[0]?.message || 'Invalid request', {
      retryable: false,
      details: { issues: validation.issues }
    });
  }

  try {
    const locator = DirectorySnapshotService.resolveDirectoryLocatorV1(validation.value);
    const isAllowed = await assertApprovedPath(locator.absolutePath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return createDirectoryErrorEnvelopeV1('PATH_NOT_APPROVED', 'Path not approved', {
        retryable: false
      });
    }
    const concurrencyLimit = Math.max(
      1,
      Math.min(8, Number(performanceSettings.concurrentTasks) || 5)
    );
    const snapshot = await DirectorySnapshotService.scanDirectorySnapshot(locator, {
      concurrencyLimit
    });
    const snapshotValidation = validateDirectorySnapshotV1(snapshot);
    if (!snapshotValidation.valid) {
      return createDirectoryErrorEnvelopeV1('INVALID_RESPONSE', 'Invalid directory snapshot', {
        retryable: false,
        details: { issues: snapshotValidation.issues }
      });
    }
    return createDirectorySuccessEnvelopeV1(snapshot);
  } catch (error) {
    const sourceCode = error?.code;
    if (sourceCode === 'ENOENT' || sourceCode === 'ENOTDIR') {
      return createDirectoryErrorEnvelopeV1(sourceCode, error.message, { retryable: false });
    }
    if (sourceCode === 'EACCES' || sourceCode === 'EPERM') {
      return createDirectoryErrorEnvelopeV1('EACCES', error.message, { retryable: false });
    }
    if (sourceCode === 'EIO' || sourceCode === 'ESTALE' || sourceCode === 'ETIMEDOUT') {
      return createDirectoryErrorEnvelopeV1('IO_ERROR', error.message, { retryable: true });
    }
    if (sourceCode === 'PATH_OUTSIDE_SOURCE' || sourceCode === 'INVALID_REQUEST') {
      return createDirectoryErrorEnvelopeV1(sourceCode, error.message, { retryable: false });
    }
    return createDirectoryErrorEnvelopeV1('INTERNAL_ERROR', 'Directory scan failed', {
      retryable: false
    });
  }
});
```

- [ ] **Step 6: Run GREEN plus legacy/UI regression tests**

```bash
npx jest tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/preloadIpcAllowlist.test.js tests/unit/mainAlbumImagesIpc.test.js tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx tests/unit/hooks/useBreadcrumbs.test.jsx tests/unit/hooks/useNeighboringAlbums.test.jsx --runInBand --silent
```

Expected: all focused suites PASS; legacy tests remain unchanged.

- [ ] **Step 7: Confirm renderer scope and commit Task 3**

```bash
if git diff --name-only HEAD | rg -q '^src/renderer/'; then
  echo "Phase 1 must not modify renderer files"
  exit 1
fi
git add src/common/ipc-channels.js src/main/preload.js src/main/main.js tests/helpers/mainProcessHarness.js tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/preloadIpcAllowlist.test.js
git diff --cached --check
git commit -m "feat(ipc): expose versioned directory level contract"
```

---

### Task 4: Release and validate DirectorySnapshot V1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: reviewed Tasks 1–3.
- Produces: version `2.6.0` with full tests and runnable `.app` evidence.

- [ ] **Step 1: Bump version without a tag**

```bash
npm version 2.6.0 --no-git-tag-version
```

- [ ] **Step 2: Add the exact changelog entry**

Insert after `# Changelog`:

```markdown
## [2.6.0] - 2026-07-11

- 新增 `DirectorySnapshot v1` 共享契约、三值目录能力投影和跨平台 `DirectoryRef` 路径校验。
- 新增独立 canonical 单层目录扫描服务，明确 exact/partial、empty、missing 与 unreadable 语义，不再从 legacy DTO 反推事实。
- 新增 versioned `GET_DIRECTORY_LEVEL_V1` IPC 与 preload allowlist；现有 renderer、`SCAN_NAVIGATION_LEVEL`、route 和用户可见行为保持不变。
```

- [ ] **Step 3: Run the complete suite**

```bash
npm test -- --runInBand --silent
```

Expected: all suites/tests PASS, 0 failures.

- [ ] **Step 4: Build the runnable app**

```bash
npm run build
```

Expected: webpack succeeds and `electron-builder --dir` generates `.app`; missing Developer ID may skip signing but must be reported.

- [ ] **Step 5: Verify scope and metadata**

```bash
git diff --check
if git diff --name-only main...HEAD | rg -q '^src/renderer/'; then
  echo "Phase 1 must not modify renderer files"
  exit 1
fi
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version"
node -p "require('./package-lock.json').packages[''].version"
git status --short
```

Expected: no renderer changes; all versions are `2.6.0`; `dist/` remains ignored.

- [ ] **Step 6: Commit release metadata**

```bash
git add package.json package-lock.json CHANGELOG.md
git diff --cached --check
git commit -m "chore(release): bump version to 2.6.0"
```

---

## Self-Review

- Spec coverage: shared contract, runtime source/ref boundary, canonical scan, partial/empty/unreadable/missing, envelope, preload, legacy isolation, versioning, tests and `.app` build each map to an explicit task.
- Scope: no SourceRoot persistence, renderer migration, cache/epoch, favorites/session/sort migration, random browse, or legacy deletion is included.
- Type consistency: request uses `runtimeSource + ref`; service resolves to `{ ref, absolutePath, name }`; IPC returns exactly one V1 envelope.
- TDD: every new production module/channel has an explicit RED command before implementation and focused GREEN command after.
- Placeholder scan: no unresolved implementation markers remain.
