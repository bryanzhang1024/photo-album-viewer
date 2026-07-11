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
- Consumes: Task 1 `validateDirectoryLevelRequestV1()`, `validateDirectorySnapshotV1()` and portable path helpers; from `FileSystemService` import **only** `SUPPORTED_FORMATS` (do not import its limiter, mapper, or legacy scanners).
- Produces: `createDirectorySnapshotService()`, `resolveDirectoryLocatorV1(request)`, `scanDirectorySnapshot(locator, options)`. The internal locator is `{ ref, absolutePath, name, pathFlavor }`; the returned canonical `locator` remains exactly `{ absolutePath }`.

The implementation must follow the approved Task 1 truth table for both the root record and every child summary:

| Observation | `hasDescendantMedia` | `truncated` |
|---|---|---|
| observed direct media or a non-empty `coverSamples` | `yes` | `true` iff unavailable, any relevant completeness is partial, or `childDirectoryCount > 0` |
| ready, all relevant completeness complete, 0 media, 0 children | `no` | `false` |
| ready container with no positive media evidence | `unknown` | `true` |
| ready partial observation with no positive media evidence | `unknown` | `true` |
| missing/unreadable child | `unknown` | `true` |

Root `coverSamples` aggregates naturally sorted root direct-media paths and child cover samples, capped at four. This lets a root with no direct media but an observed photo child carry positive descendant evidence while its `directMediaCount` remains zero.

- [ ] **Step 1: Write failing service tests**

Create `tests/unit/services/DirectorySnapshotService.test.js`. Use `createFsMock` for ordinary POSIX trees, injected `fsApi` fakes for non-native Windows/UNC paths and malformed disk entries, restore mock-fs after every test, call `jest.restoreAllMocks()`, and construct the service after the filesystem mock.

```js
/** @jest-environment node */

const fs = require('fs');
const { createFsMock } = require('../../helpers/fsMock');
const { createDirectoryLevelRequestV1 } = require('../../helpers/directoryContractFixtures');
const { validateDirectorySnapshotV1 } = require(
  '../../../src/common/contracts/directory-contract-v1'
);

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
      now: () => 1783728000000,
      makeRevision: () => 'snap_test_1',
      ...overrides
    });
  }
});
```

Add these named tests with the exact assertions below:

1. **`returns the five ready child truth-table rows and aggregate root evidence`**
   - fixture: root `cover.jpg`; `photo/1.jpg`; `container/nested`; `hybrid/2.jpg + nested`; `empty`; `documents/notes.txt`;
   - root facts `{ directMediaCount: 1, childDirectoryCount: 5 }`, completeness all complete, `coverSamples: ['cover.jpg', 'hybrid/2.jpg', 'photo/1.jpg']`, `yes/true`;
   - children sorted `container, documents, empty, hybrid, photo` and each exact row:

     | child | facts | cover samples | descendant/truncated |
     |---|---|---|---|
     | photo | 1 / 0 | `photo/1.jpg` | `yes / false` |
     | container | 0 / 1 | none | `unknown / true` |
     | hybrid | 1 / 1 | `hybrid/2.jpg` | `yes / true` |
     | empty | 0 / 0 | none | `no / false` |
     | documents | 0 / 0 | none | `no / false` |

   - `validateDirectorySnapshotV1(snapshot)` is `{ valid:true }`; no legacy or derived fields are present; uppercase `.JPG` is recognized in a dedicated assertion;
   - two fake `readdir` orders containing `album10, album2, A, a` both produce `A, a, album2, album10`.

2. **`preserves nested target refs`**
   - scan request `relativePath:'2026/trip'`;
   - assert media `2026/trip/1.jpg`, child ref `2026/trip/nested`, locator `/photos/2026/trip`, and name `trip`.

