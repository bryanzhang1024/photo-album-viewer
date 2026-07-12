# Random Browsing Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement ADR-001 Phase 3 so current-level folders participate in random browsing, one no-replacement round survives real Home/Album navigation, and random state remains isolated per tab.

**Architecture:** A pure `randomNavigation` module projects canonical DirectorySnapshot v1 data and transitions deterministic bag/LRU state. A BrowserPage-owned coordinator hook performs canonical IPC scanning, validates a drawn target, retries stale targets once, and commits explicit NavigationTargets. HomePage and AlbumPage become thin triggers while retaining their old page-local path only for unresolved legacy tabs.

**Tech Stack:** Electron IPC, React 18 hooks, React Router 6, Jest 29, React Testing Library, Material UI, existing DirectorySnapshot v1 and NavigationTarget v1 contracts.

## Global Constraints

- Strategy A only: direct child directories, no recursion, and no direct images in the pool.
- Pure folder targets use `browse`; pure photo and hybrid targets use `photoSet`; hybrid receives one vote.
- Search and display sorting never change the pool or signature.
- Random state is runtime-only, isolated by tab, and bounded to eight source-directory scopes per tab.
- Missing or changed targets get one parent rescan and redraw; permission, offline, and IPC errors do not loop.
- Album prev/next remains photo-only.
- UI copy is `随机浏览` with accessible tooltip `随机当前文件夹 (E)`.
- The legacy `onRandomAlbum` toolbar prop and unresolved legacy page-local behavior remain for one minor release; do not fabricate SourceRoot identity.
- No new runtime dependency, database, recursive index, or Phase 5 cache ownership.
- Version is `2.8.0`; synchronize `package.json`, `package-lock.json`, and `CHANGELOG.md`.
- Final validation is the full Jest suite and `npm run build`; do not substitute `build:webpack`.
- Work only on `codex/random-browsing`, commit locally, then merge with `git merge --no-ff` into local `main`; do not push.

## File map

- Create `src/renderer/utils/randomNavigation.js`: pure DirectoryRef, candidate, signature, bag, and LRU behavior.
- Create `src/renderer/hooks/useRandomNavigationCoordinator.js`: BrowserPage-scoped IPC and async orchestration.
- Modify `src/renderer/pages/BrowserPage.js`: instantiate the coordinator, pass thin props, and clear runtime state on snapshot restore.
- Modify `src/renderer/pages/HomePage.js`: canonical trigger, legacy fallback, scope invalidation, Viewer keyboard guard.
- Modify `src/renderer/pages/AlbumPage.js`: canonical trigger, legacy fallback, preserve photo-only adjacent navigation.
- Modify `src/renderer/components/GridPageToolbar.js`: copy change while preserving callback compatibility.
- Modify `src/renderer/components/ImageViewer.js`: uppercase E/R ownership.
- Create `tests/unit/utils/randomNavigation.test.js`: pure behavior.
- Create `tests/unit/hooks/useRandomNavigationCoordinator.test.jsx`: IPC, stale retry, async race, cleanup.
- Create `tests/unit/pages/BrowserPage.randomNavigation.test.jsx`: real Home/Album flow and per-tab integration.
- Modify existing HomePage, AlbumPage, BrowserPage, GridPageToolbar, and ImageViewer tests for their local contracts.
- Modify `package.json`, `package-lock.json`, and `CHANGELOG.md`: release metadata.

---

### Task 1: Canonical random candidate and bag state machine

**Files:**
- Create: `src/renderer/utils/randomNavigation.js`
- Create: `tests/unit/utils/randomNavigation.test.js`
- Reuse: `src/renderer/utils/shuffleBag.js`
- Reuse: `src/common/path-codec.js`
- Reuse: `src/common/contracts/directory-contract-v1.js`

