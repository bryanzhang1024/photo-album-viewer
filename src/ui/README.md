# src/ui · 4.0 新界面

只放界面层。设计基准是 `.3things/design/design-book.html`（38 屏实时样张）。

## 硬规则（S0 起生效）

1. **组件不直接调 IPC**。所有数据走 `data/` 里的模块，组件只拿结果和错误。
2. **页面只持 UI 状态**（选中、展开、加载中）。数据、缓存、跨页共享状态放 `data/` 或 reducer。
3. **每个标签一份 reducer**（位置、历史、视图、排序），不引 Redux / Zustand。
4. **不写死颜色、字号、间距**，只用 `design/tokens.css` 的变量；新值先进 token。
5. **不 import `src/renderer/` 任何东西**。允许复用 `src/common`、主进程服务、`public/index.html`。
6. **打开方式**：网格单击打开；列表单击选中、双击或回车打开。
7. **验收**：同一窗口尺寸截图，与设计稿对应屏并排比对；对不上算没做完。

## 目录

- `design/`：tokens.css（颜色/尺寸/字号）、base.css（骨架与通用控件）
- `shell/`：工具栏、标签栏、侧栏、页头、状态栏
- `data/`：IPC 封装，一模块一组能力
- `hooks/`：断点等通用逻辑
- `features/`（S1 起）：folder / album / cos / favorites / viewer / settings

## 开发与构建

```bash
npm run start:ui        # 新界面开发模式
npm run build:webpack:ui # 只验证打包
```

默认的 `npm start` / `npm run build` 仍然走旧界面，直到 S7 切换。