3. **`skips non-portable disk entries and keeps lower bounds internally consistent`**
   - fake a root entry containing `\\` (and separately a drive-relative-looking `C:photo.jpg`) plus one portable child;
   - skip unrepresentable entries, keep root `status:'ready'`, set root `entries/directMedia/children` all partial, and require both facts to equal the returned array lengths;
   - when the invalid entry is inside a readable child, only that child gets partial directMedia/children completeness; root membership completeness stays complete.

4. **`maps child and root I/O failures without guessing sourceOffline`**
   - child `ENOENT|ENOTDIR` => retained `missing` summary; child `EACCES|EPERM|EIO` => retained `unreadable` summary;
   - each unavailable child has partial completeness, 0/0 facts, no samples, `unknown/true`;
   - a child entry `stat` failure keeps the child `ready`, retains discovered lower-bound facts, and makes both child completeness values partial;
   - a root entry `stat` failure keeps root `ready`, makes all three root completeness values partial, and keeps facts equal to returned arrays;
   - root `ENOENT|ENOTDIR` throws with `directoryStatus:'missing'`; root `EACCES|EPERM|EIO` throws with `directoryStatus:'unreadable'`.

5. **`resolves portable locators and preserves their path flavor`**
   - assert POSIX, drive and UNC targets plus internal `pathFlavor`;
   - `/` and `C:\\` with empty relativePath use `pathApi.basename(target) || pathApi.parse(target).root` for a non-empty name;
   - legal `..foo` remains inside the source; invalid request input rejects with `INVALID_REQUEST`;
   - Windows/UNC fake scans assert child `stat/readdir` receive only `\\`-joined paths, never host-POSIX mixed paths.

6. **`performs a single-level scan with bounded leaf I/O`**
   - assert root `readdir` once, every identified direct child `readdir` once, and no `readdir` for a grandchild;
   - with `concurrencyLimit:1`, a container/hybrid fixture completes (no nested-scheduler deadlock) and peak in-flight `readdir/stat` is 1;
   - repeat with limit 2 and deferred fake I/O, assert peak is greater than 1 and at most 2.

7. **`aggregates root approximate evidence from children`**
   - a root with 0 direct media and one photo child exposes that child's sample in root `coverSamples`, yielding root `yes/true` while root `directMediaCount` stays 0;
   - a root with only an unproven container is `unknown/true`; a complete empty root is `no/false`.

8. **`exports and validates the public API`**
   - default `resolveDirectoryLocatorV1` and `scanDirectorySnapshot` plus the factory are functions;
   - resolver validation failure throws `INVALID_REQUEST`;
   - `makeRevision: () => ''` forces snapshot validation failure; the rejection matches `{ code:'INVALID_RESPONSE', message:'Invalid directory snapshot' }` and owns neither `issues` nor `details`.

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

