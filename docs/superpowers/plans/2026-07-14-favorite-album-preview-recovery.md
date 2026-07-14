# Favorite Album Preview Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复当前收藏相簿封面，并让封面路径随相簿 SourceRoot 定位迁移，在元数据缺失时从当前相簿回退选图。

**Architecture:** 在 `favorite-locator` 中把封面表示为依附相簿的 `previewRelativePaths`，保存时编码、加载时基于物化后的相簿路径解码。扩展一次性重连引擎，扫描当前相簿内的媒体并生成封面变更；`AlbumCard` 仅在没有可用样本时调用现有相簿图片 IPC 获取首图，保持正常路径零额外 IPC。

**Tech Stack:** Electron 27、React 18、Node.js CommonJS、Jest 30、mock-fs、Webpack、electron-builder。

## Global Constraints

- 只修复收藏相簿封面，不扩大到未授权目录或收藏文件夹。
- `previewRelativePaths` 必须是相对于相簿目录的 portable relative path，不允许绝对路径或 `..`。
- 真实 `favorites.json` 写入必须保留原文件备份、manifest、摘要校验与原子替换。
- 向后兼容旧的 `previewImages`、`previewImagePath`、`previewSamples`、`samples`。
- 版本从 `3.2.0` 提升到 `3.2.1`，同步 `package-lock.json` 和 `CHANGELOG.md`。
- 用户可见 Electron 行为改动交付前必须运行完整 `npm run build`。

---

### Task 1: 封面相对定位编码与物化

**Files:**
- Modify: `src/common/favorite-locator.js`
- Test: `tests/unit/favoriteLocator.test.js`

**Interfaces:**
- Consumes: `getPortableRelativePath(albumPath, previewPath)`、`resolvePortableRelativePath(albumPath, relativePath)`。
- Produces: `attachAlbumPreviewLocators(album)` 和 `materializeAlbumPreviewPaths(album)`，由 albums 分支调用。

- [ ] **Step 1: 写失败测试**

保存时把相簿内封面转换成 `previewRelativePaths`；加载到新 SourceRoot 后把它物化为新的 `previewSamples`；相簿外路径与 `../` 路径被拒绝；旧格式无新字段时保持兼容。

```js
expect(attachFavoritesLocators({
  albums: [{
    path: '/Volumes/1TB/Collection/album',
    previewImages: [{ path: '/Volumes/1TB/Collection/album/cover.jpg' }]
  }]
}, sources).albums[0].previewRelativePaths).toEqual(['cover.jpg']);

expect(materializeFavoritesData(located, movedSources).albums[0].previewSamples)
  .toEqual(['/Volumes/Rebased/album/cover.jpg']);
```

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/favoriteLocator.test.js`

Expected: FAIL，`previewRelativePaths` 为 `undefined` 或物化后仍是旧封面路径。

- [ ] **Step 3: 最小实现**

收集现有封面字段，用 `getPortableRelativePath` 过滤相簿内路径；物化时只接受 `isPortableRelativePath` 的值，并把结果写入 `previewSamples`、`samples`、`previewImagePath` 与兼容 `previewImages`。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --runInBand tests/unit/favoriteLocator.test.js tests/unit/services/FavoritesService.test.js`

Expected: 两个 suite 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/common/favorite-locator.js tests/unit/favoriteLocator.test.js
git commit -m "fix(favorites): rebase album preview paths"
```

### Task 2: 一次性封面恢复计划与安全写入

**Files:**
- Modify: `src/main/services/FavoritesReconciliation.js`
- Modify: `scripts/reconcile-favorites.js`
- Test: `tests/unit/services/FavoritesReconciliation.test.js`

**Interfaces:**
- Consumes: 已解析的相簿 `newPath`、扫描索引、`previewRelativePaths` 数据模型。
- Produces: `albumPreviewChanges`，每项包含 `id`、`albumPath`、`previewPath`、`previewRelativePath`、`reason`；summary 新增 `albumPreviewsResolved` 和 `albumPreviewsUnresolved`。

- [ ] **Step 1: 写失败测试**

覆盖旧相对位置存在、当前相簿内唯一同名、没有旧封面时稳定选择首图；没有媒体时进入 unresolved。应用后断言兼容字段和 `previewRelativePaths` 同步更新，其他元数据不变。

```js
expect(plan.albumPreviewChanges).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'album-unique', previewRelativePath: 'cover.jpg' })
]));
expect(stored.albums[0]).toMatchObject({
  previewRelativePaths: ['cover.jpg'],
  previewImagePath: '/library/500-Cos专题/set-037/cover.jpg'
});
```

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/services/FavoritesReconciliation.test.js`

