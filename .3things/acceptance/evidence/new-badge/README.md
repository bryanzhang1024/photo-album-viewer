# 套图卡「新」角标 4.8.0 · 验收证据

版本：4.8.0 · 分支 `codex/new-badge` · 已装 `/Applications/Photo Album Viewer.app` 4.8.0（4.7.0 备份在 `/tmp/pav-backup/Photo Album Viewer 4.7.0.app`）
采集方式：`node scripts/evidence-new-badge.mjs`（`npm run evidence:new-badge`）启动构建产物，再对安装版跑同一套；隔离 `user-data-dir`，只把真实 Cos 索引缓存与根目录配置**复制**到隔离 profile，图库只读、不刷新索引、不收藏、不改真实 profile。窗口 1280×800，截图用 CDP 固定 `deviceScaleFactor: 1`。
路径：侧栏「Cos 图库」→「按署名」→ G44不会受伤 → 排序切「修改日期」（控件自动置为降序）。

## 真机断言（构建产物与安装版各一遍，均 6/6）

| # | 断言 | 结果 |
| --- | --- | --- |
| 1 | 数据面：G44 191 套按修改日期降序，最近 7 天的集中在最前（`recentCount`=23、`firstOldIndex`=23） | 通过 |
| 2 | 数据面：第一张是今天动过的套图（1 天内） | 通过 |
| 3 | 界面面：排序控件为「修改日期」且为降序 | 通过 |
| 4 | 界面面：第一张套图卡带「新」角标 | 通过（截图） |
| 5 | 界面面：可见 30 张卡里带「新」的 23 张，与数据面 7 天内套数一致 | 通过 |
| 6 | 界面面：带「新」的卡按顺序就是数据面前 23 套，从第 24 张起不带标（第 24 套是 10-08 的「芙洛伦·春节」） | 通过 |

报告：[verification.json](verification.json)（构建产物）、[verification-installed.json](verification-installed.json)（安装版）；对应 `*.app-console.txt` 为两次启动日志。

## 截图

- `A-g44-sets-new-badge-1280x800.png`：构建产物。G44 191 套，排序「修改日期」降序，前两行 12 张卡封面左上角都是蓝色「新」。
- `installed-A-g44-sets-new-badge-1280x800.png`：安装版 4.8.0 同一路径、同一结果。

## 口径与实测

- 角标判定 = 套图目录修改时间在最近 7 天内，与 4.6.0「最近有变化」同一时间窗；索引里 G44 在 7 天内被动的正好 23 套（22 套本次新入库 + 1 套今日改名「乖乖兽·诺亚」），第 24 套起落到 10-08，边界清晰。
- 采集期间看到「紫乃」目录时间在 14:48 被刷新（另一个会话删了套内广告文件），它因此从列表第二张升到第一张并带标——这就是「修改日期 ≠ 首次入库」的具体表现，已在 CHANGELOG 与计划里写明。

## 其它验证

- `npm test`：567 例通过（57 个套件；新增 10 例 = 9 条角标判定 + 1 条列表渲染）。首次全量跑时 `uiCoverage.test.jsx` 因读取 babel 配置瞬时失败，单独跑与全量重跑都通过，属偶发。
- `npm run check:unwired`：通过（图标 30、IPC 通道 55、设置键 9）。
- `npm run build`：通过；macOS 代码签名仍因本机无有效证书被跳过（与前几版相同，属已知分发风险）。
- 安装：`/Applications/Photo Album Viewer.app` 的 `CFBundleShortVersionString` 为 4.8.0，安装后正常启动（进程在跑）。
- 回滚：`ditto "/tmp/pav-backup/Photo Album Viewer 4.7.0.app" "/Applications/Photo Album Viewer.app"`；该备份在临时目录，重启后可能被系统清理。
