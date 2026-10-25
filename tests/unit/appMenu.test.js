/** @jest-environment node */

jest.mock('electron', () => ({
  Menu: { buildFromTemplate: jest.fn((template) => ({ template })) }
}));

const { buildAppMenu } = require('../../src/main/services/AppMenu');

function flatten(template) {
  const items = [];
  for (const menu of template) {
    for (const item of menu.submenu || []) {
      items.push({ menu: menu.label, ...item });
    }
  }
  return items;
}

describe('应用菜单', () => {
  test('有关闭标签/关窗口/新标签/新窗口/网格/列表/刷新/搜索/缩放的加速键', () => {
    const send = jest.fn();
    const menu = buildAppMenu({ send });
    const items = flatten(menu.template);

    const byAccel = Object.fromEntries(items.filter((item) => item.accelerator).map((item) => [item.accelerator, item]));
    expect(byAccel['CmdOrCtrl+W'].label).toBe('关闭标签页');
    expect(byAccel['Shift+CmdOrCtrl+W'].label).toBe('关闭窗口');
    expect(byAccel['CmdOrCtrl+T'].label).toBe('新建标签页');
    expect(byAccel['CmdOrCtrl+N'].label).toBe('新建窗口');
    expect(byAccel['CmdOrCtrl+1'].label).toBe('网格显示');
    expect(byAccel['CmdOrCtrl+2'].label).toBe('列表显示');
    expect(byAccel['CmdOrCtrl+R'].label).toBe('刷新当前文件夹');
    expect(byAccel['CmdOrCtrl+F'].label).toBe('聚焦搜索');
    expect(byAccel['CmdOrCtrl+='].label).toBe('放大图片');
    expect(byAccel['CmdOrCtrl+-'].label).toBe('缩小图片');
    expect(byAccel['CmdOrCtrl+0'].label).toBe('实际大小');
  });

  test('不再有系统的关闭窗口/重载/网页缩放项，避免抢键', () => {
    const menu = buildAppMenu({ send: jest.fn() });
    const items = flatten(menu.template);
    const roles = items.map((item) => item.role).filter(Boolean);
    expect(roles).not.toContain('close');
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('resetZoom');
    expect(roles).not.toContain('zoomIn');
    expect(roles).not.toContain('zoomOut');
    // 编辑菜单的复制改成自定义，才能按上下文复制图片文件
    const copy = items.find((item) => item.accelerator === 'CmdOrCtrl+C');
    expect(copy.role).toBeUndefined();
    expect(copy.label).toBe('复制');
  });

  test('点击菜单项会发出对应命令', () => {
    const send = jest.fn();
    const menu = buildAppMenu({ send });
    const items = flatten(menu.template);
    items.find((item) => item.accelerator === 'CmdOrCtrl+W').click();
    items.find((item) => item.accelerator === 'CmdOrCtrl+1').click();
    expect(send).toHaveBeenNthCalledWith(1, 'close-tab');
    expect(send).toHaveBeenNthCalledWith(2, 'view-grid');
  });
});
