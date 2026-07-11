# Directory Navigation Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ADR-001 和当前目录/导航/持久化行为固化为可版本控制、可回归验证的 Phase 0 基线，不改变任何生产运行时语义。

**Architecture:** 本阶段只调整仓库文档、测试夹具、测试基础设施与 characterization tests。测试直接锁定当前 legacy DTO、IPC 双返回形状、页面级随机袋生命周期和 v1 session/favorites 数据形状，为后续 `DirectorySnapshot` 与 `SourceRoot` 迁移提供回归边界。

**Tech Stack:** Electron 27、React 18、Jest 30、Testing Library、CommonJS/ES modules 混合测试环境、npm。

## Global Constraints

- ADR 默认值已经批准：SourceRoot 是 UI 导航边界但不是授权边界；随机忽略搜索/排序；v1 adapter 至少保留两个 minor；随机采用当前层目录导航方案 A。
- Phase 0 禁止修改 `src/` 下的生产代码，禁止改变 UI、IPC 或持久化运行时行为。
- Characterization tests 的目标是确认现有行为，因此应在现有实现上直接 PASS；本阶段没有生产实现，不伪造 TDD RED。
- 只放行并跟踪 `docs/plans/ADR-001.md` 与 `docs/superpowers/plans/**`，其余 `docs/` 内容继续忽略。
- 版本从 `2.5.13` 升为 `2.5.14`，并同步 `package.json`、`package-lock.json` 与 `CHANGELOG.md`。
- 交付前必须运行 `npm test -- --runInBand --silent`、`npm run build` 和 `git diff --check`。
- 不运行 `npm audit fix`，不升级依赖，不生成或提交 `dist/`。
- 只创建本地提交与本地 `--no-ff` 合并；不 push、不创建 Pull Request。

---

### Task 1: Track the ADR and Phase 0 plan

**Files:**
- Modify: `.gitignore`
- Track: `docs/plans/ADR-001.md`
- Track: `docs/superpowers/plans/2026-07-11-directory-navigation-baseline.md`

**Interfaces:**
- Consumes: 当前被 `docs/` 忽略的 ADR 与本计划文件。
- Produces: Git 可见的 ADR 和实施计划；后续任务不依赖未跟踪文档。

- [ ] **Step 1: Replace the broad docs ignore rule with narrow allow rules**

使用 `apply_patch` 将 `.gitignore` 中的：

```gitignore
docs/
```

替换为：

```gitignore
docs/*
!docs/plans/
docs/plans/*
!docs/plans/ADR-001.md
!docs/superpowers/
docs/superpowers/*
!docs/superpowers/plans/
!docs/superpowers/plans/**
```

- [ ] **Step 2: Verify only the intended documentation becomes visible**

Run:

```bash
git status --short --untracked-files=all
git check-ignore -v docs/.DS_Store docs/plans/.DS_Store || true
```

Expected: `.gitignore` is modified; only `docs/plans/ADR-001.md` and this plan are new trackable documentation; `.DS_Store` remains ignored.

- [ ] **Step 3: Commit the documentation boundary**

```bash
git add .gitignore docs/plans/ADR-001.md docs/superpowers/plans/2026-07-11-directory-navigation-baseline.md
git diff --cached --name-only
git diff --cached --check
git commit -m "docs(architecture): track directory navigation ADR"
```

Expected staged files: exactly `.gitignore`, the ADR, and this plan.

---

### Task 2: Characterize the legacy album-image IPC shapes

**Files:**
- Create: `tests/helpers/mainProcessHarness.js`
- Create: `tests/unit/mainAlbumImagesIpc.test.js`
- Modify: `tests/unit/deleteImage.test.js`
- Modify: `tests/unit/copyImageClipboard.test.js`

**Interfaces:**
- Consumes: `createElectronMocks()` from `tests/helpers/electronMock.js` and existing `src/main/main.js` handler registration.
- Produces: `setupMainProcess({ fileSystemService, configureElectron }) -> { electron, fileSystemService }`, reusable by main-process IPC tests.

