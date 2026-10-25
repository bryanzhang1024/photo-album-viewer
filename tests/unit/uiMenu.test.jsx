import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/ui/App';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 1, directMediaCount: 0 },
  children: [{
    name: '套图',
    ref: { sourceId: 'src_a', relativePath: '套图' },
    status: 'ok',
    facts: { directMediaCount: 0, childDirectoryCount: 0 },
    mtimeMs: 1,
    approximate: { coverSamples: [] }
  }],
  directMedia: [],
  approximate: { coverSamples: [] }
};

let menuHandler = null;
let calls = [];

function installMock() {
  calls = [];
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      calls.push(channel);
      if (channel === 'load-source-roots-v1') return { ok: true, data: { sources: [SOURCE] } };
      if (channel === 'get-directory-level-v1') return { ok: true, data: SNAPSHOT };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      return { ok: true, data: {} };
    }),
    on: jest.fn((channel, handler) => {
      if (channel === 'menu-command') menuHandler = handler;
      return () => { if (menuHandler === handler) menuHandler = null; };
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}

const send = (command) => menuHandler?.({ command });

describe('菜单命令 → 渲染层行为', () => {
  beforeEach(() => {
    window.localStorage.clear();
    menuHandler = null;
    installMock();
  });

  test('新建标签页 / 关闭标签页', async () => {
    render(<App />);
    await screen.findByRole('tablist');
    expect(screen.getAllByRole('tab')).toHaveLength(1);

    send('new-tab');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));

    send('close-tab');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
  });

  test('只剩一个标签时关闭标签 = 关窗口', async () => {
    const closeSpy = jest.spyOn(window, 'close').mockImplementation(() => {});
    render(<App />);
    await screen.findByRole('tablist');

    send('close-tab');
    expect(closeSpy).toHaveBeenCalled();
    closeSpy.mockRestore();
  });

  test('⌘1 网格 / ⌘2 列表 切换当前文件夹视图', async () => {
    const { container } = render(<App />);
    const sidebar = within(screen.getByLabelText('侧栏'));
    await sidebar.findByText('A-库');
    await userEvent.click(sidebar.getByText('A-库').closest('button'));
    await waitFor(() => expect(container.querySelector('.grid-card')).toBeTruthy());

    send('view-list');
    await waitFor(() => expect(container.querySelector('.folder-list-head')).toBeTruthy());

    send('view-grid');
    await waitFor(() => expect(container.querySelector('.grid-card')).toBeTruthy());
  });

  test('聚焦搜索与打开设置', async () => {
    render(<App />);
    const sidebar = within(screen.getByLabelText('侧栏'));
    await sidebar.findByText('A-库');
    await userEvent.click(sidebar.getByText('A-库').closest('button'));

    send('focus-search');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));

    send('open-settings');
    await waitFor(() => expect(calls).toContain('open-settings-window'));
  });

  test('刷新命令会让当前文件夹重新扫描', async () => {
    render(<App />);
    const sidebar = within(screen.getByLabelText('侧栏'));
    await sidebar.findByText('A-库');
    await userEvent.click(sidebar.getByText('A-库').closest('button'));
    await waitFor(() => expect(calls.filter((c) => c === 'get-directory-level-v1').length).toBeGreaterThan(0));
    const before = calls.filter((c) => c === 'get-directory-level-v1').length;

    send('refresh');
    await waitFor(() => expect(calls.filter((c) => c === 'get-directory-level-v1').length).toBeGreaterThan(before));
  });
});