**Interfaces:**
- Consumes: DirectorySnapshot v1, BrowserLocation v1, `shuffleArray(items, randomFn)`.
- Produces:
  - `RANDOM_SCOPE_LIMIT = 8`
  - `directoryRefKey(ref): string`
  - `getRandomNavigationContext(location): { scopeRef, scopeKey, currentCandidateKey } | null`
  - `getRandomViewMode(record): 'browse' | 'photoSet' | null`
  - `buildRandomNavigationTargets(snapshot): RandomNavigationTarget[]`
  - `createRandomCandidateSignature(targets): string`
  - `drawRandomNavigationTarget(state, targets, options): { target, state, reason }`
  - `touchRandomScope(scopes, scopeKey, entry, limit): Map`

- [ ] **Step 1: Write failing candidate projection and context tests**

Create fixtures with one folder, photo set, hybrid, empty, missing, unreadable, and partial/unknown child. Assert the exact output and stable ordering:

```js
const targets = buildRandomNavigationTargets(snapshot({
  children: [
    child('hybrid', { directMediaCount: 2, childDirectoryCount: 1 }),
    child('folder', { directMediaCount: 0, childDirectoryCount: 2 }),
    child('photo', { directMediaCount: 3, childDirectoryCount: 0 }),
    child('empty', { directMediaCount: 0, childDirectoryCount: 0 }),
    child('missing', { status: 'missing' })
  ],
  directMedia: [{ relativePath: 'root.jpg' }]
}));

expect(targets.map(({ candidateKey, target }) => [candidateKey, target.viewMode])).toEqual([
  [directoryRefKey(ref('folder')), 'browse'],
  [directoryRefKey(ref('hybrid')), 'photoSet'],
  [directoryRefKey(ref('photo')), 'photoSet']
]);
expect(new Set(targets.map((item) => item.candidateKey)).size).toBe(3);
```

Also assert browse location `S` scopes to `S`, photoSet `S/A` scopes to `S`, and a root photoSet clamps to root.

- [ ] **Step 2: Run candidate tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/utils/randomNavigation.test.js
```

Expected: FAIL because `src/renderer/utils/randomNavigation.js` does not exist.

- [ ] **Step 3: Implement canonical keys, context, view projection, and targets**

Implement with canonical contract helpers, not legacy node fields:

```js
import { splitPortableRelativePath } from '../../common/path-codec';
import { deriveDirectoryCapabilitiesV1 } from '../../common/contracts/directory-contract-v1';
import { shuffleArray } from './shuffleBag';

export const RANDOM_SCOPE_LIMIT = 8;

export function directoryRefKey(ref) {
  return JSON.stringify([ref.sourceId.toLowerCase(), ref.relativePath]);
}

export function getRandomViewMode(record) {
  if (record?.status !== 'ready') return null;
  const caps = deriveDirectoryCapabilitiesV1(record);
  if (caps.canViewDirectMedia === true) return 'photoSet';
  if (caps.canBrowseChildren === true) return 'browse';
  return null;
}

export function getRandomNavigationContext(location) {
  if (location?.kind !== 'directory') return null;
  const { target } = location;
  const segments = splitPortableRelativePath(target.relativePath);
  const scopeRelativePath = target.viewMode === 'photoSet'
    ? segments.slice(0, -1).join('/')
    : target.relativePath;
  const scopeRef = { sourceId: target.sourceId, relativePath: scopeRelativePath };
  return {
    scopeRef,
    scopeKey: directoryRefKey(scopeRef),
    currentCandidateKey: target.viewMode === 'photoSet'
      ? directoryRefKey({ sourceId: target.sourceId, relativePath: target.relativePath })
      : null
  };
}

