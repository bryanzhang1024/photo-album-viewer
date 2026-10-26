# COS 图库 vs 照片来源：网格一致性取证（S1 · 4.4.2）

2026-10-26 更新。`npm run evidence:cos-grid` 自动生成，构建产物与 `/Applications` 安装版各跑过一次，结果一致。

窗口默认 1280×800；隔离 profile，只读访问真实图库 `/Volumes/1TB/Collection/300-Cos套图库`（9,591 套，realpath 为 `/Volumes/1TB-2/...`）。全程不点刷新索引/添加根目录/移除来源/收藏，不碰用户 profile 与正在运行的应用实例。

## 文件

| 文件 | 内容 |
| --- | --- |
| `A-cos-all-1280x800.png` | 侧栏「全部作品」→ COS 套图网格 |
| `B-folder-1280x800.png` | 侧栏「照片来源」→「300-Cos套图库」文件夹网格 |
| `C-cos-set-photos.png` | A 里点第一张套图 → 该套照片网格 |
| `D-folder-photos.png` | B 里搜索同一套 → 该套文件夹照片层 |
| `measurements.json` | 四页 DOM 测量、一致性断言、运行日志 |

## S1 结果：两处网格逐项一致

| 项目 | 统一前（4.4.1） | 统一后（4.4.2） |
| --- | --- | --- |
| 套图列表列数 / 卡宽 | 5 列 / 190.8px | **6 列 / 156.7px** |
| 文件夹网格列数 / 卡宽 | 6 列 / 156.7px | 6 列 / 156.7px |
| 封面高 | 254.4 / 208.9 | **208.9（两边）** |
| 名字 / 次行 | 12px·16.2px / 11px | 两边相同 |
| 卡片元素 | BUTTON / ARTICLE | **ARTICLE（两边）** |
| 套图内照片列数 / 卡宽 | 5 列 / 190.8px | **6 列 / 156.7px** |
| 照片卡次行 | COS 无次行 | 两边都是「825 KB · 2022年12月7日」 |

一致性断言 12/12 通过：A↔B、C↔D 的列数、卡宽、封面高、名字字号行高、次行字号、卡片元素全部相同。

## 仍按计划留到 S2/S3 的差异（脚本不断言，截图可见）

- 页头：COS 页无面包屑、排序、密度；搜索框在页头（文件夹页在工具栏）。
- 收藏心形：COS 卡还没有（B/D 卡片有，悬停显示）。
- 计数文案：COS「9,591 套」vs 文件夹「9,591 个文件夹」；套图页「33 张照片」vs「33 张照片 · 1 个其他文件」（cosset.json 被算作其他文件）。
- 文字规则（有意保留）：COS 套图卡用清理后的名字与「作品 · 张数」，文件夹卡用目录原名与「张数 · 日期」。

## 复跑

```bash
npm run build            # 生成 dist/mac-arm64/…app
npm run evidence:cos-grid
# 验证已安装版本：PAV_APP="/Applications/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer" npm run evidence:cos-grid
```

脚本退出码：0 = 截图与断言全部通过；1 = 有页面测量失败或一致性断言失败。
