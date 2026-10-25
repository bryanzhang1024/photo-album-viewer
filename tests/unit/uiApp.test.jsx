import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/ui/App';

const SOURCE_A = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const NEW_SOURCE = { sourceId: 'src_new', label: 'new-root', rootPath: '/tmp/new-root' };

const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 2, directMediaCount: 0 },
  children: [],
  directMedia: [],
  approximate: { coverSamples: [] }
};

function installElectronMock({ sources = [SOURCE_A], selected = '/tmp/new-root' } = {}) {
  const calls = [];
  const invoke = jest.fn(async (channel, payload) => {
    calls.push([channel, payload]);
    if (channel === 'load-source-roots-v1') return { ok: true, data: { sources } };
    if (channel === 'get-directory-level-v1') return { ok: true, data: SNAPSHOT };
    if (channel === 'select-directory') return selected;
    if (channel === 'save-source-root-v1') return { ok: true, data: { source: NEW_SOURCE } };
    if (channel === 'remove-source-root-v1') return { ok: true, data: { source: SOURCE_A } };
    return { ok: true, data: {} };
  });
  window.electronAPI = { invoke, platform: 'darwin' };
  return { invoke, calls };
}

describe('App · 标签页与照片来源', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('启动后只有一个标签，点 + 变成两个且标题是当前位置', async () => {
    installElectronMock();
    render(<App />);

    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: '新建标签页' }));

    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getAllByRole('tab')[1]).toHaveTextContent('文件夹');
  });

  function sidebar() {
    return within(screen.getByLabelText('侧栏'));
  }

  test('关闭标签后回到剩下的那个标签，关掉最后一个会留下一个空白标签', async () => {
    installElectronMock();
    render(<App />);
    await screen.findByRole('tablist');

    await userEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: '关闭 文件夹' })[0]);
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: '关闭 文件夹' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  test('打开文件夹：选目录 → 注册来源 → 三选一，选「新标签页」后多一个标签', async () => {
    const { calls } = installElectronMock();
    render(<App />);
    await screen.findByRole('tablist');

    await userEvent.click(sidebar().getByRole('button', { name: '打开文件夹' }));

    const menu = await screen.findByRole('menu', { name: '选择打开方式' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在当前标签页打开' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在新标签页打开' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '在新窗口中打开' })).toBeInTheDocument();

    expect(calls.map(([channel]) => channel)).toEqual(
      expect.arrayContaining(['select-directory', 'save-source-root-v1'])
    );

    await userEvent.click(screen.getByRole('menuitem', { name: '在新标签页打开' }));

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    // 新来源出现在侧栏
    expect(sidebar().getByText('new-root')).toBeInTheDocument();
  });

  test('移除来源：菜单写明不会删磁盘，确认后侧栏少一条且调用移除通道', async () => {
    const { calls } = installElectronMock();
    render(<App />);
    await screen.findByRole('tablist');
    await sidebar().findByText('A-库');

    await userEvent.click(sidebar().getByRole('button', { name: '移除来源 A-库' }));

    const menu = await screen.findByRole('menu', { name: '移除照片来源' });
    expect(menu).toHaveTextContent('不会删除磁盘文件');

    await userEvent.click(screen.getByRole('menuitem', { name: /移除「A-库」/ }));

    await waitFor(() => expect(sidebar().queryByText('A-库')).not.toBeInTheDocument());
    expect(calls.some(([channel, payload]) => (
      channel === 'remove-source-root-v1' && payload.sourceId === 'src_a'
    ))).toBe(true);
  });

  test('前进后退按钮在初始状态下是禁用的', async () => {
    installElectronMock();
    render(<App />);
    await screen.findByRole('tablist');

    expect(screen.getByRole('button', { name: '后退' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '前进' })).toBeDisabled();
  });

  test('⌘, 打开设置、⌘W 关闭标签、⌘↑ 返回上一级都由全局快捷键接管', async () => {
    const { calls } = installElectronMock();
    render(<App />);
    await screen.findByRole('tablist');

    await userEvent.keyboard('{Meta>},{/Meta}');
    expect(calls.some(([channel]) => channel === 'open-settings-window')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    await userEvent.keyboard('{Meta>}w{/Meta}');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  test('输入框里按快捷键不触发导航', async () => {
    installElectronMock();
    render(<App />);
    await screen.findByRole('tablist');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await userEvent.keyboard('{Meta>}w{/Meta}');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    input.remove();
  });
});