- Import `SUPPORTED_FORMATS` only and copy it at factory creation into a lowercase `Set`; never mutate the exported array. Media extension checks are case-insensitive.
- `resolveDirectoryLocatorV1()` first calls `validateDirectoryLevelRequestV1`; invalid requests throw `INVALID_REQUEST`. Select `path.posix` or `path.win32` with `getRootPathFlavor()`, split only through `splitPortableRelativePath()`, and return the flavor on the internal locator.
- Resolve root and target, then reject only this containment predicate with `PATH_OUTSIDE_SOURCE`:

  ```js
  const relative = pathApi.relative(resolvedRoot, resolvedTarget);
  const outside = pathApi.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${pathApi.sep}`);
  ```

  Do not use bare `startsWith('..')`; `..foo` is a valid in-root segment. Compute `name` as `pathApi.basename(resolvedTarget) || pathApi.parse(resolvedTarget).root`.
- Derive the scanner's `pathApi` from `locator.pathFlavor` for every absolute child/media join; emit only `{ absolutePath }` into the canonical snapshot locator.
- Create exactly one scheduler per snapshot. Wrap leaf I/O only:

  ```js
  const readDirectory = (target) => schedule(() => fsApi.readdir(target));
  const readStats = (target) => schedule(() => fsApi.stat(target));
  ```

  Never call `schedule(() => scanChild(...))` or hold a slot while scheduling more I/O.
- Read the root immediate entries once, classify each by `stat`, then read each identified direct child once for its summary. Stat that child's immediate entries, but never read a grandchild directory.
- Convert disk names through `joinPortableRelativePath()`. On `INVALID_RELATIVE_PATH`, skip that single entry instead of failing the snapshot. A skipped root entry makes all three root completeness fields partial; a skipped entry inside a child makes that child's directMedia/children partial. Counts always equal the returned arrays and are lower bounds when partial.
- Keep a readable directory `status:'ready'` when an individual `stat` fails. Map root/child `ENOENT|ENOTDIR` to missing and `EACCES|EPERM|other I/O` to unreadable; never synthesize `sourceOffline` in Phase 1. Top-level unavailable directories throw; unavailable children remain summaries.
- Use one fixed `observedAt = now()` and one revision per snapshot. Direct media carry finite `mtimeMs` as observed (including valid pre-epoch values) and non-negative size.
- Child cover samples are up to four naturally sorted direct-media paths. Root cover samples are the naturally sorted union of root direct-media paths and child cover samples, capped at four. Derive `hasDescendantMedia/truncated` exactly from the Task 1 truth table above.
- Use a deterministic natural comparator with a fixed locale plus a code-unit tie-break, rather than host-locale `localeCompare(undefined, ...)`, for direct media, children and cover samples:

  ```js
  const primary = left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
  if (primary !== 0) return primary;
  return left === right ? 0 : (left < right ? -1 : 1);
  ```

- Build only Task 1 canonical fields. Validate with `validateDirectorySnapshotV1()` before return; invalid output throws `INVALID_RESPONSE` with the stable message `Invalid directory snapshot` and no raw issues on the error object.

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
  validateDirectoryEnvelopeV1
} = require('../../src/common/contracts/directory-contract-v1');
const {
  createDirectoryLevelRequestV1,
  createDirectorySnapshotV1
} = require('../helpers/directoryContractFixtures');

function expectValidV1Envelope(result) {
  expect(validateDirectoryEnvelopeV1(result)).toMatchObject({
    valid: true,
    issues: []
  });
}

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
    const scanNavigationLevel = jest.fn();
    const { electron } = setupMainProcess({
      fileSystemService: { scanNavigationLevel },
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot }
    });
    const handler = electron.ipcMain._handlers.get(CHANNELS.GET_DIRECTORY_LEVEL_V1);
    const event = { sender: { isDestroyed: jest.fn(() => false), send: jest.fn() } };
    const result = await handler(event, request);
    expect(result).toEqual({ contractVersion: 1, ok: true, data: snapshot });
    expectValidV1Envelope(result);
    expect(resolveDirectoryLocatorV1).toHaveBeenCalledWith(request);
    expect(scanDirectorySnapshot).toHaveBeenCalledWith(locator, { concurrencyLimit: expect.any(Number) });
    expect(scanNavigationLevel).not.toHaveBeenCalled();
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  test('maps an unavailable root service response to INVALID_RESPONSE', async () => {
    const request = createDirectoryLevelRequestV1();
    const snapshot = createDirectorySnapshotV1({
      status: 'missing',
      completeness: { entries: 'partial', directMedia: 'partial', children: 'partial' },
      facts: { directMediaCount: 0, childDirectoryCount: 0 },
      directMedia: [],
      children: [],
      approximate: {
        coverSamples: [],
        hasDescendantMedia: 'unknown',
        observedAt: 1783728000000,
        truncated: true
      }
    });
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref, absolutePath: '/photos', name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockResolvedValue(snapshot)
      }
    });
    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: { code: 'INVALID_RESPONSE', retryable: false }
    });
    expectValidV1Envelope(result);
  });

  test('rejects unsupported versions without scanning', async () => {
    const resolveDirectoryLocatorV1 = jest.fn();
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot }
    });
    const result = await electron.ipcMain.invoke(
      CHANNELS.GET_DIRECTORY_LEVEL_V1,
      createDirectoryLevelRequestV1({ contractVersion: 2 })
    );
    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'UNSUPPORTED_CONTRACT_VERSION',
        message: 'Unsupported contract version',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(resolveDirectoryLocatorV1).not.toHaveBeenCalled();
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    [
      'missing contract version',
      (request) => { delete request.contractVersion; },
      'INVALID_REQUEST',
      'Contract version is required'
    ],
    [
      'non-numeric contract version',
      (request) => { request.contractVersion = '1'; },
      'INVALID_REQUEST',
      'Contract version must be a number'
    ],
    [
      'mismatched source ids',
      (request) => {
        request.ref.sourceId = 'src_22222222-2222-4222-8222-222222222222';
      },
      'SOURCE_ID_MISMATCH',
      'Directory ref must match runtime source'
    ]
  ])('classifies %s with the selected validation message', async (
    _label,
    mutateRequest,
    expectedCode,
    expectedMessage
  ) => {
    const request = createDirectoryLevelRequestV1();
    mutateRequest(request);
    const resolveDirectoryLocatorV1 = jest.fn();
    const scanDirectorySnapshot = jest.fn();
    const { electron } = setupMainProcess({
      directorySnapshotService: { resolveDirectoryLocatorV1, scanDirectorySnapshot }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toMatchObject({
      contractVersion: 1,
      ok: false,
      error: {
        code: expectedCode,
        message: expectedMessage,
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(resolveDirectoryLocatorV1).not.toHaveBeenCalled();
    expect(scanDirectorySnapshot).not.toHaveBeenCalled();
  });

  test.each([
    ['ENOENT', 'ENOENT', false],
    ['ENOTDIR', 'ENOTDIR', false],
    ['EACCES', 'EACCES', false],
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
    expectValidV1Envelope(result);
    expect(result.error).not.toHaveProperty('stack');
  });

  test('preserves a service INVALID_RESPONSE without exposing internal validation details', async () => {
    const request = createDirectoryLevelRequestV1();
    const error = Object.assign(new Error('internal snapshot invariant details'), {
      code: 'INVALID_RESPONSE'
    });
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref, absolutePath: '/photos', name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockRejectedValue(error)
      }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Invalid directory response',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(JSON.stringify(result)).not.toContain('internal snapshot invariant details');
  });

  test('sanitizes unknown service errors', async () => {
    const request = createDirectoryLevelRequestV1();
    const error = Object.assign(new Error('sensitive filesystem detail'), {
      code: 'UNEXPECTED_NATIVE_ERROR'
    });
    const { electron } = setupMainProcess({
      directorySnapshotService: {
        resolveDirectoryLocatorV1: jest.fn(() => ({
          ref: request.ref, absolutePath: '/photos', name: 'photos'
        })),
        scanDirectorySnapshot: jest.fn().mockRejectedValue(error)
      }
    });

    const result = await electron.ipcMain.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, request);

    expect(result).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Directory scan failed',
        retryable: false
      }
    });
    expectValidV1Envelope(result);
    expect(result.error).not.toHaveProperty('stack');
    expect(JSON.stringify(result)).not.toContain('sensitive filesystem detail');
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
    jest.dontMock('electron');
    jest.dontMock('../../src/common/ipc-channels');
    jest.resetModules();
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

Import Task 1 contract helpers (including `validateDirectoryEnvelopeV1`) and Task 2 service. Add the finalizer and new handler after the unchanged legacy handler. Every success and error return must pass through the finalizer:

```js
function finalizeDirectoryEnvelopeV1(envelope) {
  const validation = validateDirectoryEnvelopeV1(envelope);
  if (validation.valid) {
    return envelope;
  }

  return createDirectoryErrorEnvelopeV1(
    'INVALID_RESPONSE',
    'Invalid directory response',
    {
      retryable: false,
      details: { issues: validation.issues }
    }
  );
}

