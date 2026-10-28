# 查看器「左键单击逐级放大」4.7.0 · 验收证据

版本：4.7.0 · 分支 `codex/viewer-click-zoom` · 已装 `/Applications/Photo Album Viewer.app` 4.7.0（4.6.0 备份在 `/tmp/pav-backup/Photo Album Viewer 4.6.0.app`）
采集方式：`node scripts/evidence-viewer-click-zoom.mjs`（`npm run evidence:viewer-click-zoom`）启动构建产物，再对安装版跑同一套；隔离 `user-data-dir`，临时生成 2 张 1200×900 的对照图（网格 + 文字 + 色块）并注册成临时来源，用真实 DOM 鼠标事件点查看器；不碰用户图库、真实 profile、收藏与设置。窗口 1280×800，截图用 CDP 固定 `deviceScaleFactor: 1` 采集。

## 真机断言（构建产物与安装版各一遍，均 14/14）

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | 运行版本是 4.7.0（UA 里为 `photo-album-viewer/4.7.0`） | 通过（构建产物与安装版一致） |
| 2 | 临时来源进入后有 2 张图片卡片 | 通过 |
| 3 | 单击图片卡片打开查看器 | 通过 |
| 4 | 打开时缩放 100% | 通过 |
| 5 | 单击一次放大到 120% | 通过（截图 01） |
| 6 | 连点三下累计到 173% | 通过（截图 02） |
| 7 | 拖动 40px 只平移、缩放保持 173%（`translate(40px, 0px) scale(1.728)`） | 通过（截图 03） |
| 8 | 适应窗口复位到 100% 且位置回中 | 通过 |
| 9 | 点右翻页箭头换到下一张，不放大（仍 100%） | 通过（截图 04） |
| 10 | ⌘滚轮向上仍能放大（100% → 110%） | 通过 |
| 11 | 普通滚轮翻页后缩放复位到 100% | 通过 |
| 12 | 长按 320ms 后松开不算单击，不放大 | 通过 |
| 13 | 连点到上限后保持 800% | 通过（截图 05） |
| 14 | 右键关闭查看器（原有行为不变） | 通过 |

报告：[verification.json](verification.json)（构建产物）、[verification-installed.json](verification-installed.json)（安装版）；对应的 `*.app-console.txt` 是两次启动日志，无报错。

## 截图

- `00-viewer-100.jpg`：查看器打开，缩放 100%。
- `01-click-once-120.jpg`：单击一次后 120%，底部工具栏显示 120%。
- `02-click-three-173.jpg`：连点三下后 173%。
- `03-drag-pan-173.jpg`：173% 下拖动 40px，图片向右平移、缩放不变。
- `04-next-arrow-100.jpg`：点右箭头换到 2 / 2，缩放回到 100%。
- `05-max-800.jpg`：连点到上限 800%（画面上方是上一步普通滚轮翻页留下的「已到末尾，已回到第一张」提示，与放大无关）。
- `installed-*.jpg`：安装版 4.7.0 的同一组截图。

## 其它验证

- `npm test`：557 例通过（56 个套件；新增查看器单击/拖动/箭头/上限/长按/＋－ 共 7 例）。
- `npm run check:unwired`：通过（图标 30、IPC 通道 55、设置键 9）。
- `npm run build`：通过；macOS 代码签名仍因本机无有效证书被跳过（与前几版相同，属已知分发风险）。
- 安装：`/Applications/Photo Album Viewer.app` 的 `CFBundleShortVersionString` 为 4.7.0，安装后正常启动（进程在跑）。
- 回滚：`ditto "/tmp/pav-backup/Photo Album Viewer 4.6.0.app" "/Applications/Photo Album Viewer.app"`；该备份在临时目录，重启后可能被系统清理。
