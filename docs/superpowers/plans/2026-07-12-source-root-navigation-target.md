# SourceRoot / NavigationTarget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 ADR-001 Phase 2，使标签、路由和会话以稳定的 `SourceRoot + NavigationTarget` 为导航身份，同时保持旧绝对路径、旧路由和 v1 会话可回滚。

**Architecture:** main 进程新增一个小型、原子落盘的 SourceRoot registry，并通过 versioned IPC 暴露加载与命令式保存；renderer 使用 `BrowserLocation` 判别联合承载 canonical target 或明确的 legacy fallback。现有 Home/Album 扫描仍消费 legacy IPC 和绝对 locator，BrowserPage 在边界处 materialize，避免提前进入 Phase 3/5。

**Tech Stack:** Electron、React 18、React Router 6 HashRouter、CommonJS/ES modules、Jest、Node `fs.promises`。

## Global Constraints

- Phase 2 只迁移 source/runtime/route/session/breadcrumb 边界；`SCAN_NAVIGATION_LEVEL`、`GET_ALBUM_IMAGES` 和 Phase 1 `GET_DIRECTORY_LEVEL_V1` wire shape 保持兼容。
- `SourceRoot` 是导航上下文，不是 approved-root 授权名单；不得改变 `assertApprovedPath` 的既有决策。
- `sourceId` 必须是 main 生成的随机 `src_<uuid-v4>`；relink 保持 ID，只有 `rootPath` 实际变化时 `sourceGeneration + 1`。
- `DirectoryRef.relativePath` 根为 `""`，统一 `/`，拒绝绝对路径、反斜杠、空 segment、`.` 和 `..`，保留大小写。
- Windows drive/UNC 比较采用 win32 大小写语义，但持久值和 UI 值不得全局 lower-case；UNC 边界不得越过 share。
- canonical `NavigationTarget.viewMode` 仅允许 `browse | photoSet`；兼容层持续接受并输出 `folder ↔ browse`、`album ↔ photoSet`。
- favorites/landing 是 `BrowserLocation`，不得塞入 Directory `NavigationTarget`。
- `browser_tabs_session_v1` 与 `browser_tabs_snapshot_v1` 只读、不覆盖、不删除；Phase 2 写入独立 v2 key。Phase 4 继续处理 favorites/sort schema 与 legacy 收尾。
- v1 绝对路径仅在唯一、segment-boundary、最长的已知 SourceRoot 下自动映射；无匹配或歧义时保留 `legacyAbsolute`。
- 已登记 SourceRoot 本身就是 lexical 归属证据；会话迁移不 `stat` 子路径，避免离线 NAS 被丢弃。新建/relink SourceRoot 时仍必须验证 root 当前存在且为目录。
- 不制造 OS volume、盘符或 UNC share 的 synthetic SourceRoot；只有目录选择、拖入目录、`initialPath`/`--folder` 等显式 root 意图才能创建来源。
- canonical breadcrumb 和返回上级停在 SourceRoot；unresolved legacy 继续保留 OS-root 行为。
- 不改 favorites/sort/random/cache schema，不让 renderer 在 Phase 2 消费 `GET_DIRECTORY_LEVEL_V1`。
- SourceRoot registry 损坏时不得静默清空或覆盖；所有 mutation 串行，temp file 与正式文件同目录，写成功后 atomic rename。
- 本阶段版本从 `2.6.0` 升为 `2.7.0`，同步 `package-lock.json` 与 `CHANGELOG.md`；交付前运行完整 `npm test -- --runInBand` 和 `npm run build`。

---

## File Map

- `src/common/contracts/navigation-contract-v1.js`: SourceRoot、NavigationTarget、LOAD/SAVE 请求与 envelope 的唯一 shared contract。
- `src/common/path-codec.js`: 浏览器可用的 POSIX/drive/UNC normalize、containment、relative/absolute round-trip 与 unique-longest 匹配。
- `src/main/services/SourceRootService.js`: `library-sources.json` 的初始化、ensure/relink、解析和串行原子持久化。
- `src/renderer/domain/browserLocation.js`: canonical/legacy/app location、materialize、parent、breadcrumb 与 identity。
- `src/renderer/persistence/sessionAdapter.js`: v2 session/snapshot 序列化以及 v1 只读迁移。
- `src/renderer/utils/navigation.js`: canonical hash URL 与 legacy URL 的双向 adapter；保留现有 absolute API。
- `src/main/services/WindowService.js`: 把 bootstrap 参数放入 HashRouter hash，并同时接收 legacy string/canonical target。
- `src/renderer/pages/BrowserPage.js`: 异步 registry hydration、first-class tab location、多来源导航、v2 persistence。
- `src/renderer/pages/HomePage.js`, `src/renderer/pages/AlbumPage.js`, `src/renderer/hooks/useBreadcrumbs.js`: 仅增加 SourceRoot boundary 投影，扫描 IPC 不变。

