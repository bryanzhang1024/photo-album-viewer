import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CosEntityPage from '../../src/ui/features/cos/CosEntityPage';
import CosSetListPage from '../../src/ui/features/cos/CosSetListPage';
import FolderPage from '../../src/ui/features/folder/FolderPage';
import FavoritesPage from '../../src/ui/features/favorites/FavoritesPage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

const EMPTY_DIR = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 0, directMediaCount: 0 },
  children: [],
  directMedia: [],
  approximate: { coverSamples: [] }
};

function installMock(handler) {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, args) => handler(channel, args))
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}

function base(channel) {
  if (channel === 'cos-get-media-thumbnail') return '';
  if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
  if (channel === 'list-directory-files-v1') return { success: true, files: [] };
  if (channel === 'get-directory-level-v1') return { ok: true, data: EMPTY_DIR };
  return { ok: true, data: {} };
}

describe('Cos 各页与空态（R23 / R28）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test('R23 按角色页：总数、角色卡与点击回调', async () => {
    const onOpenEntity = jest.fn();
    installMock((channel) => {
      if (channel === 'cos-list-characters') {
        return {
          items: [{ id: 'c1', name: '克鲁鲁', setCount: 118, coverMediaId: null }],
          total: 1341
        };
      }
      return base(channel);
    });

    render(<CosEntityPage kind="characters" onOpenEntity={onOpenEntity} />);
    expect(await screen.findByText('克鲁鲁')).toBeInTheDocument();
    expect(screen.getAllByText(/1,341 个角色/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByText('克鲁鲁').closest('button'));
    expect(onOpenEntity).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));

    // 封面与套图页一致是 3:4，不能再有 1:1 的 square
    const cover = document.querySelector('.cos-cover');
    expect(cover.className).not.toContain('square');
  });

  test('R23 按署名进套图：主行去掉署名与末尾作品括号，点击带上当前筛选', async () => {
    const onOpenSet = jest.fn();
    installMock((channel) => {
      if (channel === 'cos-list-sets') {
        return {
          items: [{
            id: 's1',
            displayName: '玛吉｜流萤（作品A）',
            characterName: '流萤',
            coserName: '玛吉',
            workName: '作品A',
            imageCount: 8,
            coverMediaId: null
          }],
          total: 1
        };
      }
      return base(channel);
    });

    render(
      <CosSetListPage
        viewKind="cosers"
        entity={{ id: 'coser1', name: '玛吉' }}
        onOpenSet={onOpenSet}
      />
    );
    expect(await screen.findByText('流萤')).toBeInTheDocument();
    expect(screen.getAllByText(/1 套/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByText('流萤').closest('button'));
    expect(onOpenSet).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1' }),
      expect.objectContaining({ sortBy: 'name', coserId: 'coser1' })
    );
  });

  test('R23 空套图列表给出说明而不是空白', async () => {
    installMock((channel) => {
      if (channel === 'cos-list-sets') return { items: [], total: 0 };
      return base(channel);
    });
    render(<CosSetListPage viewKind="all" onOpenSet={jest.fn()} />);
    expect(await screen.findByText('还没有套图')).toBeInTheDocument();
  });

  test('R28 空文件夹有说明', async () => {
    installMock(base);
    render(<FolderPage source={SOURCE} relativePath="" viewMode="grid" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />);
    expect(await screen.findByText('这个文件夹是空的')).toBeInTheDocument();
  });

  test('R28 搜索无结果给出关键词与清除入口', async () => {
    const onSearchChange = jest.fn();
    installMock(base);
    render(
      <FolderPage
        source={SOURCE}
        relativePath=""
        viewMode="list"
        searchQuery="不存在的词"
        onSearchChange={onSearchChange}
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
      />
    );

    expect(await screen.findByText(/没有找到「不存在的词」/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '清除搜索' }));
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  test('R28 空收藏给出可执行提示', async () => {
    installMock(base);
    render(<FavoritesPage />);
    expect(await screen.findByText('还没有收藏文件夹。')).toBeInTheDocument();
    expect(screen.getByText(/卡片上点心形/)).toBeInTheDocument();
  });
});
