# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 提供本仓库的开发指导。

## 项目概述

中文桌面照片相簿浏览器，基于 Electron + React 构建。可穿透多层文件夹结构，自动识别包含图片的最深层文件夹作为"相簿"。支持懒加载、缩略图生成与缓存、收藏系统等功能。

## 架构设计

**主进程** (`src/main/main.js`): Electron 后端，处理文件系统操作、通过 Sharp 生成缩略图、WebP 格式缓存、IPC 通信等。

**渲染进程** (`src/renderer/`): React 前端，使用 Material-UI 组件库，通过 React Router 导航：
- HomePage: 相簿网格视图
- AlbumPage: 单个相簿图片查看器
- FavoritesPage: 收藏的相簿/图片
- TestPage: 开发调试页面

## 核心技术栈

- **Electron**: 桌面应用框架
- **React 18**: 用户界面框架
- **Material-UI**: 组件库
- **Sharp**: 图片处理库（缩略图生成）
- **React Router**: 路由导航
- **Webpack**: 构建系统（支持热重载）

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式（启动 webpack dev server + electron）
npm start

# 生产环境构建
npm run build

# 仅构建 webpack
npm run build:webpack

# 仅构建 electron
npm run build:electron
```

## 核心功能与实现

**缩略图系统**: 使用 Sharp 生成 WebP 格式缩略图，缓存在 `userData/thumbnail-cache/` 目录，通过本地 HTTP 服务器（随机端口）提供服务。支持并发处理和队列系统。

**文件夹扫描**: 递归扫描目录，将包含图片但没有子目录的最深层文件夹识别为"相簿"。仅加载前4张图片作为预览。

**性能优化**: 懒加载、可配置的并发缩略图生成、WebP 缓存、大数据量虚拟列表。

**收藏系统**: 持久化存储在 `userData/favorites.json`，支持相簿、图片、收藏夹管理。

**IPC 接口**: 主进程提供目录选择、扫描、缩略图生成、收藏管理、缓存操作等处理器。

## 文件结构

```
src/
├── main/main.js          # Electron 主进程
└── renderer/
    ├── App.js           # React 根组件
    ├── pages/           # 页面路由组件
    ├── components/      # 可复用 UI 组件
    └── contexts/        # React 上下文（收藏、滚动位置）
```

## 常见开发任务

- **新增 IPC 处理器**: 在 main.js 中定义，渲染进程通过 `ipcRenderer.invoke()` 调用
- **添加路由页面**: 在 App.js 中添加路由，在 pages/ 目录创建页面组件
- **主题定制**: 修改 App.js:47 处的主题对象
- **性能调优**: 调整 main.js:24-30 处的性能设置