export function buildRandomNavigationTargets(snapshot) {
  const unique = new Map();
  for (const child of snapshot?.children || []) {
    const viewMode = getRandomViewMode(child);
    if (!viewMode) continue;
    const candidateKey = directoryRefKey(child.ref);
    unique.set(candidateKey, {
      kind: 'directoryNavigation',
      candidateKey,
      target: {
        sourceId: child.ref.sourceId,
        relativePath: child.ref.relativePath,
        viewMode,
        initialMediaRelativePath: null
      }
    });
  }
  return [...unique.values()].sort((left, right) => (
    left.candidateKey.localeCompare(right.candidateKey)
  ));
}
```

- [ ] **Step 4: Run candidate tests and verify GREEN**

Run the Task 1 focused command. Expected: all candidate/context tests PASS.

- [ ] **Step 5: Write failing no-replacement, signature, and LRU tests**

Use an injected deterministic random function and assert:

```js
let state = null;
const seen = [];
for (let index = 0; index < targets.length; index += 1) {
  const draw = drawRandomNavigationTarget(state, targets, { randomFn: () => 0 });
  state = draw.state;
  seen.push(draw.target.candidateKey);
}
expect(new Set(seen).size).toBe(targets.length);

const skipped = drawRandomNavigationTarget(null, targets, {
  currentCandidateKey: targets[0].candidateKey,
  randomFn: () => 0
});
expect(skipped.target?.candidateKey).not.toBe(targets[0].candidateKey);

const onlyCurrent = drawRandomNavigationTarget(null, [targets[0]], {
  currentCandidateKey: targets[0].candidateKey,
  randomFn: () => 0
});
expect(onlyCurrent).toMatchObject({ target: null, reason: 'noOtherCandidate' });
```

Assert that reversed input produces the same signature, changing only display order does not change it, changing a target view mode does change it, a refill does not repeat `lastReturnedKey` immediately, and the ninth LRU insertion evicts the first key.

- [ ] **Step 6: Run state tests and verify RED**

Run the Task 1 focused command. Expected: FAIL on missing state-machine exports.

- [ ] **Step 7: Implement signature, draw, and immutable LRU helpers**

Implement signature from sorted `candidateKey|viewMode`. At draw time, synchronously reconcile the signature, filter the current key out of remaining, refill at most once more when the current key completes a round, apply the boundary swap, and return `emptyPool` or `noOtherCandidate` without looping.

Use this exact public result shape:

```js
{
  target: RandomNavigationTarget | null,
  state: {
    signature: string,
    remainingKeys: string[],
    lastReturnedKey: string | null
  },
  reason: 'drawn' | 'emptyPool' | 'noOtherCandidate'
}
```

Implement `touchRandomScope` as a copy-on-write `Map`: delete an existing key, append it, and evict `map.keys().next().value` until `size <= limit`.

- [ ] **Step 8: Run Task 1 tests and commit**

Run:

```bash
npm test -- --runInBand tests/unit/utils/randomNavigation.test.js tests/unit/utils/shuffleBag.test.js
git diff --check
```

Expected: both suites PASS and diff check is clean.

Commit only the Task 1 files:

```bash
git add src/renderer/utils/randomNavigation.js tests/unit/utils/randomNavigation.test.js
git commit -m "feat(random): add canonical no-replacement state machine"
```

---

### Task 2: BrowserPage-owned canonical coordinator

**Files:**
- Create: `src/renderer/hooks/useRandomNavigationCoordinator.js`
- Create: `tests/unit/hooks/useRandomNavigationCoordinator.test.jsx`
- Modify: `src/renderer/pages/BrowserPage.js`
- Modify: `tests/unit/pages/BrowserPage.test.jsx`

**Interfaces:**
- Consumes Task 1 exports and `GET_DIRECTORY_LEVEL_V1` envelopes.
- Produces `useRandomNavigationCoordinator(options)` returning:

```js
{
  available: boolean,
  randomBrowseLoading: boolean,
  randomBrowseDisabled: boolean,
  handleRandomBrowse: () => Promise<boolean>,
  invalidateActiveScope: () => void,
  clearAllRandomState: () => void
}
```

- [ ] **Step 1: Write failing coordinator tests for normal draw and tab isolation**

Build a hook harness with two canonical tabs and a mock `invoke`. Return a parent snapshot for scope `S` and a ready target snapshot for `S/A`. Assert:

```js
await act(() => result.current.handleRandomBrowse());
expect(commitTabLocation).toHaveBeenCalledWith({
  tabId: 'tab-a',
  browserLocation: {
    kind: 'directory',
    target: {
      sourceId: SOURCE_ID,
      relativePath: 'S/A',
      viewMode: 'photoSet',
      initialMediaRelativePath: null
    }
  }
});
```

Rerender as `tab-b` at the same location, draw once, switch back to `tab-a`, and prove each tab retains its own queue.

- [ ] **Step 2: Run coordinator tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/hooks/useRandomNavigationCoordinator.test.jsx
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement snapshot loading and pending state transitions**

The hook must invoke the canonical channel with the registry-backed source:

```js
const response = await ipcRenderer.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, {
  contractVersion: 1,
  runtimeSource: { sourceId: source.sourceId, rootPath: source.rootPath },
  ref
});
if (!response?.ok) {
  const error = new Error(response?.error?.message || '目录扫描失败');
  error.code = response?.error?.code || 'INVALID_RESPONSE';
  throw error;
}
return response.data;
```

Store `Map<tabId, Map<scopeKey, { targets, bagState }>>` in a ref. Keep the drawn bag transition pending until the active tab and location identity still match and validation succeeds. Update per-tab loading/disabled UI state without persisting it.

- [ ] **Step 4: Write failing stale, nonretryable, and async-race tests**

Cover these exact sequences:

1. First target validation returns `ENOENT`; parent is scanned again; a different target validates; one navigation occurs.
2. Both validations return recoverable failures; parent scan count is exactly two and no navigation occurs.
3. Target validation returns `EACCES` or `IO_ERROR`; parent scan count remains one and no retry occurs.
4. Active tab or BrowserLocation changes while validation is pending; no navigation and no bag consumption occurs.
5. `invalidateActiveScope()` nulls only cached targets; the next identical signature preserves remaining keys.
6. Replacing a tab's source ID, removing a tab, or calling `clearAllRandomState()` removes the relevant runtime store.

- [ ] **Step 5: Run stale tests and verify RED**

Run the Task 2 focused command. Expected: the new stale and race assertions FAIL.

- [ ] **Step 6: Implement one-retry classification, identity guards, and lifecycle cleanup**

Classify `ENOENT`, `ENOTDIR`, and `TARGET_VIEW_CHANGED` as the only recoverable outcomes. Validate a successful target snapshot by comparing `getRandomViewMode(snapshot)` with the selected `target.viewMode`.

Before committing, require all of:

```js
activeTabIdRef.current === capturedTabId
  && getBrowserLocationIdentity(activeTabRef.current.location) === capturedLocationIdentity
  && operationGenerationRef.current === capturedOperationGeneration
