# Tab Scroll Position Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复标签页切换后列表滚动位置丢失的问题，并让同一路径的不同标签页互不覆盖滚动位置。

**Architecture:** 将滚动位置存储键从纯 URL 扩展为 `tabId + URL`，把保存动作集中到 `BrowserPage` 的标签切换入口。页面组件继续负责在挂载后按当前键恢复滚动位置，但不再依赖“只有页内导航才会先保存”的隐含前提。

**Tech Stack:** React, React Router, Jest, Testing Library

---

### Task 1: 先补失败测试

**Files:**
- Modify: `tests/unit/pages/BrowserPage.test.jsx`

**Step 1: Write the failing test**

新增一个浏览器页测试，构造两个标签页会话，让第一个标签页渲染一个可滚动容器，滚动到非零位置后切换到第二个标签页，再切回第一个标签页，断言第一次滚动位置被恢复。

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand tests/unit/pages/BrowserPage.test.jsx`
Expected: FAIL，说明切换标签前没有保存当前滚动位置。

### Task 2: 实现 tab 级滚动位置键

**Files:**
- Modify: `src/renderer/pages/BrowserPage.js`
- Modify: `src/renderer/pages/HomePage.js`
- Modify: `src/renderer/pages/AlbumPage.js`
- Modify: `src/renderer/pages/FavoritesPage.js`

**Step 1: Add tab scroll context**

在 `BrowserPage` 中计算当前激活标签的滚动键前缀，并把它传给具体页面。

**Step 2: Save scroll before tab switch**

在切换标签前读取当前 `.scroll-container` 的 `scrollTop`，按当前激活标签的滚动键保存。

**Step 3: Scope page restoration by tab**

让三个页面把滚动位置键从 `pathname + search` 改为 `tabScrollKey + pathname + search`，确保不同标签互不覆盖。

### Task 3: 回归验证

**Files:**
- Test: `tests/unit/pages/BrowserPage.test.jsx`

**Step 1: Run focused tests**

Run: `npm test -- --runInBand tests/unit/pages/BrowserPage.test.jsx`
Expected: PASS

**Step 2: Run related page tests if needed**

Run: `npm test -- --runInBand tests/unit/pages/BrowserPage.test.jsx tests/unit/navigation.test.js`
Expected: PASS