- [ ] **Step 1: Add the shared main-process test harness**

Create `tests/helpers/mainProcessHarness.js` with:

```js
const { createElectronMocks } = require('./electronMock');

const createImageStub = () => ({
  isEmpty: jest.fn(() => false),
  toPNG: jest.fn(() => Buffer.from('png-data'))
});

const setupMainProcess = ({ fileSystemService = {}, configureElectron } = {}) => {
  jest.resetModules();

  const electron = createElectronMocks();
  electron.app.requestSingleInstanceLock = jest.fn(() => true);
  electron.app.whenReady = jest.fn(() => new Promise(() => {}));
  electron.dialog = { showOpenDialog: jest.fn() };
  electron.shell = {
    showItemInFolder: jest.fn(),
    trashItem: jest.fn(() => Promise.resolve())
  };
  electron.session = {
    defaultSession: {
      protocol: { registerFileProtocol: jest.fn() }
    }
  };
  electron.clipboard = {
    clear: jest.fn(),
    writeBuffer: jest.fn(),
    writeBookmark: jest.fn(),
    writeText: jest.fn(),
    writeImage: jest.fn(),
    availableFormats: jest.fn(() => []),
    readImage: jest.fn(() => createImageStub())
  };
  electron.nativeImage.createFromPath.mockReturnValue(createImageStub());
  electron.nativeImage.createFromBuffer = jest.fn(() => createImageStub());
  configureElectron?.(electron);

  const resolvedFileSystemService = {
    createErrorResponse: jest.fn((message, targetPath) => ({
      success: false,
      error: { message },
      currentPath: targetPath
    })),
    scanNavigationLevel: jest.fn(),
    scanDirectoryTree: jest.fn(),
    getAlbumImages: jest.fn(),
    getAlbumImagesPage: jest.fn(),
    getAlbumImageCount: jest.fn(),
    clearAlbumImageMetadataCache: jest.fn(),
    DEFAULT_ALBUM_PAGE_SIZE: 200,
    SUPPORTED_FORMATS: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'],
    ...fileSystemService
  };

  jest.doMock('electron', () => electron);
  jest.doMock('electron-is-dev', () => false);
  jest.doMock('../../src/main/services/WindowService', () => ({
    createWindow: jest.fn(),
    getMainWindow: jest.fn(() => null),
    windows: new Set()
  }));
  jest.doMock('../../src/main/services/ThumbnailService', () => ({
    THUMBNAIL_CACHE_DIR: '/tmp/photo-album-viewer-thumbnails',
    setMaxWorkers: jest.fn(),
    ensureCacheDir: jest.fn(() => Promise.resolve()),
    generateThumbnail: jest.fn(),
    thumbnailService: {
      getCacheStats: jest.fn(() => Promise.resolve({})),
      getRuntimeStats: jest.fn(() => ({}))
    }
  }));
  jest.doMock('../../src/main/services/FavoritesService', () => ({
    registerIpcHandlers: jest.fn(),
    startFavoritesWatcher: jest.fn(() => Promise.resolve()),
    stopFavoritesWatcher: jest.fn()
  }));
  jest.doMock('../../src/main/services/FileSystemService', () => resolvedFileSystemService);

  require('../../src/main/main');
  return { electron, fileSystemService: resolvedFileSystemService };
};

module.exports = {
  createImageStub,
  setupMainProcess
};
```

- [ ] **Step 2: Move existing main-process tests onto the harness**

In `tests/unit/deleteImage.test.js` and `tests/unit/copyImageClipboard.test.js`, remove their local `setupMainProcess` implementations and import:

```js
const { setupMainProcess } = require('../helpers/mainProcessHarness');
```

Change each setup call from:

```js
const electron = setupMainProcess();
```

to:

```js
const { electron } = setupMainProcess();
```

Keep each test's existing `fs.promises` spy and all assertions unchanged.

- [ ] **Step 3: Verify the harness preserves existing IPC tests**

Run:

```bash
npx jest tests/unit/deleteImage.test.js tests/unit/copyImageClipboard.test.js --runInBand --silent
```

Expected: both suites PASS with their existing 5 tests.

- [ ] **Step 4: Add the dual-shape IPC characterization test**

Create `tests/unit/mainAlbumImagesIpc.test.js` with:

```js
/** @jest-environment node */

const CHANNELS = require('../../src/common/ipc-channels');
const { setupMainProcess } = require('../helpers/mainProcessHarness');

describe('legacy album image IPC contract', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns an array without options and a page object with options', async () => {
    const legacyImages = [{ path: '/albums/trip/1.jpg', name: '1.jpg' }];
    const page = {
      success: true,
      albumPath: '/albums/trip',
      images: legacyImages,
      totalCount: 1,
      offset: 0,
      limit: 200,
      hasMore: false,
      globalIndex: null
    };
    const getAlbumImages = jest.fn().mockResolvedValue(legacyImages);
    const getAlbumImagesPage = jest.fn().mockResolvedValue(page);
    const { electron } = setupMainProcess({
      fileSystemService: { getAlbumImages, getAlbumImagesPage }
    });

    const legacyResult = await electron.ipcMain.invoke(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/trip'
    );
    const pagedResult = await electron.ipcMain.invoke(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/trip',
      { offset: 0, limit: 200 }
    );

    expect(legacyResult).toBe(legacyImages);
    expect(Array.isArray(legacyResult)).toBe(true);
    expect(pagedResult).toBe(page);
    expect(Array.isArray(pagedResult)).toBe(false);
    expect(getAlbumImages).toHaveBeenCalledWith('/albums/trip');
    expect(getAlbumImagesPage).toHaveBeenCalledWith(
      '/albums/trip',
      { offset: 0, limit: 200 }
    );
  });
});
```

- [ ] **Step 5: Run the focused contract tests**

```bash
npx jest tests/unit/mainAlbumImagesIpc.test.js tests/unit/deleteImage.test.js tests/unit/copyImageClipboard.test.js --runInBand --silent
```

Expected: 3 suites and 6 tests PASS.

- [ ] **Step 6: Commit the IPC baseline**

```bash
git add tests/helpers/mainProcessHarness.js tests/unit/mainAlbumImagesIpc.test.js tests/unit/deleteImage.test.js tests/unit/copyImageClipboard.test.js
git diff --cached --name-only
git diff --cached --check
git commit -m "test(main): characterize legacy album image IPC shapes"
```

---

### Task 3: Freeze directory, shuffle-bag, session, and favorites behavior

**Files:**
- Create: `tests/fixtures/legacy/browser-tabs-session-v1.json`
- Create: `tests/fixtures/legacy/favorites-v1.json`
- Modify: `tests/unit/fileSystemService.test.js`
- Modify: `tests/unit/hooks/useShuffleBag.test.jsx`
- Modify: `tests/unit/pages/BrowserPage.test.jsx`
- Modify: `tests/unit/contexts/FavoritesContext.test.jsx`
- Modify: `tests/unit/services/FavoritesService.test.js`

**Interfaces:**
- Consumes: existing legacy scan DTO, `useShuffleBag`, `browser_tabs_session_v1`, and Favorites v1 shape.
- Produces: stable v1 fixture files and characterization assertions that later adapters must continue accepting.

- [ ] **Step 1: Add legacy persistence fixtures**

Create `tests/fixtures/legacy/browser-tabs-session-v1.json`:

```json
{
  "tabs": [
    {
      "id": "tab-folder",
      "targetPath": "/albums/trip",
      "viewMode": "folder",
      "initialImage": null
    },
    {
      "id": "tab-album",
      "targetPath": "/albums/wedding",
      "viewMode": "album",
      "initialImage": "cover.jpg"
    }
  ],
  "activeTabId": "tab-folder"
}
```

Create `tests/fixtures/legacy/favorites-v1.json`:

```json
{
  "folders": [
    {
      "id": "folder_legacy",
      "kind": "folder",
      "path": "/photos/shared",
      "name": "shared"
    }
  ],
  "albums": [
    {
      "id": "album_legacy",
      "kind": "photoSet",
      "path": "/photos/shared",
      "name": "shared photos",
      "imageCount": 2
    }
  ],
  "images": [],
  "collections": [],
  "version": 7,
  "lastModified": 1783728000000
}
```

- [ ] **Step 2: Characterize omitted legacy leaf directories**

Add to `tests/unit/fileSystemService.test.js`:

```js
test('scanNavigationLevel omits empty and unsupported-only child directories', async () => {
  mockFs = createFsMock({
    '/photos': {
      visible: { '1.jpg': Buffer.from('image') },
      empty: {},
      documents: { 'notes.txt': 'not an image' }
    }
  });

  const result = await scanNavigationLevel('/photos');

  expect(result.success).toBe(true);
  expect(result.nodes.map((node) => node.name)).toEqual(['visible']);
  expect(result.nodes[0]).toMatchObject({
    type: 'album',
    contentKind: 'photoSet',
    canViewAsPhotoSet: true,
    canBrowseChildren: false
  });
});
```

- [ ] **Step 3: Characterize page-local shuffle-bag reset behavior**

At module scope in `tests/unit/hooks/useShuffleBag.test.jsx`, add:

```js
const getPath = (item) => item.path;
```

Add these tests:

```js
test('starts a fresh bag after remount with the same scope and candidates', () => {
  const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const items = [{ path: '/a' }, { path: '/b' }];
  const first = renderHook(() => useShuffleBag(items, '/scope', { getKey: getPath }));

  let firstDraw;
  act(() => {
    firstDraw = first.result.current.drawNext()?.path;
  });
  first.unmount();

  const second = renderHook(() => useShuffleBag(items, '/scope', { getKey: getPath }));
  let remountedDraw;
  act(() => {
    remountedDraw = second.result.current.drawNext()?.path;
  });

  expect(firstDraw).toBe('/b');
  expect(remountedDraw).toBe('/b');
  randomSpy.mockRestore();
});

test('resets the bag when excludeKey changes', () => {
  const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
  const items = [{ path: '/a' }, { path: '/b' }, { path: '/c' }];
  const { result, rerender } = renderHook(
    ({ excludeKey }) => useShuffleBag(items, '/scope', { getKey: getPath, excludeKey }),
    { initialProps: { excludeKey: '/a' } }
  );

  act(() => {
    expect(result.current.drawNext()?.path).toBe('/c');
  });
  rerender({ excludeKey: '/b' });
  act(() => {
    expect(result.current.drawNext()?.path).toBe('/c');
  });

  randomSpy.mockRestore();
});
```

- [ ] **Step 4: Consume the browser-session fixture**

Add near the imports in `tests/unit/pages/BrowserPage.test.jsx`:

```js
const browserTabsSessionV1 = require('../../fixtures/legacy/browser-tabs-session-v1.json');
```

In `restores full tabs when current URL matches a saved tab`, replace the inline session object with:

```js
localStorage.setItem(
  'browser_tabs_session_v1',
  JSON.stringify(browserTabsSessionV1)
);
```

Keep the existing assertions for the `trip` and `wedding` tabs and active `wedding` tab.

- [ ] **Step 5: Consume the favorites fixture and freeze revision semantics**

Add near the imports in `tests/unit/contexts/FavoritesContext.test.jsx`:

```js
const favoritesV1 = require('../../fixtures/legacy/favorites-v1.json');
```

Replace the first describe block's `ipcRenderer.invoke.mockResolvedValue({...})` with:

```js
ipcRenderer.invoke.mockResolvedValue(
  JSON.parse(JSON.stringify(favoritesV1))
);
```

Update `FavoriteProbe` and its assertions to query `/photos/shared`; keep the assertion that folder and photo-set favorites coexist for the same absolute path.

In `tests/unit/services/FavoritesService.test.js`, extend the default-file assertion to include:

