# Changelog

## [3.1.0] - 2026-07-13

- macOS 导航统一绑定到持久化的“电脑”根来源 `/`；文件夹选择、拖入目录、收藏、命令行和新窗口只决定初始位置，不再限制面包屑与返回上级边界。
- “电脑”根视图使用虚拟目录响应且只显示 `Volumes`，不会扫描或暴露其他系统目录；根视图禁用随机浏览，进入 `/Volumes` 后恢复既有浏览能力。
- 现有 v3 标签会话、保存的标签组和 canonical URL 会按绝对路径无损重绑定到电脑根来源；Windows 与 Linux 继续沿用选择目录即 SourceRoot 的既有行为。
- canonical 导航提交前会验证目标目录可用性；目录卸载、不存在或不可读时保留当前标签位置并显示错误提示。

## [3.0.0] - 2026-07-12

- 导航状态切换到 v3 命名空间：`library-sources-v3.json`、`approved-roots-v3.json`、`browser_tabs_session_v3` 与 `browser_tabs_snapshot_v3`；首次启动幂等清理旧来源、授权与 v1/v2 标签状态，同时保留收藏、偏好、照片和缩略图缓存。
- `BrowserLocation` 仅保留 `directory`、`favorites` 与 `landing`；删除绝对路径 location、旧深链恢复、页面级路径迁移和新窗口字符串 payload，所有目录入口必须先注册或唯一匹配 `SourceRoot`。
- canonical URL 直接使用 `browse | photoSet` 视图模式；来源注册失败、收藏无法匹配或来源离线时保持当前位置并提示重新打开来源，不再回退到绝对路径导航。
- Home 与 Album 删除页面级随机袋 fallback；随机浏览仅由 canonical coordinator 使用 `DirectorySnapshot` 当前层直接子目录候选池执行，保持 folder=`browse`、photo-only/hybrid=`photoSet` 和一轮无放回语义。

## [2.8.0] - 2026-07-12

- Home 与 Album 的“随机浏览”统一使用每个标签页独立的无放回队列；同一当前层级候选池在一轮耗尽前不重复，跨页面切换继续消费该标签页的剩余队列，且随机状态不写入 session 或 snapshot。
- 随机候选只来自当前层级的直接子目录，不做递归发现；纯 folder 候选进入 `browse`，photo-only 与 hybrid 候选进入 `photoSet`。
- 页面搜索和显示排序仅改变当前展示，不重建 canonical 候选池或重置剩余随机队列。
- 候选在抽取后若已不存在、不再是目录或视图能力已变化，仅重扫当前父层一次并改选其他候选；其他错误直接报告，不做额外重试。
- 网格工具栏文案统一为“随机浏览”，网格页由 E 触发随机浏览、R 触发刷新；ImageViewer 打开时接管按键，E 向右旋转、R 随机切换图片，不触发页面级操作。

## [2.7.0] - 2026-07-12

- 新增持久化 `SourceRoot` 注册表与版本化 IPC，为照片来源分配稳定 `sourceId`；使用既有 `sourceId` 重新关联根路径时，canonical 导航目标身份保持不变。
- 浏览标签页改用 `sourceId`、portable relative path 与视图模式组成的 canonical location；session/snapshot 仅写入 v2，v1 数据仅作为只读迁移回退且不会被改写。
- renderer 启动入口改用 `HashRouter`，修复生产打包窗口从文件 URL 启动 canonical 路由时的 bootstrap 问题。
- Home 与 Album 的面包屑和“返回上级”导航限定在当前 `SourceRoot` 边界内，并沿用 canonical 导航目标。
- 完善 POSIX、Windows drive 与 UNC 路径的规范化、匹配和 portable relative path 转换，保持跨平台来源与标签页定位一致。
- 保留现有 `SCAN_NAVIGATION_LEVEL`、`GET_ALBUM_IMAGES` 内容扫描链路与授权行为；Phase 2 renderer 不调用 `GET_DIRECTORY_LEVEL_V1`。

## [2.6.0] - 2026-07-11

- 新增 `DirectorySnapshot v1` 共享契约、三值目录能力投影和跨平台 `DirectoryRef` 路径校验。
- 新增独立 canonical 单层目录扫描服务，明确 exact/partial、empty、missing 与 unreadable 语义，不再从 legacy DTO 反推事实。
- 新增 versioned `GET_DIRECTORY_LEVEL_V1` IPC 与 preload allowlist；现有 renderer、`SCAN_NAVIGATION_LEVEL`、route 和用户可见行为保持不变。