### Task 1: Shared Navigation Contract and SourceRoot Registry

**Files:**
- Create: `src/common/contracts/navigation-contract-v1.js`
- Modify: `src/common/path-codec.js`
- Create: `src/main/services/SourceRootService.js`
- Create: `tests/helpers/sourceRootFixtures.js`
- Create: `tests/unit/contracts/navigationContractV1.test.js`
- Modify: `tests/unit/pathCodec.test.js`
- Create: `tests/unit/services/SourceRootService.test.js`

**Interfaces:**
- Produces contract constants and validators:

```js
const NAVIGATION_CONTRACT_VERSION = 1;
const SOURCE_ROOT_SCHEMA_VERSION = 1;
const NAVIGATION_VIEW_MODES = Object.freeze(['browse', 'photoSet']);

validateSourceRootV1(value);
validateNavigationTargetV1(value);
validateLoadSourceRootsRequestV1(value);
validateSaveSourceRootRequestV1(value);
validateSourceRootsEnvelopeV1(value);
createNavigationSuccessEnvelopeV1(data);
createNavigationErrorEnvelopeV1(code, message, options);
toCanonicalViewMode('folder'); // 'browse'
toLegacyViewMode('photoSet');  // 'album'
```

- Extends the browser-safe codec with:

```js
normalizeAbsolutePath('/Photos/Trip/');
// { absolutePath: '/Photos/Trip', pathFlavor: 'posix' }

getPortableRelativePath('/Photos', '/Photos/Trip'); // 'Trip'
resolvePortableRelativePath('C:/Photos', 'Trip/2026'); // 'C:/Photos/Trip/2026'
findUniqueLongestSourceRoot(sources, '/Photos/Family/Trip');
// { status: 'resolved', source, relativePath: 'Trip' }
```

- Produces service API:

```js
const service = createSourceRootService({ registryPath, fsApi, randomUUID });
await service.initialize();
await service.listSourceRoots();
await service.getSourceRoot(sourceId);
await service.saveSourceRoot({ sourceId: null, rootPath, label: null });
await service.resolveNavigationTarget(target);
service.matchLegacyAbsolutePath(absolutePath);
```

- `saveSourceRoot` returns `{source, created}`; a non-null `sourceId` is a relink/update command, never an unrestricted registry replacement.

- [ ] **Step 1: Write failing contract and codec tests**

Add tests with exact canonical examples:

```js
expect(validateSourceRootV1({
  schemaVersion: 1,
  sourceId: 'src_11111111-1111-4111-8111-111111111111',
  label: '家庭照片',
  rootPath: '//NAS/Photos',
  sourceGeneration: 1
}).valid).toBe(true);

expect(validateNavigationTargetV1({
  sourceId: 'src_11111111-1111-4111-8111-111111111111',
  relativePath: '2026/旅行',
  viewMode: 'photoSet',
  initialMediaRelativePath: '2026/旅行/001.jpg'
}).valid).toBe(true);

expect(getPortableRelativePath('/photos', '/photos2/trip')).toBeNull();
expect(getPortableRelativePath('C:\\Photos', 'c:/photos/Trip')).toBe('Trip');
expect(getPortableRelativePath('\\\\NAS\\Share', '//nas/share/Trip')).toBe('Trip');
expect(resolvePortableRelativePath('//NAS/Share', '')).toBe('//NAS/Share');
```

Also reject unknown fields, invalid UUID version/variant, generation `0`, empty/over-200 label, legacy target view, absolute/traversal/backslash relative paths, POSIX case mismatch, drive/UNC flavor mismatch, and ambiguous equal-length source matches.

