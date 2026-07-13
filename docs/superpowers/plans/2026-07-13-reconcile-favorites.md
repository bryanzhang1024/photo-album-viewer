# 收藏重连与 SourceRoot 迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复指定媒体目录内可高置信度定位的失效收藏，并让收藏持久化与读取优先使用稳定的 SourceRoot 定位信息。

**Architecture:** 共享定位模块负责绝对路径与 `sourceId + relativePath` 的双向转换；主进程收藏服务在 load/save 边界统一解析和补全定位字段，renderer 保持兼容。独立重连模块只扫描用户指定目录，生成确定性计划并在应用阶段校验收藏摘要、创建受控备份、原子替换数据。

**Tech Stack:** Electron、Node.js CommonJS、React、Jest、mock-fs、Webpack、electron-builder。

## Global Constraints

- 只扫描 `/Volumes/Collection/300-Cosplayer`、`/Volumes/1TB/Collection/400-Cos Album`、`/Volumes/1TB/Collection/500-Cos专题`、`/Volumes/1TB/Collection/600-Cos Weibo`、`/Volumes/1TB/Collection/兴趣`。
- 不删除未匹配或歧义收藏，不计算全库内容哈希，不修改 SourceRoot 注册表。
- 普通文件名且缺少文件大小时不得仅凭名称自动匹配。
- 应用计划前校验收藏内容摘要和目标存在性，失败时整体拒绝写入。
- 真实写入前创建 `.codex/backups/<timestamp>-reconcile-favorites/` 备份及 manifest。
- 版本从 `3.1.0` 提升到 `3.2.0`，同步 `package-lock.json` 和 `CHANGELOG.md`。
- 用户可见行为改动交付前必须运行 `npm run build`。

---

### Task 1: SourceRoot 收藏定位模块

**Files:**
- Create: `src/common/favorite-locator.js`
- Create: `tests/unit/favoriteLocator.test.js`

**Interfaces:**
- Consumes: `findUniqueLongestSourceRoot()`、`resolvePortableRelativePath()`、`sourceIdsEqualV1()`。
- Produces: `attachFavoriteLocator(item, sources)`、`materializeFavoritePath(item, sources)`、`materializeFavoritesData(data, sources)`、`attachFavoritesLocators(data, sources)`。

- [ ] **Step 1: 写失败测试**

覆盖最长 SourceRoot 归属、定位字段解析新根路径、旧格式透传、缺失 source 保留旧路径，以及 folders/albums/images 三类集合批量处理：

```js
expect(attachFavoriteLocator({ path: '/Volumes/1TB/Collection/a.jpg' }, sources))
  .toMatchObject({ sourceId: nestedSource.sourceId, relativePath: 'a.jpg' });

expect(materializeFavoritePath({
  path: '/old/a.jpg',
  sourceId: nestedSource.sourceId,
  relativePath: 'a.jpg'
}, [{ ...nestedSource, rootPath: '/Volumes/NewCollection' }]).path)
  .toBe('/Volumes/NewCollection/a.jpg');
```

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/favoriteLocator.test.js`

Expected: FAIL，原因是 `src/common/favorite-locator.js` 尚不存在。

- [ ] **Step 3: 最小实现**

实现严格的纯函数边界：

```js
function attachFavoriteLocator(item, sources) {
  if (!item || typeof item.path !== 'string') return item;
  const match = findUniqueLongestSourceRoot(sources, item.path);
  if (match.status !== 'resolved') return item;
  return { ...item, sourceId: match.source.sourceId, relativePath: match.relativePath };
}

