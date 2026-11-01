# 4.9.0 多选复制 · 验收证据

2026-11-01：工程与安装验证通过，跨应用日用粘贴待用户测试。

- `clipboard.json`：真实 Electron 27.3.11 主进程 IPC/preload 写系统剪贴板，Chromium 的真实 paste 事件收到三张独立 PNG；名称、顺序和 SHA-256 与原文件一致。包含中文、空格和 XML 特殊字符文件名。控制台有系统 sandbox-extension 提示，未妨碍文件读取与内容校验。
- `built-verification.json` 与 `installed-verification.json`：构建产物和 `/Applications` 安装版各 16/16 项通过。涵盖 ⌘点三张不误开图、框选、取消、Shift 连选、滚动保留与虚拟化、方向键交接、普通单击开图、Cos 分页到第 150 张、相同套图换标签清空、小窗口、排序清空。
- `native-copy.json`：安装版日用图库由 CUA 原生鼠标 Command 点选三张并按 Command+C；AX 状态确认为「已复制 3 张原图」。没有粘贴到外部应用、发送消息或提交生成。自动 CDP 窗口检查不冒充 macOS 原生 accelerator 检查；原生快捷键证据单独保留。
- `built-*.png`、`installed-*.png`：三张高亮、拖框、Cos 多选、720×480 截图，均为隔离测试图片。没有把用户图库截图纳入 Git。

## 工程结果

显式使用本机已有 Node 22.23.2，60 个测试套件、593 条测试全部通过（本轮新增 26 条）；`npm run check:unwired`、`npm run build`、`git diff --check` 通过。Node 26 与旧 mock-fs 不兼容，另有工作树软链接依赖被 mock-fs 隔离的问题；改为 Node 22 和复用依赖的独立目录后全量通过，未改测试依赖或降低断言。完整测试耗时约 102 秒。

构建有既有 bundle 体积提示，并因本机缺 Developer ID 跳过签名，产物成功生成；只交付本机 `.app`，未制作分发安装包。

安装与构建的 `Contents/Resources/app.asar` SHA-256 一致：

`f1a36e5528879e6dbc4131ffb9db017fe13a745e089ec1da420e9f2568dbced3`

## 独立复核与实际修复

独立只读角色依据用户原话复核，发现慢旧复制请求覆盖新选区的问题；先补两条乱序完成回归并确认失败，再由主进程共用请求序号保护批量和单张复制。复核以纯内存模拟全部九种批量/单张文件/单张像素交错组合均通过，未触碰系统剪贴板或用户数据。

真实窗口还发现多选 hook 单独监听方向键时会中途卸载旧导航监听器，jsdom 未暴露该行为。改为在原导航回调内部清空多选并继续导航，浏览器真实事件回归与最后独立复核通过。没有新增 Esc 层级。

测试顺序：先添加批量复制测试并看到缺少 IPC handler 失败；选择 hook 测试在模块缺失时加载失败，随后补实现；两种真实页面的集成测试先因 Command 点击误开大图、菜单复制未接通而失败，再接线修复。没有把 hook 首次加载失败描述为行为断言失败。

## 用户验收

主目标：选三张 JPG/PNG，Banana Gallery 生成页留至少三个参考图位置，焦点移出提示词输入框，⌘V 后核对三张独立缩略图、内容与顺序。只检查粘贴即可，不需提交生成。

Gemini、微信、Finder 分别记录通过/失败/未测；微信检查到待发送预览，不发送消息。当前四个日用目标均未由用户验收，不以 Chromium 接收测试替代。

## 复跑与恢复

在仓库根目录，以 `scripts/agent-tmp` 分配的任务绝对路径设置 `PAV_EVID_TEMP`：

- `PAV_EVID_TEMP=<任务目录> ./node_modules/.bin/electron scripts/evidence-multi-image-clipboard.cjs`
- `PAV_EVID_TEMP=<任务目录> node scripts/evidence-multi-image-copy.mjs`
- 安装版同上，另设 `PAV_APP="/Applications/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer" PAV_EVID_PREFIX=installed`。

旧版 4.8.0 只保留一份恢复副本：`/Volumes/1TB/99-管理/临时/backups/pav-multi-image-copy/Photo Album Viewer 4.8.0.app`，有同目录 manifest；用户确认新版可用后可清理。未触碰图库或个人设置文件；隔离 fixture/profile 已清理。
