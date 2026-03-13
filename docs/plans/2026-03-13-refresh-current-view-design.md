# Refresh Current View Design

**Context:** BrowserPage 复用 HomePage、AlbumPage、FavoritesPage 承载不同视图。当前“文件夹”页已有 `handleRefresh` 能重扫当前导航层级，但没有可见入口；“相簿”页通过 `useAlbumImages` 暴露了 `refresh`，同样没有 UI 入口。用户只要求在文件夹页和相簿页提供刷新当前内容的按钮，不涉及收藏页。

**Decision:** 采用页内按钮，而不是放到共享标签栏。这样刷新行为天然绑定到当前页的数据源：HomePage 负责重新扫描当前目录层级，AlbumPage 负责重新加载当前相簿图片；FavoritesPage 不显示该按钮。

**UI Placement:** 刷新按钮放在页面顶栏右侧现有操作组内，与排序、密度、随机、收藏等当前页操作并列。这样用户切换到文件夹或相簿时都能在相同区域找到刷新入口，同时不会污染标签栏的全局操作。

**Data Flow:**
- HomePage: 点击按钮后清掉 `navigation` 缓存，再调用 `scanNavigationLevel(currentPath || rootPath)`。
- AlbumPage: 点击按钮后调用 `useAlbumImages().refresh()`，该 Hook 已负责清掉 `album` 缓存并重新拉取图片列表。
- FavoritesPage: 不新增任何刷新入口，维持现状。

**Testing:** 新增两个页级单测。
- HomePage 测试按钮可见，点击后会清空导航缓存并触发当前路径重扫。
- AlbumPage 测试按钮可见，点击后会调用 `useAlbumImages().refresh()`。

**Non-Goals:** 不修改 BrowserPage 标签栏，不新增全局刷新快捷键，不改变收藏页行为。