```

Observe the current tab list and source IDs in an effect to remove closed-tab stores and clear only a tab whose source identity changed. Do not clear state for Home/Album view changes within the same source.

- [ ] **Step 7: Wire the hook into BrowserPage with failing prop-contract tests**

In BrowserPage tests, assert canonical HomePage and AlbumPage receive the same coordinator function plus status props, legacy locations receive `onRandomBrowse={null}`, and restoring a saved snapshot calls `clearAllRandomState` before replacing tabs.

- [ ] **Step 8: Implement BrowserPage integration**

Instantiate the hook after `commitTabLocation` exists:

```js
const randomNavigation = useRandomNavigationCoordinator({
  activeTab,
  activeTabId,
  activeSourceRoot,
  tabs,
  commitTabLocation,
  ipcRenderer,
  onError: setErrorMessage
});
```

Pass these props to both pages:

```jsx
onRandomBrowse={randomNavigation.available ? randomNavigation.handleRandomBrowse : null}
onRandomScopeRefresh={randomNavigation.available
  ? randomNavigation.invalidateActiveScope
  : null}
randomBrowseLoading={randomNavigation.randomBrowseLoading}
randomBrowseDisabled={randomNavigation.randomBrowseDisabled}
```

Call `randomNavigation.clearAllRandomState()` at the start of saved-tab snapshot restore. Let the hook's tab/source effect handle close and SourceRoot cleanup.

- [ ] **Step 9: Run Task 2 tests and commit**

Run:

```bash
npm test -- --runInBand tests/unit/hooks/useRandomNavigationCoordinator.test.jsx tests/unit/pages/BrowserPage.test.jsx
git diff --check
```

Expected: both suites PASS.

Commit Task 2 files only:

```bash
git add src/renderer/hooks/useRandomNavigationCoordinator.js src/renderer/pages/BrowserPage.js tests/unit/hooks/useRandomNavigationCoordinator.test.jsx tests/unit/pages/BrowserPage.test.jsx
git commit -m "feat(random): coordinate browsing state per tab"
```

---

### Task 3: HomePage and AlbumPage thin triggers with legacy fallback

**Files:**
- Modify: `src/renderer/pages/HomePage.js`
- Modify: `src/renderer/pages/AlbumPage.js`
- Modify: `tests/unit/pages/HomePage.test.jsx`
- Modify: `tests/unit/pages/AlbumPage.test.jsx`

**Interfaces:**
- Consumes Task 2 page props.
- Preserves `useShuffleBag` only when `onRandomBrowse` is null.
- Preserves Album prev/next through `useNeighboringAlbums` unchanged.

- [ ] **Step 1: Write failing canonical-trigger and refresh tests**

For each page, render with `onRandomBrowse={jest.fn()}` and click the toolbar random action. Assert the coordinator callback is called and no page-local random navigation callback fires.

For Home refresh, assert `onRandomScopeRefresh` is called before `SCAN_NAVIGATION_LEVEL`. For Album refresh, assert the random callback/store is untouched.

Assert `randomBrowseLoading` or `randomBrowseDisabled` disables the toolbar action.

- [ ] **Step 2: Run page tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx
```