## [2.5.14] - 2026-07-11

- 将“目录事实、能力与导航意图分离”的 ADR 和 Phase 0 实施计划纳入版本控制，明确后续渐进迁移边界。
- 新增目录 legacy DTO、相簿图片双形状 IPC、页面级随机袋生命周期及 v1 session/favorites 数据形状的 characterization tests；本版本不改变运行时行为。

## [2.5.13] - 2026-07-03

- 修复相簿刷新未清除主进程 `albumImageMetadataCache` 的问题：刷新时传 `forceRefresh`，确保重新读取磁盘上的图片列表。
- HomePage 文件夹扫描增加 generation 计数，避免并发扫描时旧结果覆盖新刷新。

## [2.5.12] - 2026-07-03

- hybrid 套图（根目录有图且含子文件夹，如「自拍」）改为主点击与相邻导航默认进入套图视图，恢复 ←/→ 连续浏览。
- 相邻相簿列表找不到当前路径时清空 prev/next，避免沿用上一个套图的导航状态。

## [2.5.11] - 2026-07-03

- 抽取 `compareByFolderSort`，HomePage 网格与相邻相簿导航共用同一套比较逻辑（含 path tie-breaker）。

## [2.5.10] - 2026-07-03

- 统一文件夹排序 scopeKey：HomePage 在 `currentPath` 为空时回退到 `rootPath`，与相邻相簿导航和随机相簿使用同一套键。

## [2.5.9] - 2026-07-03

- 修复相簿页 Ctrl+← / Ctrl+→ 只走一步的问题，现正确跳转到同级第一个/最后一个相簿。

## [2.5.8] - 2026-07-03

- 修复相邻相簿导航与父文件夹网格排序不一致的问题：抽取共享 `sortPreference` 工具，非根目录不再误读 legacy 全局倒序。

## [2.5.7] - 2026-07-03

- `npm run build` 默认只生成 `.app`（`electron-builder --dir`），跳过 DMG、ZIP、blockmap。
- 新增 `build:release` / `build:electron:release` 用于完整分发打包；`build:app` 保留为 `build` 别名。
- `AGENTS.md` 构建验证规则同步：`build` 为默认，`build:release` 仅在用户明确要求分发产物时使用。

## [2.5.6] - 2026-07-03

- 随机浏览改为口袋式洗牌：进入目录/相簿/查看器时生成打乱队列，逐个消耗，耗尽后自动重洗可循环。
- 网格页快捷键：E 随机、R 刷新；ImageViewer 随机仍用 R，E 保持向右旋转。

## [2.5.5] - 2026-07-03

- 修复 HomePage「取消收藏当前照片集合」在已收藏但当前无直接图片时无法点击的问题。
- `toggleAlbumFavorite` 取消收藏时按 `kind` 精确匹配，避免与同名路径文件夹收藏互相影响。
- GridPageToolbar 改为单一右对齐工具组，刷新按钮移至最左（工具组内首位）。

## [2.5.4] - 2026-07-03

- 抽取 `GridPageToolbar` 共用组件，重构 HomePage 与 AlbumPage 网格浏览顶栏。
- 搜索改为图标触发 Overlay 浮层；密度与随机选相簿收进「视图选项」Tune Popover。
- 收藏操作合并为单菜单（文件夹/照片集/打开收藏页）；AlbumPage 补齐设置入口；收藏与设置贴右固定。

## [2.5.3] - 2026-07-02

- 抽取 `useGridThumbnailPrefetch` hook，统一 Virtuoso 网格的缩略图批量预取逻辑。
- AlbumPage、HomePage、FavoritesPage（相簿/图片双 tab）接入 `rangeChanged` 预取，与相簿页行为对齐。

## [2.5.2] - 2026-07-02

- 子目录扫描改为并发池限流（默认 5，可随性能设置调整），避免 200+ 同级目录时磁盘 I/O 风暴。
- 新增 `SCAN_NAVIGATION_PROGRESS` 事件，HomePage 在扫描过程中显示进度条与「已扫描 / 总数」。
- 扫描进行中保留当前目录内容可见，不再用全页 Spinner 覆盖列表。

## [2.5.1] - 2026-07-02

- 相簿图片列表改为分页加载，默认每页 200 张；滚动到底或查看器接近末尾时自动加载下一页。
- 主进程新增 `getAlbumImagesPage` 与 `getAlbumImageCount`，排序与搜索在服务端完成后再分页返回。
- 图片查看器在仍有未加载图片时，末尾翻页不再跳回第一张，而是触发加载更多。
- 收藏页判断相册/文件夹类型时改用轻量 count 接口，避免拉取全量图片列表。

