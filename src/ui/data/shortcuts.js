/**
 * 快捷键单一事实源：状态栏、设置页的帮助表、以及测试都从这里取，
 * 避免「状态栏写一套、实现另一套」。
 */
export const SHORTCUTS = {
  back: { keys: '⌘[', label: '后退' },
  forward: { keys: '⌘]', label: '前进' },
  up: { keys: '⌘↑', label: '上一级' },
  search: { keys: '⌘F', label: '搜索' },
  gridView: { keys: '⌘1', label: '网格' },
  listView: { keys: '⌘2', label: '列表' },
  reload: { keys: '⌘R', label: '刷新' },
  settings: { keys: '⌘,', label: '设置' },
  closeTab: { keys: '⌘W', label: '关闭标签' },
  newTab: { keys: '⌘T', label: '新建标签' },
  newWindow: { keys: '⌘N', label: '新建窗口' },
  prevTab: { keys: '⇧⌘[', label: '上个标签' },

  openFolder: { keys: '⇧⌘O', label: '打开文件夹' },

  moveSelection: { keys: '↑ ↓', label: '移动选中' },
  jumpEnds: { keys: 'Home / End', label: '首尾' },
  openSelected: { keys: 'Enter', label: '打开' },
  clearSelection: { keys: 'Esc', label: '取消选中' },
  favorite: { keys: 'C', label: '收藏' },
  reveal: { keys: 'O', label: '在 Finder 显示' },
  trash: { keys: 'Delete', label: '移到废纸篓' },

  viewerClose: { keys: 'Esc / ⌫', label: '关闭' },
  viewerPrev: { keys: '← / A', label: '上一张' },
  viewerNext: { keys: '→ / D', label: '下一张' },
  viewerZoom: { keys: '⌘+ / ⌘− / ⌘0', label: '缩放' },
  viewerRotate: { keys: 'E / Q', label: '右旋 / 左旋' },
  viewerRandom: { keys: 'R', label: '随机一张' },
  viewerDual: { keys: 'V', label: '双页' },
  viewerFullscreen: { keys: 'F', label: '全屏' },
  viewerInfo: { keys: 'I', label: '信息面板' },
  viewerToolbar: { keys: 'T', label: '显示/隐藏底栏' },
  viewerFavorite: { keys: 'C', label: '收藏' },
  viewerReveal: { keys: 'O', label: '在 Finder 显示' },
  viewerTrash: { keys: 'Delete', label: '移到废纸篓' },
  viewerCopy: { keys: '⌘C / ⇧⌘C', label: '复制文件 / 像素' }
};

/** 每个页面状态栏显示哪些键（只列本页真的能用的）。 */
const SCOPE_KEYS = {
  folder: ['back', 'forward', 'up', 'search', 'gridView', 'listView', 'reload', 'settings', 'closeTab'],
  roots: ['back', 'forward', 'newTab', 'settings', 'closeTab'],
  favorites: ['back', 'forward', 'settings', 'closeTab'],
  cos: ['back', 'forward', 'settings', 'closeTab'],
  cosSearch: ['back', 'forward', 'search', 'reload', 'settings', 'closeTab'],
  viewer: ['viewerClose', 'viewerPrev', 'viewerNext', 'viewerCopy']
};

export function statusHint(scope) {
  const keys = SCOPE_KEYS[scope] || SCOPE_KEYS.folder;
  return keys.map((id) => `${SHORTCUTS[id].keys} ${SHORTCUTS[id].label}`).join('　');
}

/** 设置页「快捷键」帮助分组。 */
export const HELP_GROUPS = [
  {
    title: '浏览与标签',
    ids: ['back', 'forward', 'up', 'search', 'gridView', 'listView', 'reload', 'newTab', 'newWindow', 'closeTab', 'prevTab', 'settings']
  },
  {
    title: '文件夹列表',
    ids: ['moveSelection', 'jumpEnds', 'openSelected', 'clearSelection', 'favorite', 'reveal', 'trash', 'openFolder']
  },
  {
    title: '大图查看器',
    ids: ['viewerClose', 'viewerPrev', 'viewerNext', 'viewerZoom', 'viewerRotate', 'viewerRandom', 'viewerDual', 'viewerFullscreen', 'viewerInfo', 'viewerToolbar', 'viewerFavorite', 'viewerReveal', 'viewerTrash', 'viewerCopy']
  }
];

export function helpRowsFor(group) {
  return group.ids.map((id) => SHORTCUTS[id]);
}
