const { Menu } = require('electron');

/**
 * 应用菜单：把快捷键的定义收在一处，并避免 Electron 默认菜单抢键。
 *
 * 默认菜单里的 Close Window(⌘W)、Reload(⌘R)、Zoom(⌘+/-/0)、Copy(⌘C) 会优先于渲染层，
 * 导致查看器的关标签、刷新、图片缩放、复制文件全部收不到事件。这里显式换成应用自己的菜单，
 * 自定义项统一通过 menu-command 发回聚焦窗口，由渲染层按上下文处理。
 */
function buildAppMenu({ send }) {
  const command = (label, accelerator, name, extra = {}) => ({
    label,
    accelerator,
    click: () => send(name),
    ...extra
  });

  const template = [
    {
      label: 'Photo Album Viewer',
      submenu: [
        { role: 'about', label: '关于 Photo Album Viewer' },
        { type: 'separator' },
        command('设置…', 'CmdOrCtrl+,', 'open-settings'),
        { type: 'separator' },
        { role: 'hide', label: '隐藏 Photo Album Viewer' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 Photo Album Viewer' }
      ]
    },
    {
      label: '文件',
      submenu: [
        command('新建标签页', 'CmdOrCtrl+T', 'new-tab'),
        command('新建窗口', 'CmdOrCtrl+N', 'new-window'),
        command('打开文件夹…', 'Shift+CmdOrCtrl+O', 'open-folder'),
        { type: 'separator' },
        command('关闭标签页', 'CmdOrCtrl+W', 'close-tab'),
        command('关闭窗口', 'Shift+CmdOrCtrl+W', 'close-window')
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        // 自定义复制：查看器里复制当前图片文件，其它地方走系统复制
        command('复制', 'CmdOrCtrl+C', 'copy'),
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '显示',
      submenu: [
        command('网格显示', 'CmdOrCtrl+1', 'view-grid'),
        command('列表显示', 'CmdOrCtrl+2', 'view-list'),
        { type: 'separator' },
        command('刷新当前文件夹', 'CmdOrCtrl+R', 'refresh'),
        command('聚焦搜索', 'CmdOrCtrl+F', 'focus-search'),
        { type: 'separator' },
        command('放大图片', 'CmdOrCtrl+=', 'zoom-in'),
        command('缩小图片', 'CmdOrCtrl+-', 'zoom-out'),
        command('实际大小', 'CmdOrCtrl+0', 'zoom-reset'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放窗口' },
        { type: 'separator' },
        { role: 'front', label: '前置全部窗口' }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