## [2.5.0] - 2026-07-02

- 用“物理事实 / 能力 / 视图 / 导航序列”四层模型取代 `folder|album` 二分，同一目录可同时以浏览视图和看图视图进入。
- hybrid 目录（既有直接图片又有子文件夹）主点击默认进入浏览视图，子目录与直接图片可同时展示，不再丢失子文件夹。
- 新增 `nodeModel` 工具层统一派生 `canViewAsPhotoSet`、`canBrowseChildren`、`getPrimaryView` 等能力字段，前后端路由与相邻套图导航改读能力而非单一 `type`。
- hybrid 卡片新增“查看直接图片”次级入口；看图视图在有子目录时展示“进入浏览”入口。
- 移除废弃的 `SCAN_DIRECTORY` IPC 通道与 `scanDirectories` 兼容扫描路径，面包屑导航改走 `SCAN_NAVIGATION_LEVEL`。

## [2.4.3] - 2026-06-28

- 修复含直接图片和子文件夹的混合套图被识别为普通文件夹的问题，使其可参与相册列表、随机相册和上一套/下一套导航。
- 为混合套图卡片新增子文件夹入口，保留进入“自拍”等子目录的路径，同时相册页继续只浏览当前目录直接图片。

## [2.4.2] - 2026-06-28

- 补强项目交付规则，明确用户计划中的 Test Plan 不得弱化项目构建验证要求。
- 明确完成代码、配置或文档改动后默认在最终交付前创建本地 commit。

## [2.4.1] - 2026-06-28

- 修复双页展示从后一组回退时可能落到重叠页组的问题，避免 `12 -> 34 -> 23`。
- 补强双页回退分页规则单元测试。

## [2.4.0] - 2026-06-22

- 在设置页新增“默认启用双页展示”选项，打开后图片查看器每次进入时默认启用双页模式。
- 图片查看器保留右上角双页按钮，用于临时切换当前查看会话的展示方式。

## [2.3.3] - 2026-06-22

- 补强 `AGENTS.md` 构建验证规则，明确已合并且需要通过安装包使用的可视功能或修复必须运行 `npm run build`。

## [2.3.2] - 2026-06-22

- 调整图片查看器双页展示布局，移除两页之间的固定间距，并让左页右对齐、右页左对齐以贴近中线展示。

## [2.3.1] - 2026-06-22

- 在 `AGENTS.md` 增加构建验证规则，明确何时运行 `npm run build:webpack` 和 `npm run build`，以及 `dist/` 产物和 macOS 签名提示的处理方式。

## [2.3.0] - 2026-06-22

- 在图片查看器新增双页展示模式按钮，支持在当前图片和下一张图片能按满高比例并排放下时同时展示两张。
- 双页模式下翻页按当前展示组跳转，保持不适合并排的图片单独展示。
- 新增双页展示分页规则单元测试。

## [2.2.2] - 2026-06-22

- 在 `AGENTS.md` 增加个人项目分支管理规则，明确 `main`、`codex/<task-slug>`、任务开始、合并、远端同步和分支收尾的默认流程。

## [2.2.1] - 2026-05-19

- 点击首页和相簿页右上角“我的收藏”时，改为自动新建并激活收藏标签页，不再复用当前标签页。
- 新增浏览页单元测试，覆盖从首页和相簿页打开收藏时保留原标签的行为。

## [2.2.0] - 2026-05-19

- 在图片查看器右上角新增删除按钮，支持 `Delete` 快捷键打开删除确认界面。
- 删除采用移到系统废纸篓，并在确认界面展示操作类型、影响范围和完整图片路径。
- 删除成功后同步更新相簿页、首页直接图片列表和收藏图片列表，避免保留失效图片项。
- 新增主进程删除 IPC、查看器删除流程、相簿图片状态和收藏清理相关测试。

## [2.1.0] - 2026-05-19

- 在图片查看器右上角新增图片信息按钮，支持通过 `i` 快捷键打开或关闭。
- 新增右侧图片信息面板，展示文件名、分辨率、文件大小、所在目录、完整路径、修改时间和当前序号。
- 增加 `ImageViewer` 单元测试，覆盖按钮、快捷键、基础信息展示、分辨率展示和 `Escape` 优先关闭信息面板行为。
