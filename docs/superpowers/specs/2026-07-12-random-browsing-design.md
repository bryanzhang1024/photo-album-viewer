# Random Browsing Phase 3 Design

Date: 2026-07-12

Status: Approved by the active goal to implement ADR-001 Phase 3, strategy A

Source of truth: `docs/plans/ADR-001.md`, especially sections 6–9 and the Phase 3 row

## Goal

Replace the page-local “random album” behavior with “random browsing” over the current directory level.

The completed behavior must:

- give every unique, openable direct child directory one vote;
- navigate a pure folder with `viewMode='browse'`;
- navigate a pure photo directory or hybrid directory with `viewMode='photoSet'`;
- preserve one no-replacement round across HomePage and AlbumPage;
- isolate state by browser tab and source-directory scope;
- ignore search and display sorting;
- recover from a missing or changed target with at most one parent rescan and redraw;
- leave Album prev/next photo-only;
- rename the UI to “随机浏览”; and
- prevent Home/Album E/R handlers from competing with ImageViewer.

This phase does not add recursive random search, global indexing, persistent random state, or Phase 5 cache ownership.

## Chosen approach

`BrowserPage` owns the runtime random coordinator. A new pure module, `src/renderer/utils/randomNavigation.js`, owns candidate projection, stable signatures, shuffle-bag transitions, and bounded scope-store helpers.

Two alternatives were rejected:

1. A global React Context would introduce provider and cross-window semantics that this phase does not need.
2. Page-local hooks or a module singleton cannot simultaneously provide Home/Album continuity, per-tab isolation, deterministic cleanup, and straightforward testing.

The coordinator uses the canonical `GET_DIRECTORY_LEVEL_V1` contract. The legacy `SCAN_NAVIGATION_LEVEL` DTO cannot distinguish missing, unreadable, and unknown child state reliably enough for random target validation.

## Product semantics

### Candidate pool

The pool comes from the unfiltered canonical snapshot for one source directory. Search results, display order, grid grouping, and direct images never feed the pool.

For each `snapshot.children` entry:

- skip any child whose status is not `ready`;
- choose `photoSet` when `facts.directMediaCount > 0`;
- otherwise choose `browse` when `facts.childDirectoryCount > 0`;
- otherwise skip it;
- deduplicate by canonical `DirectoryRef` key; and
- sort by `candidateKey`, then form a signature from `candidateKey|viewMode`.

This gives a hybrid directory one vote, with photoSet as its random destination. Lexical symlink aliases remain separate displayed directory references and therefore receive separate votes. `directMedia` from the current directory never participates.

### Source-directory scope

The active canonical BrowserLocation determines the scope:

- browse view: the current directory ref is the source-directory scope;
- photoSet view: the current directory ref's parent is the source-directory scope;
- a root photoSet clamps its parent to the source root;
- landing, favorites, and unresolved legacy locations have no canonical scope.

Home at directory `S` and Album at child `S/A` therefore share scope `S`. A random result that opens pure folder `S/B` enters browse view and correctly changes the active scope to `S/B`.

### No-replacement round

A bag state contains a candidate signature, remaining candidate keys, and `lastReturnedKey`.

- Signature change starts a new round while preserving `lastReturnedKey` for the boundary guard.
- The first bag created from Album treats the current directory as already visited.
- Every draw consumes and skips the current directory if it is still in `remaining`.
- A refill shuffles the complete candidate list.
- If a refill's first key equals `lastReturnedKey` and more than one candidate exists, it swaps that key behind another candidate.
- If the only candidate is the current Album directory, the draw returns no target rather than navigating in place or looping.

The random source is injectable in pure tests. Runtime uses `Math.random`.

## Ownership and lifecycle

`BrowserPage` keeps a non-persistent ref with this shape:

```text
randomStateByTabId
└── tabId
    └── LRU<sourceDirectoryKey, RandomScopeEntry>
        ├── targets
        └── bagState
```

Each tab retains at most eight source-directory scopes. Reading or writing a scope makes it most recently used; adding a ninth evicts the least recently used scope.

- Switching Home/Album, using browser navigation, or switching tabs preserves the relevant scope if it remains in the LRU.
- Two tabs at the same path have separate tab stores.
- Closing a tab deletes its store.
- Closing other tabs deletes their stores.
- Restoring a saved tab snapshot clears all random stores because random state is not session data.
- Replacing a tab's SourceRoot clears that tab's store.
- Search, sort, current photoSet path, and Album image refresh do not touch the store.
- A Home directory refresh invalidates the cached candidate snapshot for that scope but retains bag state. On the next load, an unchanged signature preserves the round; a changed signature starts a new round.

## Runtime data flow

### Normal draw

1. HomePage or AlbumPage calls the `onRandomBrowse` callback supplied by BrowserPage.
2. BrowserPage captures `tabId`, BrowserLocation identity, SourceRoot, and source-directory scope.
3. It loads the canonical parent snapshot only when that scope has no targets or has been invalidated.
4. `randomNavigation` builds targets and performs a synchronous draw.
5. BrowserPage validates the selected target with `GET_DIRECTORY_LEVEL_V1` for the target ref.
6. Validation derives the target's current random view from its fresh root facts and requires it to match the selected view mode.
7. BrowserPage commits the returned explicit NavigationTarget only if the same tab and location are still active.