function materializeFavoritePath(item, sources) {
  if (!item || typeof item.sourceId !== 'string' || !isPortableRelativePath(item.relativePath)) {
    return item;
  }
  const source = sources.find(candidate => sourceIdsEqualV1(candidate.sourceId, item.sourceId));
  return source ? { ...item, path: resolvePortableRelativePath(source.rootPath, item.relativePath) } : item;
}
```

批量函数只映射 `folders`、`albums`、`images`，其余顶层字段原样保留。

- [ ] **Step 4: 验证 GREEN 与静态检查**

Run: `npm test -- --runInBand tests/unit/favoriteLocator.test.js && git diff --check`

Expected: 测试通过，`git diff --check` 无输出。

- [ ] **Step 5: 提交**

```bash
git add src/common/favorite-locator.js tests/unit/favoriteLocator.test.js
git commit -m "feat(favorites): add SourceRoot locators"
```

### Task 2: 收藏服务统一解析和保存定位字段

**Files:**
- Modify: `src/main/services/FavoritesService.js`
- Modify: `src/main/main.js`
- Modify: `tests/unit/services/FavoritesService.test.js`

**Interfaces:**
- Consumes: Task 1 的 `materializeFavoritesData()`、`attachFavoritesLocators()`；`sourceRootService.listSourceRoots()`。
- Produces: `registerIpcHandlers({ sourceRootService })`，LOAD 返回当前根路径下的 materialized 数据，SAVE 持久化 locator 数据。

- [ ] **Step 1: 写失败测试**

给 FavoritesService 注入：

```js
const sourceRootService = {
  listSourceRoots: jest.fn().mockResolvedValue([{ sourceId, rootPath: '/new', label: 'new' }])
};
FavoritesService.registerIpcHandlers({ sourceRootService });
```

新增断言：LOAD 将 `{ path:'/old/a.jpg', sourceId, relativePath:'a.jpg' }` 返回为 `/new/a.jpg`；SAVE 将 `/new/b.jpg` 持久化为 `sourceId + relativePath:'b.jpg'`；没有注入服务时保持现有行为。

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/services/FavoritesService.test.js`

Expected: FAIL，LOAD 未解析路径且 SAVE 未补全 locator。

- [ ] **Step 3: 最小实现**

把 main 中注册调用移动到 `sourceRootService` 创建后：

```js
const sourceRootService = createSourceRootService({ registryPath });
FavoritesService.registerIpcHandlers({ sourceRootService });
```

FavoritesService 新增内部边界：

```js
async function getSources() {
  return sourceRootService ? sourceRootService.listSourceRoots() : [];
}

const stored = await loadFavoritesInternal();
return materializeFavoritesData(stored, await getSources());
```

SAVE 在版本检查后调用 `attachFavoritesLocators(favoritesData, sources)`，再增加版本和时间。watcher 广播也 materialize，磁盘数据始终保留 canonical locator。

- [ ] **Step 4: 验证 GREEN 与回归**

Run: `npm test -- --runInBand tests/unit/services/FavoritesService.test.js tests/unit/contexts/FavoritesContext.test.jsx tests/unit/pages/FavoritesPage.test.jsx tests/unit/pages/BrowserPage.test.jsx && git diff --check`

Expected: 全部通过。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/FavoritesService.js src/main/main.js tests/unit/services/FavoritesService.test.js
git commit -m "feat(favorites): persist SourceRoot locations"
```

### Task 3: 确定性重连引擎

**Files:**
- Create: `src/main/services/FavoritesReconciliation.js`
- Create: `tests/unit/services/FavoritesReconciliation.test.js`

**Interfaces:**
- Consumes: Task 1 的 `attachFavoriteLocator()`；注入的 `fsApi`；收藏、sources、scanRoots。
- Produces: `createReconciliationPlan(options)`，返回 `{ sourceDigest, summary, changes, unresolved }`；`applyReconciliationPlan(options)` 执行校验、备份和原子写入。

- [ ] **Step 1: 写匹配规则失败测试**

用 mock-fs 建立小型库，分别覆盖：唯一相簿名、父相簿消歧、相簿映射后的照片、文件大小消歧、日期格式消歧、`3.jpg` 多候选拒绝、未匹配保留。

```js
expect(plan.summary).toEqual({ albumsResolved: 2, imagesResolved: 3, unresolved: 2 });
expect(plan.changes.find(change => change.id === 'image-generic')).toBeUndefined();
expect(plan.unresolved).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: 'image-generic', reason: 'ambiguous' })
]));
```

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/services/FavoritesReconciliation.test.js`

Expected: FAIL，重连模块尚不存在。

- [ ] **Step 3: 实现扫描与计划生成**

一次遍历建立以下索引：

```js
directoriesByBasename: Map<string, string[]>
filesByBasename: Map<string, Array<{ path: string, size: number }>>
```

相簿候选先按目录名，再按父相簿已解析路径消歧。照片候选优先 `mappedAlbum + relativeFromOldAlbum`，再用 mapped album 同名、全局同名、文件大小和规范化日期。计划中的每个 change 固定保存 `id`、`collection`、`oldPath`、`newPath`、`reason`、`sourceId`、`relativePath`。

- [ ] **Step 4: 写应用阶段失败测试**

覆盖摘要变化整体拒绝、目标消失整体拒绝、备份 manifest、保留 ID/addedAt/collections、临时文件原子替换：

