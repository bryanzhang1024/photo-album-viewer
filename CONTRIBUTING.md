# 贡献指南 (Contribution Guide)

我们欢迎任何形式的贡献！为了保持代码库的整洁、可维护和高质量，请在开始开发前仔细阅读并遵循以下指南。

## 核心架构原则

本指南的核心思想源于一次大规模的架构重构，旨在防止未来的代码腐化。所有贡献者都应理解并遵循这些原则。

### 1. 后端服务化原则 (Backend Service Principle)

- **单一职责**: 任何新的后台功能（如数据库、用户认证、文件同步等）都**必须**创建独立的 `Service` 文件，并放置在 `src/main/services` 目录下。
- **调度中心**: `main.js` 文件只作为应用的入口和IPC调度中心。它应该只负责应用的生命周期管理和IPC路由，**不应**包含任何具体的业务逻辑实现。
- **IPC注册**: 新服务的IPC接口应在其自身的 `registerIpcHandlers` 函数中定义，然后由 `main.js` 在启动时调用该函数进行注册。

### 2. 前端组件化原则 (Frontend Component Principle)

- **UI抽象**: 任何在多个页面或组件之间复用的UI元素（如列表、卡片、布局、面板等），都**必须**被抽象为独立的React组件，并放置在 `src/renderer/components` 目录下。
- **逻辑抽象 (Hooks)**: 任何重复的、非渲染的业务逻辑（如数据获取、排序、过滤、视图状态管理等），都**必须**被抽象为自定义Hook，并放置在 `src/renderer/hooks` 目录下。
- **“上帝组件”禁令**: 页面级组件（位于 `src/renderer/pages`）应专注于组合布局组件和业务逻辑Hooks，自身应保持轻量，避免成为包含数百行状态和副作用的“上帝组件”。

### 3. 共享代码原则 (Shared Code Principle)

- **`src/common`**: 任何需要在主进程（后台）和渲染器进程（前端）之间共享的代码、常量或类型定义，都**必须**放置在 `src/common` 目录下。
- **IPC通道**: 所有IPC通道的名称都**必须**在 `src/common/ipc-channels.js` 中以常量的形式统一定义，前后端都必须从该文件导入使用，严禁在代码中手写IPC通道字符串。

### 4. 打包配置原则 (Packaging Configuration Principle)

- **文件包含**: 当你创建了一个新的顶级目录（例如 `src/new-feature/`），并且该目录下的文件需要在生产环境中被访问时，你**必须**首先检查并更新 `package.json` 文件中的 `build.files` 数组，确保新目录被包含在最终的打包结果中。
- **路径解析**: 在主进程代码中引用项目文件时，应优先使用 `path.join(__dirname, ...)` 的方式来构造路径，以避免在开发环境和生产环境（`asar` 包）之间出现路径解析问题。

## Git 工作流

1.  **分支**: 所有新功能或修复都应在新的 `feature/...` 或 `fix/...` 分支上进行。
2.  **提交信息**: 请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范来编写提交信息，例如：
    - `feat(frontend): 添加新的用户设置选项`
    - `fix(backend): 修复文件扫描中的无限循环问题`
    - `refactor(ipc): 重构IPC错误处理机制`
3.  **Pull Request**: 完成开发后，请提交Pull Request到 `main` 分支，并简要描述你的改动和目的。

通过共同遵守这些约定，我们可以确保这个项目在未来依然是一个“好品味”的、令人愉悦的项目。