- [ ] **Step 2: Run contract/codec tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/contracts/navigationContractV1.test.js tests/unit/pathCodec.test.js
```

Expected: FAIL because `navigation-contract-v1.js` and new codec exports do not exist.

- [ ] **Step 3: Implement minimal strict contract and browser-safe path codec**

Use closed plain-object schemas. The canonical shapes are exactly:

```js
// SourceRoot
{ schemaVersion: 1, sourceId, label, rootPath, sourceGeneration }

// NavigationTarget
{ sourceId, relativePath, viewMode, initialMediaRelativePath }

// registry document
{ schemaVersion: 1, sources: [SourceRoot] }

// LOAD
{ contractVersion: 1 }

// SAVE (sourceId null = ensure/create; string = relink/update)
{ contractVersion: 1, sourceId, rootPath, label }

// success data is one of
{ sources: [SourceRoot] }
{ source: SourceRoot, created: true }
```

The path codec must normalize separators to `/`, preserve original case, use case-folded comparison keys only for win32, and compare path segments rather than string prefixes.

- [ ] **Step 4: Run contract/codec tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Write failing SourceRootService tests**

Cover missing registry, valid reload, corrupt/unknown schema without overwrite, same-root idempotence, deterministic UUID, UUID collision retry, nested roots, relink stable ID/generation, label-only update without generation bump, equivalent relink no-op, root conflict, root missing/not-directory, defensive copies, concurrent `Promise.all` saves, rename failure preserving old memory/file, and queue continuation after failure.

Use a fake `fsApi` with `readFile`, `mkdir`, `writeFile`, `rename`, `unlink`, `stat`, and optional file-handle `open/sync/close`; assert formal file is never directly truncated.

- [ ] **Step 6: Run service tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/services/SourceRootService.test.js
```

Expected: FAIL because `SourceRootService.js` does not exist.

- [ ] **Step 7: Implement the registry with serialized atomic mutations**

The mutation queue must recover after rejection:

```js
let mutationTail = Promise.resolve();

function enqueueMutation(operation) {
  const result = mutationTail.then(operation, operation);
  mutationTail = result.catch(() => undefined);
  return result;
}
```

Persist `{schemaVersion: 1, sources}` to a uniquely named temp beside `library-sources.json`, sync/close when the injected fs supports it, rename, and only then replace the in-memory snapshot. `initialize()` must retain a corruption error and refuse later writes instead of substituting an empty registry.

- [ ] **Step 8: Run Task 1 tests and commit**

Run:

```bash
npm test -- --runInBand tests/unit/contracts/navigationContractV1.test.js tests/unit/pathCodec.test.js tests/unit/services/SourceRootService.test.js
git diff --check
git add src/common/contracts/navigation-contract-v1.js src/common/path-codec.js src/main/services/SourceRootService.js tests/helpers/sourceRootFixtures.js tests/unit/contracts/navigationContractV1.test.js tests/unit/pathCodec.test.js tests/unit/services/SourceRootService.test.js
git commit -m "feat(navigation): add SourceRoot registry contract"
```

Expected: tests PASS; commit contains only Task 1 files.

### Task 2: SourceRoot IPC and HashRouter Window Bootstrap

**Files:**
- Modify: `src/common/ipc-channels.js`
- Modify: `src/main/preload.js`
- Modify: `src/main/main.js`
- Modify: `src/main/services/WindowService.js`
- Modify: `tests/helpers/mainProcessHarness.js`
- Modify: `tests/unit/preloadIpcAllowlist.test.js`
- Create: `tests/unit/mainSourceRootIpc.test.js`
- Modify: `tests/unit/mainDirectoryLevelV1Ipc.test.js`
- Modify: `tests/unit/services/WindowService.test.js`
- Create: `tests/unit/windowBootstrap.test.jsx`

**Interfaces:**
- Consumes Task 1 contract/service.
- Adds channels:

```js
LOAD_SOURCE_ROOTS_V1: 'load-source-roots-v1'
SAVE_SOURCE_ROOT_V1: 'save-source-root-v1'
```

- `WindowService.createWindow(launchTarget)` accepts `null`, a legacy absolute string, or a validated canonical `NavigationTarget`.
- `CREATE_NEW_WINDOW` and `CREATE_NEW_INSTANCE` accept the old absolute string or `{contractVersion: 1, target: NavigationTarget}` and keep returning `{success, windowId/error}`.

- [ ] **Step 1: Write failing IPC/preload tests**