```js
await expect(applyReconciliationPlan({ ...options, favorites: changedFavorites }))
  .rejects.toThrow('收藏数据已变化');
expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(true);
```

- [ ] **Step 5: 验证 RED 后实现应用**

Run: `npm test -- --runInBand tests/unit/services/FavoritesReconciliation.test.js`

Expected: 新应用测试 FAIL。

实现 SHA-256 摘要、全量前置校验、受控备份及 manifest、写临时文件后 rename。只替换 plan 中按 collection+id+oldPath 精确命中的条目。

- [ ] **Step 6: 验证 GREEN 与静态检查**

Run: `npm test -- --runInBand tests/unit/services/FavoritesReconciliation.test.js && git diff --check`

Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add src/main/services/FavoritesReconciliation.js tests/unit/services/FavoritesReconciliation.test.js
git commit -m "feat(favorites): add reconciliation engine"
```

### Task 4: 一次性命令入口与真实数据迁移

**Files:**
- Create: `scripts/reconcile-favorites.js`
- Create during execution, ignored: `.codex/backups/<timestamp>-reconcile-favorites/manifest.json`
- Modify external user data after confirmed apply: `~/Library/Application Support/photo-album-viewer/favorites.json`

**Interfaces:**
- Consumes: Task 3 的计划生成和应用函数。
- Produces: `--apply` 命令，输出最终 JSON 汇总并以非零码报告失败。

- [ ] **Step 1: 写 CLI 参数失败测试**

在 reconciliation 测试中覆盖命令配置构造函数：无 `--apply` 只生成计划，有 `--apply` 执行写入；扫描根必须与 Global Constraints 完全一致。

- [ ] **Step 2: 验证 RED**

Run: `npm test -- --runInBand tests/unit/services/FavoritesReconciliation.test.js`

Expected: FAIL，命令配置导出尚不存在。

- [ ] **Step 3: 实现最小 CLI**

CLI 使用固定 app userData 文件与固定扫描根，支持 `--apply`。日志只输出数量、非敏感路径和备份位置，不输出文件内容。

- [ ] **Step 4: 验证 CLI dry-run**

Run: `node scripts/reconcile-favorites.js`

Expected: exit 0；汇总应为 34 个相簿和 124 张照片可修复，9 张不修改；`favorites.json` SHA-256 在运行前后相同。

- [ ] **Step 5: 执行已授权迁移**

Run: `node scripts/reconcile-favorites.js --apply`

Expected: exit 0；创建受控备份；写入 34 个相簿和 124 张照片；9 张保持原路径。

- [ ] **Step 6: 验证真实数据**

重新读取收藏，断言：39 个相簿和 160 张照片总数不变；全部 39 个相簿路径存在；151 张照片路径存在、9 张仍不可用；修复项都有合法 `sourceId + relativePath`；JSON 可解析；备份 SHA-256 等于迁移前摘要。

- [ ] **Step 7: 提交 CLI**

```bash
git add scripts/reconcile-favorites.js tests/unit/services/FavoritesReconciliation.test.js
git commit -m "feat(favorites): add one-time reconciliation command"
```

### Task 5: 版本、完整验证与交付提交

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1-4 的完整功能。
- Produces: 版本 `3.2.0` 及可构建应用。

- [ ] **Step 1: 更新版本与变更日志**

运行 `npm version 3.2.0 --no-git-tag-version`，在 CHANGELOG 顶部记录 SourceRoot 收藏定位、一次性盘点结果和未自动修复项目保留策略。

- [ ] **Step 2: 运行全量测试和质量检查**

Run: `npm test -- --runInBand && git diff --check && npm audit --audit-level=high`

Expected: Jest 0 failures；diff check 无输出；audit 无 high/critical 漏洞，若存在既有漏洞则记录完整输出和风险。

- [ ] **Step 3: 运行应用构建**

Run: `npm run build`

Expected: webpack production build 和 `electron-builder --dir` exit 0，生成 `.app`；缺少签名证书只记录分发风险。

- [ ] **Step 4: 最终规则复核**

逐项复核设计、项目 AGENTS.md、GROUNDRULES：版本三文件同步；真实数据验证完成；只提交任务文件；不提交 dist 或备份。

- [ ] **Step 5: 创建最终提交**

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): bump version to 3.2.0"
```

- [ ] **Step 6: 最终工作区验证**

Run: `git status --short --branch && git log -6 --oneline --decorate`

Expected: 工作区干净，当前分支为 `codex/reconcile-favorites`，所有任务提交可见。默认不 push、不创建 PR、不合并 main。
