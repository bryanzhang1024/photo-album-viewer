# 全局重构计划 (Global Refactoring Plan)

本文档旨在规划一次全面的应用架构重构，以消除技术债务、提升代码质量和可维护性。

## 核心原则 (Core Principles)

1.  **分阶段进行 (Phased Approach)**: 将庞大的重构任务分解为独立的、可管理的阶段。
2.  **步步验证 (Verify at Every Step)**: 每个阶段或关键步骤完成后，必须启动并测试应用核心功能，确保其仍然可用。
3.  **优先稳定 (Stability First)**: 重构的首要目标是提升架构健康度，而不是破坏现有功能。功能的稳定性优先于重构的进度。
4.  **冻结功能 (Feature Freeze)**: 在整个重构期间，不应添加任何新功能。

---

## Phase 1: 后端服务化 (Backend Service Separation)

**目标**: 将“上帝文件” `main.js` 拆分为多个职责单一的模块，提高后端代码的可读性和可维护性。这是风险最低、收益最高的阶段。

*   **Step 1.1: 抽离窗口管理**
    *   **任务**: 创建 `src/main/services/WindowService.js`，将所有与 `BrowserWindow` 创建、管理、跟踪相关的代码从 `main.js` 移入其中。
    *   **验收标准**: 应用可以正常启动，可以创建新窗口，窗口关闭行为正常。

*   **Step 1.2: 抽离文件系统逻辑**
    *   **任务**: 创建 `src/main/services/FileSystemService.js`，将 `scanNavigationLevel`, `determineNodeType`, `getAlbumStats`, `getFolderStats`, `getAlbumImages` 等所有文件相关的函数移入其中。
    *   **验收标准**: 文件夹和相册的扫描、导航、内容加载功能完全正常。我们刚刚修复的两个bug的行为保持正确。

*   **Step 1.3: 抽离缩略图服务**
    *   **任务**: 创建 `src/main/services/ThumbnailService.js`，将所有与 `sharp` 库相关的缩略图生成、队列管理、缓存逻辑移入其中。
    *   **验收标准**: 所有相册和图片的缩略图依然可以正常生成和显示。

*   **Step 1.4: 简化 `main.js`**
    *   **任务**: 重构 `main.js`，使其主要只包含 `ipcMain.handle` 的定义。它将作为“调度中心”，调用上述各个Service来完成具体工作。
    *   **验收标准**: `main.js` 文件行数大幅减少，逻辑清晰。整个应用的所有功能与重构前完全一致。

---

## Phase 2: API与数据流净化 (API & Data Flow Cleanup)

**目标**: 优化前后端通信方式，定义清晰的数据契约。

*   **Step 2.1: 废除缩略图HTTP服务器**
    *   **任务**:
        1.  修改 `ThumbnailService.js`，使其生成缩略图后，直接返回 `base64` 格式的Data URI。
        2.  修改前端 `ImageCard.js` 和 `AlbumCard.js`，使其 `<img>` 标签的 `src` 属性可以直接使用Data URI。
        3.  从 `main.js` 中彻底移除 `http.createServer` 及所有相关代码。
    *   **验收标准**: 缩略图显示正常。应用启动后，后台不再有本地HTTP服务器进程，端口不再被占用。

*   **Step 2.2: 统一IPC通道命名**
    *   **任务**: 创建 `src/common/ipc-channels.js` 文件，用常量定义所有IPC通道名称。前后端都从该文件导入常量。
    *   **验收标准**: 应用功能正常，消除了因手写字符串可能导致的通道名称不匹配的风险。

---

## Phase 3: 前端组件与Hooks抽象 (Frontend Component & Hook Abstraction)

**目标**: 消除 `HomePage` 和 `AlbumPage` 的代码重复，拆分“上帝组件”。这是最复杂，但对前端代码健康度提升最大的阶段。

*   **Step 3.1: 创建 `PageLayout` 组件**
    *   **任务**: 创建 `src/renderer/components/layout/PageLayout.js`，包含共享的 `AppBar`、面包屑和内容区骨架。
    *   **验收标准**: 该组件存在，但尚未被使用。

*   **Step 3.2: 抽象自定义Hooks**
    *   **任务**: 创建 `src/renderer/hooks/useSorting.js` 和 `src/renderer/hooks/useViewSettings.js` 等，将排序和视图设置的状态逻辑从页面组件中剥离。
    *   **验收标准**: Hooks创建完成。

*   **Step 3.3: 重构 `HomePage.js`**
    *   **任务**:
        1.  将 `HomePage` 的渲染逻辑替换为使用 `<PageLayout>`。
        2.  将其内部的状态管理逻辑替换为调用 `useSorting` 等自定义Hooks。
    *   **验收标准**: 主页功能与重构前完全一致，但 `HomePage.js` 的代码行数显著减少。

*   **Step 3.4: 重构 `AlbumPage.js`**
    *   **任务**: 对 `AlbumPage.js` 执行与上一步相同的重构。
    *   **验收标准**: 相册页功能与重构前完全一致，且与主页共享了大量可复用的Hooks和布局代码，代码重复问题被解决。