The operation exposes a per-tab loading flag so repeated clicks cannot start overlapping draws. A result from an old tab/location is discarded without consuming a target.

### Stale recovery

`ENOENT`, `ENOTDIR`, or a target whose newly derived random view differs from the selected view are recoverable once:

1. consume the failed draw in the pending bag transition;
2. rescan the source-directory scope;
3. rebuild candidates and reconcile the signature;
4. draw one more target; and
5. validate once more.

A second validation failure stops. `EACCES`, `IO_ERROR`, missing SourceRoot, invalid contract responses, and other IPC errors stop immediately with a precise user message. They never enter a retry loop.

## Component boundaries

### `src/renderer/utils/randomNavigation.js`

Pure and independently tested responsibilities:

- canonical DirectoryRef keys and source-directory context;
- child snapshot to RandomNavigationTarget projection;
- stable candidate signatures;
- no-replacement draw and refill boundary behavior;
- target-view validation classification; and
- immutable bounded-LRU helpers.

It contains no React state, IPC calls, routing, UI strings, or persistence.

### `BrowserPage`

Owns:

- per-tab LRU stores;
- canonical snapshot loading and target validation;
- one-retry stale orchestration;
- async operation identity guards;
- tab/source cleanup;
- navigation commits; and
- active-tab loading, disabled, and error state.

It passes HomePage and AlbumPage thin callback/status props. Pages never own canonical random bag state.

### `HomePage`

- invokes the BrowserPage coordinator in canonical mode;
- invalidates its active random scope when the current directory is manually refreshed;
- retains the existing page-local photo-only path only for unresolved legacy locations during the compatibility window; and
- ignores page-level shortcuts while ImageViewer is open.

### `AlbumPage`

- invokes the BrowserPage coordinator in canonical mode;
- leaves image refresh unrelated to random state;
- retains the existing page-local photo-only path only for unresolved legacy locations during the compatibility window; and
- keeps prev/next backed by the existing photo-capable sibling list.

### `GridPageToolbar` and `ImageViewer`

The visible label becomes “随机浏览” and the accessible tooltip becomes “随机当前文件夹 (E)”. The legacy `onRandomAlbum` toolbar prop remains accepted for one minor-version compatibility window; no feature flag is added.

ImageViewer handles both lower- and uppercase E as rotate and R as random image. HomePage and AlbumPage ignore E/R while it is open, independent of listener registration order.

## Compatibility

Canonical SourceRoot tabs always use the new coordinator. An unresolved `legacyAbsolute` tab cannot call the source-relative v1 contract, so HomePage/AlbumPage retain their old photo-only local fallback for one minor release. This is the rollback adapter required by ADR-001; it must not fabricate a source ID.

The toolbar callback name remains compatible while its visible semantics change. `useShuffleBag` remains because ImageViewer still uses it; Phase 3 only removes it as the canonical Home/Album state owner.

## Error and empty states

- No openable child directory: “当前文件夹没有可随机浏览的目录”.
- Only current Album remains in the round: “当前文件夹没有其他可随机浏览的目录”.
- Missing or changed targets after one retry: “随机目标已变化，请刷新后重试”.
- Permission denied: identify the inaccessible directory and do not retry.
- Source/NAS I/O failure: report the source as temporarily unavailable and do not retry automatically.
- An unresolved legacy tab continues its existing local error behavior during the compatibility window.

## Test strategy

### Pure unit tests

`randomNavigation.test.js` proves:

- pure folder, pure photo, hybrid, empty, unreadable, missing, and unknown projection;
- hybrid one-vote deduplication;
- direct images excluded;
- lexical DirectoryRef identity;
- stable signature independent of input, search, and display sort order;
- one complete round without replacement;
- current Album consumed and skipped;
- single-current-candidate empty result;
- refill boundary repeat prevention;
- signature-change reset; and
- eight-entry per-tab LRU behavior.

### Browser integration tests

BrowserPage tests use real HomePage and AlbumPage for the random flow rather than mocking both pages. They prove:

- real Home → Album → Album draws do not repeat in one round;
- a folder result commits browse and photo/hybrid results commit photoSet;
- two same-path tabs have independent bags;
- tab switching and back/forward preserve a scope;
- closing tabs and restoring snapshots clean runtime state;
- source changes reset only the affected tab;
- search and sorting do not change the bag;
- Home refresh only resets when the canonical candidate signature changes;
- Album image refresh does not reset;
- a stale target causes exactly one parent rescan and redraw;
- unreadable/offline errors do not loop; and
- an operation cannot navigate a newly active tab after an async race.

### Component tests

- GridPageToolbar exposes “随机浏览” and “随机当前文件夹 (E)” while accepting the old callback prop.
- Home and Album page shortcut tests prove E/R have no page effect with Viewer open.
- ImageViewer tests prove e/E and r/R ownership.
- Existing Album prev/next tests continue proving folders are excluded.

The final gate is the full Jest suite followed by `npm run build`, plus version synchronization in `package.json`, `package-lock.json`, and `CHANGELOG.md`.

## Version and delivery

This is a backward-compatible user-visible feature, so the planned version is `2.8.0`. The implementation remains on `codex/random-browsing`, is committed locally after verification, and is merged into local `main` with `git merge --no-ff`. No push or pull request is part of this goal.