Test strict version/shape rejection, load/save success envelopes, service error sanitization, preload common/fallback/allowlist synchronization, and that SourceRoot operations never call approved-root registration. Extend `mainProcessHarness` with an injectable `sourceRootService` mock.

Add a `GET_DIRECTORY_LEVEL_V1` regression proving a forged `runtimeSource.rootPath` is replaced with the registered SourceRoot path while the original V1 request shape remains mandatory:

```js
expect(resolveDirectoryLocatorV1).toHaveBeenCalledWith({
  contractVersion: 1,
  runtimeSource: { sourceId: request.ref.sourceId, rootPath: '/registered/photos' },
  ref: request.ref
});
```

- [ ] **Step 2: Run IPC/preload tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/mainSourceRootIpc.test.js tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/preloadIpcAllowlist.test.js
```

Expected: FAIL on missing channels/handlers and missing source registry injection.

- [ ] **Step 3: Implement versioned handlers and authoritative DirectoryRef resolution**

Instantiate the service at `<app.getPath('userData')>/library-sources.json`. LOAD calls `listSourceRoots`; SAVE calls `saveSourceRoot`; both finalize a strict navigation envelope. In `GET_DIRECTORY_LEVEL_V1`, validate the unchanged request first, then rewrite only the compatibility runtime locator from registry:

```js
const source = await sourceRootService.getSourceRoot(request.ref.sourceId);
if (!source) return directoryError('SOURCE_NOT_FOUND');

const authoritativeRequest = {
  contractVersion: request.contractVersion,
  runtimeSource: { sourceId: source.sourceId, rootPath: source.rootPath },
  ref: request.ref
};
```

Do not change `SCAN_NAVIGATION_LEVEL` or approved-root functions.

- [ ] **Step 4: Write failing WindowService/HashRouter tests**

Assert production and dev URLs use hash-internal query:

```text
http://localhost:3000/#/browse?initialPath=%2FPhotos%2FTrip
file:///.../index.html#/browse?sourceId=src_...&relativePath=2026%2FTrip&view=album
```

Cover spaces, Chinese, `%`, drive and UNC strings with exactly one encode/decode cycle. The React bootstrap test must set the generated hash on `window.location`, render a real `HashRouter`, and assert `useLocation().search` contains `initialPath`/`sourceId`.

- [ ] **Step 5: Run window tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/services/WindowService.test.js tests/unit/windowBootstrap.test.jsx
```

Expected: FAIL because parameters are currently outside the hash and canonical targets are unsupported.

- [ ] **Step 6: Implement canonical and legacy window bootstrap**

Export a pure `buildWindowUrl(startUrl, launchTarget)` helper. Output legacy view words from canonical targets:

```js
const params = new URLSearchParams();
params.set('sourceId', target.sourceId);
params.set('relativePath', target.relativePath);
if (target.viewMode === 'photoSet') params.set('view', 'album');
if (target.initialMediaRelativePath) params.set('image', target.initialMediaRelativePath);
return `${startUrl}#/browse?${params.toString()}`;
```

Main resolves canonical targets via SourceRootService before approved-root checks; legacy strings retain the old path. `--folder`/second-instance attempts to ensure a SourceRoot and opens canonical root target, but falls back to the hash-internal legacy `initialPath` if registry creation fails.

- [ ] **Step 7: Run Task 2 tests and commit**

Run:

```bash
npm test -- --runInBand tests/unit/mainSourceRootIpc.test.js tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/preloadIpcAllowlist.test.js tests/unit/services/WindowService.test.js tests/unit/windowBootstrap.test.jsx
git diff --check
git add src/common/ipc-channels.js src/main/preload.js src/main/main.js src/main/services/WindowService.js tests/helpers/mainProcessHarness.js tests/unit/preloadIpcAllowlist.test.js tests/unit/mainSourceRootIpc.test.js tests/unit/mainDirectoryLevelV1Ipc.test.js tests/unit/services/WindowService.test.js tests/unit/windowBootstrap.test.jsx
git commit -m "feat(navigation): expose SourceRoot and fix window bootstrap"
```

Expected: tests PASS; legacy window strings still pass their original assertions after updating only the hash placement.

### Task 3: BrowserLocation, Canonical Routes, and v1→v2 Session Adapter

**Files:**
- Create: `src/renderer/domain/browserLocation.js`
- Create: `src/renderer/persistence/sessionAdapter.js`
- Modify: `src/renderer/utils/navigation.js`
- Create: `tests/unit/browserLocation.test.js`
- Create: `tests/unit/sessionAdapter.test.js`
- Modify: `tests/unit/navigation.test.js`
- Create: `tests/fixtures/legacy/browser-tabs-session-v1-windows.json`
- Create: `tests/fixtures/legacy/browser-tabs-session-v1-unc.json`

**Interfaces:**
- BrowserLocation persisted/runtime union:

```js
{ kind: 'landing' }
{ kind: 'favorites' }
{ kind: 'directory', target: NavigationTarget }
{
  kind: 'legacyAbsolute',
  legacyAbsolutePath,
  viewMode: 'folder' | 'album',
  legacyInitialMediaPath
}
```

- Materialized directory result:

```js
{
  location,
  sourceRoot,
  absolutePath,
  rootPath,
  legacyViewMode,
  absoluteInitialImage
}
```

- v2 keys are exactly `browser_tabs_session_v2` and `browser_tabs_snapshot_v2`; v2 payload is:

```js
{
  schemaVersion: 2,
  tabs: [{ id: 'tab-x', location: BrowserLocation }],
  activeTabId: 'tab-x',
  savedAt: 1783785600000
}
```

- [ ] **Step 1: Write failing BrowserLocation tests**

Cover canonical materialization, relink resolving the same target under a new root, two sources yielding distinct identities for the same absolute locator, child navigation preserving sourceId, canonical root parent no-op, legacy parent keeping OS behavior, and SourceRoot breadcrumb labels/paths for POSIX/drive/UNC.

- [ ] **Step 2: Run BrowserLocation tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/browserLocation.test.js
```

Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement the BrowserLocation pure domain**

Identity must include kind and canonical target fields, never only absolute path:

```js
function getBrowserLocationIdentity(location) {
  if (location.kind === 'directory') {
    const target = location.target;
    return ['directory', target.sourceId, target.relativePath, target.viewMode,
      target.initialMediaRelativePath || ''].join(':');
  }
  if (location.kind === 'legacyAbsolute') {
    return ['legacy', location.legacyAbsolutePath, location.viewMode,
      location.legacyInitialMediaPath || ''].join(':');
  }
  return location.kind;
}
```

Source breadcrumbs start with `{name: sourceRoot.label, path: sourceRoot.rootPath}` and append one portable segment at a time.

- [ ] **Step 4: Write failing session migration/serialization tests**

Test v2 preference, v1 unique-longest migration, nested roots, no-match/ambiguous fallback, `folder/album` mapping, bare `cover.jpg` becoming a media path beneath the current directory, Windows/UNC fixtures, invalid v2 falling back to v1 without mutation, and serialization omitting `rootPath`, title and absolute locator.

Use a storage spy and assert the original v1 raw string is byte-for-byte unchanged and neither v1 key receives `setItem`/`removeItem`.

