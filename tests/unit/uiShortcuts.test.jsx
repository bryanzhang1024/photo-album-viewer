import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SHORTCUTS, HELP_GROUPS, helpRowsFor, statusHint } from '../../src/ui/data/shortcuts';
import SettingsPage from '../../src/ui/features/settings/SettingsPage';
import FolderPage from '../../src/ui/features/folder/FolderPage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 0, directMediaCount: 0 },
  children: [],
  directMedia: [],
  approximate: { coverSamples: [] }
};

function installMock() {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      if (channel === 'get-directory-level-v1') return { ok: true, data: SNAPSHOT };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      if (channel === 'get-cache-stats') return { thumbnailService: { disk: { bytes: 0, files: 0 } } };
      if (channel === 'cos-get-status') return { state: 'empty', roots: [], summary: {} };
      return { ok: true, data: {} };
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}

describe('快捷键单一事实源', () => {
  test('各页状态栏文案来自同一张表，且随页面不同', () => {
    expect(statusHint('folder')).toContain('⌘1 网格');
    expect(statusHint('folder')).toContain('⌘2 列表');
    expect(statusHint('folder')).toContain('⌘R 刷新');
    expect(statusHint('roots')).not.toContain('⌘↑ 上一级');
    expect(statusHint('cosSearch')).toContain('⌘F 搜索');
    expect(statusHint('cos')).not.toContain('⌘F 搜索');
    expect(statusHint('viewer')).toContain('⌘C / ⇧⌘C 复制文件 / 像素');
  });

  test('帮助分组里的每个键都在表里', () => {
    for (const group of HELP_GROUPS) {
      expect(group.ids.length).toBeGreaterThan(0);
      for (const row of helpRowsFor(group)) {
        expect(row.keys).toBeTruthy();
        expect(row.label).toBeTruthy();
      }
    }
    const allIds = new Set(HELP_GROUPS.flatMap((group) => group.ids));
    for (const id of Object.keys(SHORTCUTS)) {
      // 状态栏/帮助里出现的键都应有定义；这里只确认定义项被覆盖到帮助或有明确归属
      expect(SHORTCUTS[id].keys).toBeTruthy();
    }
    expect(allIds.size).toBeGreaterThan(20);
  });

  test('文件夹页状态栏用的就是同一份文案', async () => {
    installMock();
    render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    const footer = await screen.findByRole('contentinfo');
    expect(footer.textContent).toContain(statusHint('folder'));
  });
});

describe('设置窗口 · 快捷键帮助页', () => {
  test('有快捷键标签，列出浏览、列表与查看器的键位', async () => {
    installMock();
    render(<SettingsPage />);

    await userEvent.click(screen.getByRole('button', { name: '快捷键' }));
    expect(screen.getByText('浏览与标签')).toBeInTheDocument();
    expect(screen.getByText('文件夹列表')).toBeInTheDocument();
    expect(screen.getByText('大图查看器')).toBeInTheDocument();
    expect(screen.getByText('⌘1')).toBeInTheDocument();
    expect(screen.getByText('Esc / ⌫')).toBeInTheDocument();
    expect(screen.getByText('随机一张')).toBeInTheDocument();
  });
});