Expected: new prop behavior assertions FAIL.

- [ ] **Step 3: Implement canonical trigger with one-release legacy adapter**

Add optional props to each page. Keep the old local hook, but route only unresolved legacy calls through it:

```js
const handleRandomBrowse = useCallback(async () => {
  if (onRandomBrowse) {
    await onRandomBrowse();
    return;
  }
  const legacyTarget = drawLegacyRandomTarget();
  if (!legacyTarget) {
    setError('没有可用的相簿进行随机选择');
    return;
  }
  navigateLegacyTarget(legacyTarget);
}, [onRandomBrowse, drawLegacyRandomTarget, navigateLegacyTarget]);
```

Home refresh calls `onRandomScopeRefresh?.()` in canonical mode and `resetLegacyRandomBag()` otherwise. Album image refresh must no longer reset the canonical bag.

Derive toolbar disabled as:

```js
const randomDisabled = onRandomBrowse
  ? randomBrowseDisabled || randomBrowseLoading
  : legacyCandidates.length === 0;
```

- [ ] **Step 4: Write failing E/R Viewer ownership tests**

Open the mocked Viewer from Home and dispatch `e`, `E`, `r`, and `R`. Assert Home's random, refresh, and navigation callbacks are unchanged. Repeat the assertion for Album.

- [ ] **Step 5: Add page-level Viewer guards**

Home's key handler must return before page actions when `viewerOpen` is true. Album keeps its existing `!viewerOpen` checks and expands tests to both cases.

- [ ] **Step 6: Run Task 3 tests and commit**

Run the Task 3 focused command and `git diff --check`. Expected: both suites PASS.

Commit:

```bash
git add src/renderer/pages/HomePage.js src/renderer/pages/AlbumPage.js tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx
git commit -m "refactor(random): make pages use browser coordinator"
```

---

### Task 4: User-facing copy and complete ImageViewer key ownership

**Files:**
- Modify: `src/renderer/components/GridPageToolbar.js`
- Modify: `src/renderer/components/ImageViewer.js`
- Modify: `tests/unit/components/GridPageToolbar.test.jsx`
- Modify: `tests/unit/components/ImageViewer.test.jsx`