- [ ] **Step 5: Run session tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/sessionAdapter.test.js
```

Expected: FAIL because `sessionAdapter.js` does not exist.

- [ ] **Step 6: Implement the v2 adapter with explicit unresolved fallback**

Export:

```js
SESSION_V1_KEY;
SESSION_V2_KEY;
SNAPSHOT_V1_KEY;
SNAPSHOT_V2_KEY;
loadTabsSession({ storage, sources, snapshot = false });
createTabsSessionPayload(tabs, activeTabId, now);
saveTabsSession({ storage, tabs, activeTabId, snapshot = false, now });
```

The loader reads v2 first; if absent/invalid it reads v1 and returns runtime migrated tabs without writing anything. Only `saveTabsSession` writes the selected v2 key.

- [ ] **Step 7: Write failing canonical/legacy route tests**

Keep existing `buildBrowseUrl(absolutePath, legacyView, image)` output stable. Add:

```js
buildNavigationTargetUrl({
  sourceId: SOURCE_ID,
  relativePath: '2026/旅行',
  viewMode: 'photoSet',
  initialMediaRelativePath: '2026/旅行/001.jpg'
});
// /browse?sourceId=...&relativePath=2026%2F%E6%97%85%E8%A1%8C&view=album&image=...
```

`parseBrowseLocation('/browse', search)` returns canonical location when both sourceId and relativePath are present, otherwise parses old `/browse/<encodedAbsolute>?view=folder|album`. Old `/album` routing remains outside this helper and unchanged.

- [ ] **Step 8: Run route tests and verify RED, then implement adapters**

Run:

```bash
npm test -- --runInBand tests/unit/navigation.test.js
```

Expected first run: FAIL on missing canonical helpers. Implement the helpers, rerun, and expect PASS.

- [ ] **Step 9: Run Task 3 tests and commit**

Run:

```bash
npm test -- --runInBand tests/unit/browserLocation.test.js tests/unit/sessionAdapter.test.js tests/unit/navigation.test.js
git diff --check
git add src/renderer/domain/browserLocation.js src/renderer/persistence/sessionAdapter.js src/renderer/utils/navigation.js tests/unit/browserLocation.test.js tests/unit/sessionAdapter.test.js tests/unit/navigation.test.js tests/fixtures/legacy/browser-tabs-session-v1-windows.json tests/fixtures/legacy/browser-tabs-session-v1-unc.json
git commit -m "refactor(navigation): add canonical browser locations"
```

Expected: tests PASS and v1 fixtures remain unchanged.

### Task 4: First-Class Tabs and Source-Bounded Breadcrumbs

**Files:**
- Modify: `src/renderer/pages/BrowserPage.js`
- Modify: `src/renderer/pages/HomePage.js`
- Modify: `src/renderer/pages/AlbumPage.js`
- Modify: `src/renderer/hooks/useBreadcrumbs.js`
- Modify: `tests/unit/pages/BrowserPage.test.jsx`
- Modify: `tests/unit/pages/HomePage.test.jsx`
- Modify: `tests/unit/pages/AlbumPage.test.jsx`
- Modify: `tests/unit/hooks/useBreadcrumbs.test.jsx`

**Interfaces:**
- Runtime tab remains compatible with current rendering but `location` is the truth source:

```js
{
  id,
  location,
  targetPath,      // materialized compatibility projection only
  viewMode,        // folder | album | favorites projection
  initialImage,    // absolute compatibility projection only
  title,
  sourceBoundary   // null or {sourceId, label, rootPath, relativePath}
}
```

- HomePage/AlbumPage receive optional `sourceBoundary` and optional `sourceBreadcrumbs`; legacy calls without them remain unchanged.

- [ ] **Step 1: Write failing BrowserPage source/session tests**

Add async tests for:

```text
LOAD_SOURCE_ROOTS_V1 completes before v1 migration or v2 persistence
v2 canonical session materializes old Home/Album absolute props
v1 unique root migrates; unresolved v1 still opens
v1 session/snapshot raw strings are never changed
two tabs with different sourceId do not collapse even if absolutePath matches
canonical child navigation keeps sourceId
canonical root back is no-op; legacy back uses OS parent
directory select, drop and legacy initialPath call SAVE_SOURCE_ROOT_V1 and create root targets
canonical URL intent wins over stored session
legacy URL and legacy /album redirect still work
```

Spy on IPC and localStorage. Before resolving the deferred LOAD promise, assert `browser_tabs_session_v2` is absent.

- [ ] **Step 2: Run BrowserPage tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/pages/BrowserPage.test.jsx
```

Expected: new tests FAIL because BrowserPage still writes v1 and has no registry hydration.

- [ ] **Step 3: Integrate registry hydration and first-class locations**

On mount:

```js
const response = await ipcRenderer.invoke(CHANNELS.LOAD_SOURCE_ROOTS_V1, {
  contractVersion: 1
});
const loadedSources = response?.ok ? response.data.sources : [];
const restored = loadTabsSession({ storage: localStorage, sources: loadedSources });
```

Do not enable the v2 save effect until this hydration finishes successfully. For explicit absolute roots call:

```js
const response = await ipcRenderer.invoke(CHANNELS.SAVE_SOURCE_ROOT_V1, {
  contractVersion: 1,
  sourceId: null,
  rootPath: absolutePath,
  label: null
});
```

Successful child/breadcrumb/album navigation under a canonical tab derives the next relative path against that tab's SourceRoot; it must not re-run global longest-root matching. Re-materialize projections whenever the source list changes so relinked roots update without changing target identity.

- [ ] **Step 4: Run BrowserPage tests and verify GREEN**

Run the Step 2 command. Expected: PASS, including existing drag/drop/tab/scroll tests.

