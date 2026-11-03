# 标签页滚动位置 · 4.9.1 验收

2026-11-04，Mac Studio。本轮原话与实施批准见 `../../2026-10-26-user-voice.md` 的当日追加及 `../../../plan-tab-scroll.md`。

## 结果

- 601/601 测试（61 个测试集），项目现有 Node 22.23.2；`npm run check:unwired` 与 `git diff --check` 通过。
- `npm run build` 完整通过，生成 arm64 `.app`；已安装到 `/Applications/Photo Album Viewer.app`，Info.plist 与构建产物版本均 4.9.1，app.asar SHA-256 一致。未制作 DMG/ZIP，未 push。
- 旧安装版 4.9.0 的真实窗口对照：9 项中仅 2 项通过、7 项失败，见 `baseline-verification.json`。修复后的构建版与安装版分别 9/9 通过，见 `built-verification.json`、`installed-verification.json`。
- 日用 profile 正常启动后，原 12 个标签完整保留；CUA 原生滚动「P图用模特」→ 切「P图用照片」→ 切回，前后 28 条虚拟可视照片记录完全一致；已恢复原当前标签「我的收藏」。见 `daily-app-verification.json`。
- 同尺寸 1280×900 对照图：`built-folder-a-before.png` / `built-folder-a-after.png`，`built-cos-list-before.png` / `built-cos-list-after.png`；安装版同名图以 `installed-` 开头。已读图检查文件夹前后可见文件与布局一致。

## 根因与修复

App 只保存标签导航历史，未持有各标签的滚动快照：不同目录切换会销毁滚动节点，同目录标签又复用同一实例。两条 COS 分页链路重新挂载只取第一批，恢复较深滚动距离会被短内容截断。

App 按标签、页面、搜索结果集保存内存快照；激活内容按此范围重新挂载。共用 hook 记住锚点、行内偏移与已加载数量，在数据和尺寸准备后恢复真实 DOM 的 scrollTop 并同步虚拟可视行。COS 先请求旧范围，受照片 IPC 的 1000 张上限截断时继续补页。关闭标签释放记忆；搜索词随页面保留以对应原内容。不写图库和数据库，不保存重启后的滚动位置。

同类路径检查覆盖 VirtualGrid、FolderList、useCosPagedList（署名/角色/套图）和 CosSetAlbumPage 独立照片分页，均接入；不是只修一种网格。非虚拟的收藏/总览页滚动不在本轮已批准范围与通过断言内，不宣称覆盖。

## 回归证据

`tests/unit/uiTabScroll.test.jsx` 新增 8 项：同目录独立位置、鼠标和 ⇧⌘]、不同目录列表及可见行、COS 多页、受服务端页大小限制的补页、搜索结果、锚点删除、套内照片多页与超过 1000 张。最初 5 项对旧代码全部失败；独立照片分页补例在修复前失败；页大小受限补例在补页处理前失败。日志保留在任务临时目录的 `red-tests.txt`、`album-red-tests.txt`、`capped-page-red.txt`；当前 8 项全部通过，全量结果见同目录 `all-tests-final.txt`。

真实窗口脚本 `scripts/evidence-tab-scroll.mjs` 用隔离 profile，只复制日用 COS 索引、来源与根配置；真实图库只读，普通文件夹使用临时照片。经真实 Electron IPC 读取，真实鼠标滚轮、标签点击与快捷键切换；退出清理隔离 profile 和临时照片，不修改日用 profile。脚本在最后一项统一以失败退出码报告任何失败，旧版对照确实非零退出。

可重复运行：

```sh
PAV_EVID_TEMP='/Volumes/1TB/99-管理/临时/tasks/pav-tab-scroll-position' node scripts/evidence-tab-scroll.mjs
PAV_APP='/Applications/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer' PAV_EVID_PREFIX=installed PAV_EVID_TEMP='/Volumes/1TB/99-管理/临时/tasks/pav-tab-scroll-position' node scripts/evidence-tab-scroll.mjs
```

## 环境与交付边界

最初全量测试在 Node 26 下因 mock-fs 不兼容失败；Node 22 下依赖符号链接又使 mock-fs 隔离树无法读取 sharp。改用项目已有 Node 22 和原依赖的完整本地副本后，601 项全部通过；没有改测试、降级验收或新增依赖。现有 React act、baseline-browser-mapping 提示仍在测试日志内。

构建保留既有 bundle 体积警告，缺少 Developer ID 证书时跳过签名；本机运行检查通过，未宣称完成签名分发。

旧 4.9.0 的单一应用恢复副本位于 `/Volumes/1TB/99-管理/临时/backups/pav-tab-scroll-position/`，manifest 记录安装主机、版本与保留条件；用户确认新版可用后清理。恢复仅替换 .app，不触碰图库与用户数据。主目录另一任务的两份在途文档保持原样，代码在独立功能分支提交，不合入脏的 main，不 push。
