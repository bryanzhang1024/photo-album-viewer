# COS 图库 vs 照片来源：网格界面取证（只读）

2026-10-26 采集。构建产物：`dist/mac-arm64/Photo Album Viewer.app`（4.4.1，未构建、未安装）。
窗口默认 1280×800，未改尺寸；`innerWidth=1280 / innerHeight=800 / devicePixelRatio=2`，侧栏宽 216px。
真实图库只读：`/Volumes/1TB/Collection/300-Cos套图库`（9,591 套；该路径是符号链接，realpath 为 `/Volumes/1TB-2/Collection/300-Cos套图库`，应用日志里注册的是 realpath）。

隔离 profile 与测试进程：`/var/folders/xz/j9l_r_g14pjbqfw2rdrrmvwr0000gn/T/pav-cosgrid-cezXfp`（由脚本 mkdtemp），
启动参数 `--user-data-dir=<该目录> --remote-debugging-port=65415`，进程 PID 95854，结束时按 PID 结束，无残留。
COS 索引缓存直接复制自用户 profile（107.7MB），命中有效缓存：应用日志「缓存预热完成，耗时 98ms」，未触发重建。
全程未点击刷新索引 / 添加根目录 / 移除来源 / 收藏，未出现系统对话框。

## 文件

| 文件 | 内容 |
| --- | --- |
| `A-cos-all-1280x800.png` | 侧栏「全部作品」→ COS 套图网格 |
| `B-folder-1280x800.png` | 侧栏「照片来源」→「300-Cos套图库」文件夹网格 |
| `C-cos-set-photos.png` | A 里点第一张套图 → 该套照片网格 |
| `D-folder-photos.png` | B 里搜索同一套 → 该套文件夹照片层 |
| `measurements.json` | 四页 DOM 测量原始数据 + 运行日志与脚本步骤 |

## A：全部作品（COS 网格）

- 页头高 41px，class `page-header page-header-compact page-header-inline`；面包屑 0 段；标题「全部作品」；计数「9,591 套」。
- 页头控件：只有 1 个搜索框（占位「搜索名称、角色、作品」）；无 select / range / icon-button。
- 网格：`.cos-grid`，5 列，computed `grid-template-columns` 5×≈190.8px，gap `16px 14px`，padding 0，clientWidth 1010。
- 卡片：`BUTTON.cos-card`，首卡 190.8×310.8；封面 190.8×254.4，computed aspect-ratio `3 / 4`（实测 0.75），border-radius 7px。
- 文字：名字 12px / 16.2px，margin-top 7px，min-height 32.4px，`rgb(233,233,236)`；次行 11px / normal，margin-top 2px，`rgb(152,152,159)`。
- 差异特征：`.card-heart` 0 个；`.grid-card.selected` 0 个；`.cos-more` 存在（分页加载）；已渲染 60 张、可见 15 张。
- 滚动容器：`.cos-scroll`，scrollHeight 1450 / clientHeight 659。
- 首卡文本：「51酱｜修女」+ 次行「原创写真 · 33 张」。

## B：照片来源「300-Cos套图库」文件夹网格

- 页头高 41px；面包屑 1 段「文件夹」；标题「300-Cos套图库」；计数「9,591 个文件夹」。
- 页头控件（6 个）：面包屑按钮 + 3 个 icon-button（收藏这个文件夹 / 设置 / 排序方向）+ 排序 select（名称/图片/子文件夹/修改日期）+ 缩略图大小 range。
- 网格：`.vg-row`（虚拟网格行，行内直接写列宽），6 列，computed 6×156.664px，column-gap 14px；内层 `.folder-scroll-inner` padding 左右 22px，clientWidth 1010。
- 卡片：`ARTICLE.grid-card`，首卡 156.7×265.3；封面 156.7×208.9（实测 0.75，CSS 未写 aspect-ratio），border-radius 7px。
- 文字：名字 12px / 16.2px，margin-top 7px，min-height 32.4px，`rgb(233,233,236)`；次行 11px / normal，margin-top 2px，`rgb(152,152,159)`。
- 差异特征：`.card-heart` 30 个（每卡一个收藏心）；`.grid-card.selected` 0 个；无 `.cos-more`；已渲染 30 张（5 行可视行）、可见 18 张。
- 滚动容器：`.folder-scroll`（aria-label「文件网格」），scrollHeight 458,751 / clientHeight 659。
- 首卡文本：「51酱｜修女（原创写真）」+ 次行「33 张 · 2026年8月20日」。

同一套「51酱｜修女（原创写真）」在 A 与 B 恰好都是第一张，可直接对比：A 的名字被清理成「51酱｜修女」、次行是「题材 · 张数」；B 的名字保留目录名的「（原创写真）」后缀、次行是「张数 · 目录修改日期」。

## C：COS 套图照片页（A → 第一张套图）

- 页头高 39px，无面包屑；标题「51酱｜修女（原创写真）」；计数「33 张照片」；控件 3 个 icon-button（上一套 / 下一套 / 随机一套），无搜索框。
- 网格 `.cos-grid.photos`，5 列 ×190.8px，gap `16px 14px`，clientWidth 1010。
- 卡片 `BUTTON.cos-card`，190.8×293.8；封面 190.8×254.4；无第二行之外的 meta（只有文件名一行 12px）；`.card-heart` 0 个。
- 滚动容器 `.cos-scroll`，scrollHeight 1175 / clientHeight 661；首卡文本「51酱｜修女（原创写真） 001.jpg」。

## D：同一套的文件夹照片层（B → 搜索后进入）

- 从 C 页头标题派生的搜索候选 `51酱｜修女（原创写真）` 在工具栏搜索框里命中 1 张卡片，点进后确认同一套：页头 41px，面包屑「文件夹 › 300-Cos套图库」，标题「51酱｜修女（原创写真）」。
- 页头控件 10 个：2 个面包屑按钮 + 上一套 / 下一套 + 收藏这个相簿 / 设置 / 完整显示 + 排序 select + 排序方向 + 缩略图大小 range。
- 计数「33 张照片 · 1 个其他文件」；网格 `.vg-row` 6 列 ×156.7px，封面 208.9px，`.card-heart` 30 个，`.folder-scroll` scrollHeight 1737 / clientHeight 659。
- 卡片 `ARTICLE.grid-card`，名字 + 次行「825 KB · 2022年12月7日」；首卡「51酱｜修女（原创写真） 001.jpg」。

## 方法备注

- 截图通过 CDP `Page.captureScreenshot` 取得。Retina 下原始输出是 2560×1600 物理像素，脚本用 `Emulation.setDeviceMetricsOverride` 把 deviceScaleFactor 临时置 1 后输出 1280×800 CSS 像素图，再清除覆盖；窗口尺寸与布局未改。
- 测量用 `Runtime.evaluate` 采集，数据见 `measurements.json`（含每页 viewport / 侧栏 / 页头 / 网格 / 卡片 / 文字样式 / 滚动容器 / 控件明细）。
- 启动时应用按自身逻辑 `app.focus({steal:true})` 抢了一次前台焦点，未触碰用户正在运行的正式应用与其 profile。