- [ ] **Step 5: Write failing breadcrumb boundary tests**

For HomePage and AlbumPage, provide a SourceRoot `/Volumes/NAS/Photos` with relative path `2026/旅行` and assert rendered breadcrumbs are `家庭照片 / 2026 / 旅行`, not `/ / Volumes / NAS / Photos / ...`. Repeat drive and UNC roots. Assert canonical mode does not request breadcrumb data solely to rebuild OS-root crumbs, while legacy mode still invokes `SCAN_NAVIGATION_LEVEL` and keeps its old fallback.

Add a guard asserting Home/Album scanning continues to use `SCAN_NAVIGATION_LEVEL`/`GET_ALBUM_IMAGES` and never invokes `GET_DIRECTORY_LEVEL_V1`.

- [ ] **Step 6: Run breadcrumb/page tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx tests/unit/hooks/useBreadcrumbs.test.jsx
```

Expected: source-boundary assertions FAIL.

- [ ] **Step 7: Implement the minimal boundary props**

HomePage keeps cached/legacy scan DTOs for content but chooses `sourceBreadcrumbs` for display and `sourceBoundary.rootPath` for its go-up guard. `useBreadcrumbs(albumPath, rootPath, sourceBreadcrumbs)` returns the supplied canonical list without scanning; otherwise its current cache/IPC/fallback behavior is unchanged. AlbumPage forwards this list to `BreadcrumbNavigation`.

- [ ] **Step 8: Run Task 4 tests and commit**

Run:

```bash
npm test -- --runInBand tests/unit/pages/BrowserPage.test.jsx tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx tests/unit/hooks/useBreadcrumbs.test.jsx
git diff --check
git add src/renderer/pages/BrowserPage.js src/renderer/pages/HomePage.js src/renderer/pages/AlbumPage.js src/renderer/hooks/useBreadcrumbs.js tests/unit/pages/BrowserPage.test.jsx tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx tests/unit/hooks/useBreadcrumbs.test.jsx
git commit -m "refactor(navigation): make tabs source aware"
```

Expected: tests PASS; no renderer production file invokes `GET_DIRECTORY_LEVEL_V1`.

### Task 5: Release Metadata and Full Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Produces version `2.7.0` in both package files and one matching changelog section.

- [ ] **Step 1: Update version metadata**

Change both package files from `2.6.0` to `2.7.0` without updating dependencies. Add a `2.7.0` changelog entry covering stable SourceRoot identity/relink, canonical tabs/v2 session with v1 read-only fallback, HashRouter bootstrap fix, source-bounded breadcrumbs, Windows/UNC compatibility, and unchanged legacy scan/authorization behavior.

- [ ] **Step 2: Run targeted architecture guards**

Run:

```bash
rg -n "browser_tabs_session_v1|browser_tabs_snapshot_v1" src/renderer
rg -n "GET_DIRECTORY_LEVEL_V1" src/renderer
rg -n "SCAN_NAVIGATION_LEVEL|GET_ALBUM_IMAGES" src/renderer/pages src/renderer/hooks
git diff --check
```

Expected: v1 keys only occur in the read-only session adapter; no Phase 2 renderer production code invokes `GET_DIRECTORY_LEVEL_V1`; legacy scanners remain in Home/Album hooks.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: all suites/tests PASS. Existing baseline warnings may remain, but no new unhandled errors or failures are allowed.

- [ ] **Step 4: Build the Electron app**

Run:

```bash
npm run build
```

Expected: webpack production bundle succeeds and `electron-builder --dir` creates the unpacked `.app`. A missing signing identity may be recorded as distribution risk but is not a build failure.

- [ ] **Step 5: Inspect scope and commit release metadata**

Run:

```bash
git status --short
git diff --stat main...HEAD
git diff --check
git add package.json package-lock.json CHANGELOG.md
git diff --cached --name-only
git commit -m "chore(release): bump version to 2.7.0"
```

Expected: staged list before the final commit is exactly the three metadata files; `dist/` is not staged.

- [ ] **Step 6: Final review and branch finish**

Generate a whole-branch review package from the branch merge-base, obtain a clean spec/quality review, fix and re-review all Critical/Important findings, rerun affected tests, then follow `superpowers:finishing-a-development-branch` to merge the verified branch into local `main` with `git merge --no-ff codex/source-root-navigation-target`. Do not push or create a PR.