ipcMain.handle(CHANNELS.GET_DIRECTORY_LEVEL_V1, async (event, request) => {
  const validation = validateDirectoryLevelRequestV1(request);
  if (!validation.valid) {
    const versionIssue = validation.issues.find(
      (issue) => issue.path === '$.contractVersion' && issue.code === 'enum'
    );
    const sourceIssue = validation.issues.find(
      (issue) => issue.path === '$.ref.sourceId' && issue.code === 'invariant'
    );
    const selectedIssue = versionIssue || sourceIssue || validation.issues[0];
    const code = versionIssue
      ? 'UNSUPPORTED_CONTRACT_VERSION'
      : (sourceIssue ? 'SOURCE_ID_MISMATCH' : 'INVALID_REQUEST');
    return finalizeDirectoryEnvelopeV1(
      createDirectoryErrorEnvelopeV1(code, selectedIssue?.message || 'Invalid request', {
        retryable: false,
        details: { issues: validation.issues }
      })
    );
  }

  try {
    const locator = DirectorySnapshotService.resolveDirectoryLocatorV1(validation.value);
    const isAllowed = await assertApprovedPath(locator.absolutePath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('PATH_NOT_APPROVED', 'Path not approved', {
          retryable: false
        })
      );
    }
    const concurrencyLimit = Math.max(
      1,
      Math.min(8, Number(performanceSettings.concurrentTasks) || 5)
    );
    const snapshot = await DirectorySnapshotService.scanDirectorySnapshot(locator, {
      concurrencyLimit
    });
    return finalizeDirectoryEnvelopeV1(createDirectorySuccessEnvelopeV1(snapshot));
  } catch (error) {
    const sourceCode = error?.code;
    if (sourceCode === 'INVALID_RESPONSE') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1(
          'INVALID_RESPONSE',
          'Invalid directory response',
          { retryable: false }
        )
      );
    }
    if (sourceCode === 'ENOENT' || sourceCode === 'ENOTDIR') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1(sourceCode, error.message, { retryable: false })
      );
    }
    if (sourceCode === 'EACCES' || sourceCode === 'EPERM') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('EACCES', error.message, { retryable: false })
      );
    }
    if (sourceCode === 'EIO' || sourceCode === 'ESTALE' || sourceCode === 'ETIMEDOUT') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('IO_ERROR', error.message, { retryable: true })
      );
    }
    if (sourceCode === 'PATH_OUTSIDE_SOURCE' || sourceCode === 'INVALID_REQUEST') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1(sourceCode, error.message, { retryable: false })
      );
    }
    return finalizeDirectoryEnvelopeV1(
      createDirectoryErrorEnvelopeV1('INTERNAL_ERROR', 'Directory scan failed', {
        retryable: false
      })
    );
  }
});
```

- [ ] **Step 6: Run GREEN plus legacy/UI regression tests**

```bash
npx jest tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/preloadIpcAllowlist.test.js tests/unit/mainAlbumImagesIpc.test.js tests/unit/copyImageClipboard.test.js tests/unit/deleteImage.test.js tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx tests/unit/hooks/useBreadcrumbs.test.jsx tests/unit/hooks/useNeighboringAlbums.test.jsx --runInBand --silent
```

Expected: all focused suites PASS; all three existing `setupMainProcess()` consumers and legacy UI tests remain unchanged.

- [ ] **Step 7: Confirm renderer scope and commit Task 3**

```bash
if git status --short --untracked-files=all -- src/renderer | rg -q .; then
  echo "Phase 1 must not modify renderer files"
  git status --short --untracked-files=all -- src/renderer
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
- Type consistency: request uses `runtimeSource + ref`; service resolves to internal `{ ref, absolutePath, name, pathFlavor }`, emits canonical locator `{ absolutePath }`, and IPC returns exactly one V1 envelope.
- TDD: every new production module/channel has an explicit RED command before implementation and focused GREEN command after.
- Placeholder scan: no unresolved implementation markers remain.