Expected: FAIL，计划中没有 `albumPreviewChanges` 或 summary 字段。

- [ ] **Step 3: 最小实现**

扫描索引为每个目录保留受支持媒体文件，针对最终相簿路径生成封面变更。应用时校验目标存在且位于相簿内，然后同步写入 `previewRelativePaths`、`previewSamples`、`samples`、`previewImagePath`、`previewImages`。脚本 dry-run 输出新增封面汇总，但仍默认不写入。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --runInBand tests/unit/services/FavoritesReconciliation.test.js tests/unit/favoriteLocator.test.js`

Expected: 两个 suite 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/FavoritesReconciliation.js scripts/reconcile-favorites.js tests/unit/services/FavoritesReconciliation.test.js
git commit -m "fix(favorites): recover album preview metadata"
```

### Task 3: 收藏相簿无封面时运行时回退

**Files:**
- Modify: `src/renderer/components/AlbumCard.js`
- Test: `tests/unit/components/AlbumCard.test.jsx`

**Interfaces:**
- Consumes: `CHANNELS.GET_ALBUM_IMAGES` 无 options 时返回图片数组，元素包含 `path`。
- Produces: samples 为空时请求当前相簿首图并调用 `GET_BATCH_THUMBNAILS` 的行为。

- [ ] **Step 1: 写失败测试**

渲染收藏相簿且 samples 为空，mock `GET_ALBUM_IMAGES` 返回当前相簿图片；断言随后以该图片请求缩略图。另测返回空数组时保持占位符且不循环请求。

```js
expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-album-images', '/library/album');
expect(ipcRenderer.invoke).toHaveBeenCalledWith(
  'get-batch-thumbnails',
  ['/library/album/cover.jpg'],
  0
);
```

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/components/AlbumCard.test.jsx`

Expected: FAIL，当前实现 samples 为空时不会调用 `GET_ALBUM_IMAGES`。

- [ ] **Step 3: 最小实现**

在现有 `useEffect` 的 IPC fallback 中，当 samples 为空且是可打开的相簿时调用 `GET_ALBUM_IMAGES`，取首个合法 `path`；其后复用批量缩略图分支。使用现有 request map 防止重复请求，不增加正常封面的 IPC。

- [ ] **Step 4: 验证 GREEN**

Run: `npm test -- --runInBand tests/unit/components/AlbumCard.test.jsx tests/unit/pages/FavoritesPage.test.jsx tests/unit/components/CardRadius.test.jsx`

Expected: 三个 suite 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/components/AlbumCard.js tests/unit/components/AlbumCard.test.jsx
git commit -m "fix(favorites): fall back to album cover scan"
```

### Task 4: 版本、真实数据恢复与交付验证

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`
- Data write: `~/Library/Application Support/photo-album-viewer/favorites.json`

**Interfaces:**
- Consumes: `node scripts/reconcile-favorites.js` dry-run 与 `--apply`。
- Produces: 3.2.1 应用、带 manifest 的收藏备份、封面恢复统计。

- [ ] **Step 1: 更新版本与 Changelog**

运行 `npm version 3.2.1 --no-git-tag-version`；在 Changelog 顶部记录封面可迁移定位、运行时回退和一次性恢复结果。

- [ ] **Step 2: 运行 dry-run 并核验不写入**

记录真实 `favorites.json` 的 SHA-256，运行 `node scripts/reconcile-favorites.js`，再次核验 SHA-256 不变；检查 39 个相簿封面结果和 unresolved 明细。

- [ ] **Step 3: 应用真实数据恢复**

Run: `node scripts/reconcile-favorites.js --apply`

Expected: 创建新的 `.codex/backups/<timestamp>-reconcile-favorites/`，原备份 SHA-256 与应用前一致；更新后相簿数量仍为 39，计划目标均存在。

- [ ] **Step 4: 运行完整验证**

Run: `npm test -- --runInBand`

Run: `node --check src/common/favorite-locator.js`

Run: `node --check src/main/services/FavoritesReconciliation.js`

Run: `node --check scripts/reconcile-favorites.js`

Run: `git diff --check`

Run: `npm audit --audit-level=high`

Run: `npm run build`

Expected: 测试、语法、diff 和 build 退出 0；audit 若仍为已有依赖漏洞，记录准确数量且不进行破坏性核心依赖升级。

- [ ] **Step 5: 提交并合并 main**

提交 `chore(release): bump version to 3.2.1`。确认工作区干净后切回 `main`，执行 `git merge --no-ff codex/favorite-album-preview-recovery`，并在 main 上重新运行目标测试。