```js
expect(data).toMatchObject({
  folders: [],
  albums: [],
  images: [],
  collections: [],
  version: 1
});
expect(data).not.toHaveProperty('schemaVersion');
```

- [ ] **Step 6: Run the focused characterization tests**

```bash
npx jest tests/unit/fileSystemService.test.js tests/unit/hooks/useShuffleBag.test.jsx tests/unit/pages/BrowserPage.test.jsx tests/unit/contexts/FavoritesContext.test.jsx tests/unit/services/FavoritesService.test.js --runInBand --silent
```

Expected: all 5 suites PASS; the new assertions document current behavior without a production-code change.

- [ ] **Step 7: Confirm production files are untouched and commit**

```bash
if git diff --name-only HEAD | rg -q '^src/'; then
  echo "Phase 0 must not modify production files"
  exit 1
fi
git add tests/fixtures/legacy/browser-tabs-session-v1.json tests/fixtures/legacy/favorites-v1.json tests/unit/fileSystemService.test.js tests/unit/hooks/useShuffleBag.test.jsx tests/unit/pages/BrowserPage.test.jsx tests/unit/contexts/FavoritesContext.test.jsx tests/unit/services/FavoritesService.test.js
git diff --cached --name-only
git diff --cached --check
git commit -m "test(architecture): freeze legacy navigation behavior"
```

---

### Task 4: Publish the Phase 0 baseline metadata and validate the branch

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: reviewed Tasks 1–3.
- Produces: release baseline `2.5.14` with complete project validation evidence.

- [ ] **Step 1: Bump package metadata without creating a Git tag**

```bash
npm version 2.5.14 --no-git-tag-version
```

Expected: both version fields in `package-lock.json` and the version in `package.json` equal `2.5.14`.

- [ ] **Step 2: Add the changelog entry**

Insert immediately after `# Changelog` in `CHANGELOG.md`:

```markdown
## [2.5.14] - 2026-07-11

- 将“目录事实、能力与导航意图分离”的 ADR 和 Phase 0 实施计划纳入版本控制，明确后续渐进迁移边界。
- 新增目录 legacy DTO、相簿图片双形状 IPC、页面级随机袋生命周期及 v1 session/favorites 数据形状的 characterization tests；本版本不改变运行时行为。
```

- [ ] **Step 3: Run the complete test suite with a clear summary**

```bash
npm test -- --runInBand --silent
```

Expected: all suites and tests PASS, 0 failures.

- [ ] **Step 4: Build the runnable Electron app**

```bash
npm run build
```

Expected: webpack production build and `electron-builder --dir` complete successfully; macOS signing may be skipped when no certificate is installed, but `.app` generation must succeed.

- [ ] **Step 5: Check scope, whitespace, and release metadata**

```bash
git diff --check
git status --short
if git diff --name-only HEAD | rg -q '^src/'; then
  echo "Phase 0 must not modify production files"
  exit 1
fi
node -p "require('./package.json').version"
node -p "require('./package-lock.json').version"
```

Expected: no `src/` changes; both printed versions are `2.5.14`; `dist/` remains ignored.

- [ ] **Step 6: Commit release metadata**

```bash
git add package.json package-lock.json CHANGELOG.md
git diff --cached --name-only
git diff --cached --check
git commit -m "chore(release): bump version to 2.5.14"
```

Expected staged files: exactly `package.json`, `package-lock.json`, and `CHANGELOG.md`.

---

## Self-Review

- Spec coverage: ADR tracking, scan truth table gap, legacy IPC dual shape, hybrid policy existing coverage, bag lifecycle, v1 session/favorites fixtures, versioning, full tests, and `.app` build all have explicit tasks.
- Placeholder scan: no unresolved markers or unspecified error-handling steps.
- Type consistency: the shared test harness returns `{ electron, fileSystemService }`; every consuming test uses that exact shape.
- Scope check: no production code is modified; later `DirectorySnapshot` and `SourceRoot` implementation remains outside Phase 0.
