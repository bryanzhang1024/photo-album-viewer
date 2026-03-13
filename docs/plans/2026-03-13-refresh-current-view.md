# Refresh Current View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在文件夹页和相簿页顶部操作区增加刷新按钮，分别刷新当前目录内容或当前相簿图片。

**Architecture:** 保持刷新逻辑留在各自页面内部，不向 BrowserPage 抽象共享刷新协议。HomePage 继续使用现有目录扫描逻辑，AlbumPage 直接复用 `useAlbumImages` 已暴露的 `refresh` 方法，从而把改动限制在两个页面和对应测试中。

**Tech Stack:** React, Material UI, Jest, Testing Library

---

### Task 1: 为文件夹页写失败测试

**Files:**
- Create: `tests/unit/pages/HomePage.test.jsx`
- Modify: `src/renderer/pages/HomePage.js`

**Step 1: Write the failing test**

渲染 `HomePage` 的 URL 模式，注入一个当前路径并 mock `window.electronAPI.invoke` 返回扫描结果。断言页面出现“刷新当前文件夹”按钮，点击后会先清空 `imageCache` 的 `navigation` 缓存，再重新调用 `SCAN_NAVIGATION_LEVEL`。

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand tests/unit/pages/HomePage.test.jsx`
Expected: FAIL，提示找不到刷新按钮或点击后没有触发刷新行为。

### Task 2: 为相簿页写失败测试

**Files:**
- Create: `tests/unit/pages/AlbumPage.test.jsx`
- Modify: `src/renderer/pages/AlbumPage.js`

**Step 1: Write the failing test**

mock `useAlbumImages` 返回一个 `refresh` spy，渲染 `AlbumPage` 的 URL 模式。断言页面出现“刷新当前相簿”按钮，点击后调用 `refresh`。

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand tests/unit/pages/AlbumPage.test.jsx`
Expected: FAIL，提示找不到刷新按钮或 `refresh` 没有被调用。

### Task 3: 做最小实现

**Files:**
- Modify: `src/renderer/pages/HomePage.js`
- Modify: `src/renderer/pages/AlbumPage.js`

**Step 1: Expose folder refresh control**

在 `HomePage` 顶部右侧操作组中加入刷新按钮，复用现有 `handleRefresh`，并在无 `rootPath` 且无 `currentPath` 时禁用按钮。

**Step 2: Expose album refresh control**

在 `AlbumPage` 顶部右侧操作组中加入刷新按钮，点击时调用 `refresh`。

### Task 4: 回归验证

**Files:**
- Test: `tests/unit/pages/HomePage.test.jsx`
- Test: `tests/unit/pages/AlbumPage.test.jsx`
- Test: `tests/unit/hooks/useAlbumImages.test.jsx`

**Step 1: Run focused page tests**

Run: `npm test -- --runInBand tests/unit/pages/HomePage.test.jsx tests/unit/pages/AlbumPage.test.jsx`
Expected: PASS

**Step 2: Run related hook test**

Run: `npm test -- --runInBand tests/unit/hooks/useAlbumImages.test.jsx`
Expected: PASS