**Interfaces:**
- Keeps `onRandomAlbum` accepted by GridPageToolbar for compatibility.
- Exposes visible `随机浏览` and accessible `随机当前文件夹 (E)`.
- ImageViewer owns e/E and r/R.

- [ ] **Step 1: Write failing toolbar copy tests**

Open the tune popover and assert:

```js
const button = screen.getByRole('button', { name: '随机当前文件夹 (E)' });
expect(button).toHaveTextContent('随机浏览');
fireEvent.click(button);
expect(defaultProps.onRandomAlbum).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Write failing ImageViewer uppercase tests**

Dispatch lowercase and uppercase E/R in separate renders. Assert e/E invoke rotation without random-image navigation, while r/R invoke random-image navigation without rotation. Use at least three images and deterministic `Math.random`.

- [ ] **Step 3: Run component tests and verify RED**

Run:

```bash
npm test -- --runInBand tests/unit/components/GridPageToolbar.test.jsx tests/unit/components/ImageViewer.test.jsx
```

Expected: copy and uppercase cases FAIL.

- [ ] **Step 4: Implement copy and case-insensitive Viewer dispatch**

Change the toolbar default and button text:

```js
randomTooltip = '随机当前文件夹 (E)'
// ...
<Button aria-label={randomTooltip}>随机浏览</Button>
```

Normalize only the Viewer shortcut key:

```js
const shortcutKey = typeof event.key === 'string' ? event.key.toLowerCase() : '';
if (shortcutKey === 'e') handleRotateRight();
if (shortcutKey === 'r') handleRandomImage();
```

Keep existing modifier and editable-target guards.

- [ ] **Step 5: Run Task 4 tests and commit**

Run the Task 4 focused command and `git diff --check`. Expected: both suites PASS.

Commit:

```bash
git add src/renderer/components/GridPageToolbar.js src/renderer/components/ImageViewer.js tests/unit/components/GridPageToolbar.test.jsx tests/unit/components/ImageViewer.test.jsx
git commit -m "feat(random): rename random browsing controls"
```

---

### Task 5: Real BrowserPage random-navigation integration

**Files:**
- Create: `tests/unit/pages/BrowserPage.randomNavigation.test.jsx`
- Modify: `tests/unit/pages/BrowserPage.test.jsx`
- Modify only when a test exposes a defect: Task 1–4 runtime files

**Interfaces:**
- Uses real BrowserPage, HomePage, and AlbumPage modules.
- Mocks only Electron IPC, router boundary, virtualization, expensive image hooks, and leaf visual components.

- [ ] **Step 1: Create a real-page test harness and write the failing cross-page test**

Do not mock HomePage or AlbumPage. Return:

- legacy Home scan data so the current grid renders;
- canonical parent snapshot with children A, B, folder C, and hybrid D;
- canonical target snapshots matching their view modes; and
- deterministic random values.

Click “随机浏览” from Home, observe Album, click again from Album, and assert two different relative paths were committed before any repeat. The test must fail if either page remounts a local bag.

- [ ] **Step 2: Add folder/hybrid and direct-image assertions**

Prove folder C routes with `view=folder`/canonical `browse`, hybrid D routes with `view=album`/canonical `photoSet`, and a root direct image never appears in any random request or candidate key.

- [ ] **Step 3: Add same-path two-tab isolation and lifecycle assertions**

Open a second tab at the same canonical path, draw once in each, switch back, and prove each tab's next draw follows its own remaining queue. Close one tab and prove reopening a new same-path tab begins a fresh round. Restore a saved snapshot and prove prior random state is not reused.

- [ ] **Step 4: Add search/sort and adjacent-navigation assertions**

Change Home search text and display sort between draws; prove the remaining random sequence is unchanged. In Album, prove random can route to folder C while ArrowLeft/ArrowRight still select only photo-capable siblings from `useNeighboringAlbums`.

- [ ] **Step 5: Run integration tests and fix only evidenced defects**

Run:

```bash
npm test -- --runInBand tests/unit/pages/BrowserPage.randomNavigation.test.jsx tests/unit/pages/BrowserPage.test.jsx tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx
```

Expected: all suites PASS. If a failure exposes a runtime defect, first capture it with the narrowest failing assertion, then patch the responsible unit without unrelated refactoring.

- [ ] **Step 6: Run the complete random-focused regression set and commit**

Run:

```bash
npm test -- --runInBand tests/unit/utils/randomNavigation.test.js tests/unit/utils/shuffleBag.test.js tests/unit/hooks/useRandomNavigationCoordinator.test.jsx tests/unit/hooks/useShuffleBag.test.jsx tests/unit/pages/BrowserPage.randomNavigation.test.jsx tests/unit/pages/BrowserPage.test.jsx tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx tests/unit/components/GridPageToolbar.test.jsx tests/unit/components/ImageViewer.test.jsx
git diff --check
```

Expected: all focused suites PASS.

Commit the integration test and any narrowly required corrections:

```bash
git add tests/unit/pages/BrowserPage.randomNavigation.test.jsx tests/unit/pages/BrowserPage.test.jsx
git add src/renderer/utils/randomNavigation.js src/renderer/hooks/useRandomNavigationCoordinator.js src/renderer/pages/BrowserPage.js src/renderer/pages/HomePage.js src/renderer/pages/AlbumPage.js
git diff --cached --name-only
git commit -m "test(random): cover real cross-page browsing rounds"
```

Before committing, unstage any renderer file that was not actually changed for Task 5.

---

### Task 6: Version, full verification, review, and local main merge

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Verify: all task files and built `.app`

**Interfaces:**
- Produces release version `2.8.0` and a locally merged, verified `main`.

- [ ] **Step 1: Bump version and write the changelog entry**

Run the project-local version command without creating an npm tag:

```bash
npm version 2.8.0 --no-git-tag-version
```

Add a `2.8.0` changelog section describing current-level folder candidates, per-tab cross-page no-replacement behavior, stale one-retry handling, “随机浏览” copy, and E/R ownership.

- [ ] **Step 2: Run static diff checks**

Run:

```bash
git diff --check
git status --short
git diff -- package.json package-lock.json CHANGELOG.md
```

Expected: no whitespace errors; both package files show `2.8.0`; only intended task files are modified.

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm test -- --runInBand
```

Expected: every Jest suite and test passes with exit code 0.

- [ ] **Step 4: Build the Electron application**

Run:

```bash
npm run build
```

Expected: webpack production build and `electron-builder --dir` both exit 0 and produce `dist/mac-arm64/Photo Album Viewer.app`. Record existing unsigned Developer ID and bundle-size warnings without treating them as failures.

- [ ] **Step 5: Request two-stage code review and fix findings with TDD**

Run a spec-compliance review against ADR-001 Phase 3 and this plan, then a code-quality review. Any functional finding first receives a failing test; rerun the narrow suite, full suite, and build after fixes. Require zero Critical and zero Important findings before merge.

- [ ] **Step 6: Commit release metadata and final fixes**

Verify the exact staged boundary:

```bash
git add package.json package-lock.json CHANGELOG.md
git diff --cached --check
git diff --cached --name-only
git commit -m "chore(release): bump version to 2.8.0"
```

If review fixes exist, commit their tests and runtime files separately before the release commit.

- [ ] **Step 7: Perform the completion audit on the feature branch**

For every Global Constraint and spec acceptance item, point to source plus test evidence. Then run:

```bash
git status --short --branch
git log --oneline --decorate main..HEAD
git diff --check main...HEAD
```

Expected: clean branch, coherent Phase 3 commits, and no diff errors.

- [ ] **Step 8: Merge locally into main and verify the merged tree**

Run:

```bash
git switch main
git merge --no-ff codex/random-browsing -m "merge: 合入随机浏览 Phase 3"
npm test -- --runInBand
npm run build
git status --short --branch
```

Expected: merge succeeds, post-merge tests/build pass, and local `main` is clean. Do not push or create a pull request.
