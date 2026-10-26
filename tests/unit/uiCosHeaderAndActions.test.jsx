import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import CosSetListPage from '../../src/ui/features/cos/CosSetListPage';
import CosSetAlbumPage from '../../src/ui/features/cos/CosSetAlbumPage';

const SET = {
  id: 's1',
  displayName: '流萤（作品A）',
  imageCount: 8,
  coverMediaId: null,
  favoriteTargets: [{ path: '/300/流萤（作品A）', online: true, previewImagePath: '/300/流萤（作品A）/001.jpg' }]
};

const IMAGE = {
  path: '/300/流萤（作品A）/001.jpg',
  name: '001.jpg',
  size: 844800,
  lastModified: new Date(2022, 11, 7)
};

function installMock(handler) {
  const calls = [];
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, ...args) => {
      calls.push([channel, ...args]);
      return handler(channel, ...args);
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  return { calls };
}

function base(channel) {
  if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
  if (channel === 'save-favorites') return { success: true };
  if (channel === 'cos-show-set-in-folder') return { success: true };
  if (channel === 'get-thumbnail') return null;
  return { ok: true, data: {} };
}

describe('Cos 页头与操作（S2/S3）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test('套图列表页头有面包屑、排序、密度与设置；点面包屑回到 Cos 总览', async () => {
    installMock((channel) => {
      if (channel === 'cos-list-sets') return { items: [SET], total: 1 };
      return base(channel);
    });
    const onNavigate = jest.fn();
    render(<CosSetListPage viewKind="all" onOpenSet={jest.fn()} onNavigate={onNavigate} />);

    await screen.findByText('流萤');
    expect(screen.getByRole('button', { name: 'Cos 图库' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '排序' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '缩略图大小' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cos 图库' }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'cos-home' });
  });

  test('套图卡收藏心形写入同一份收藏（按套图目录路径）', async () => {
    const { calls } = installMock((channel) => {
      if (channel === 'cos-list-sets') return { items: [SET], total: 1 };
      return base(channel);
    });
    const { container } = render(<CosSetListPage viewKind="all" onOpenSet={jest.fn()} />);

    await screen.findByText('流萤');
    const card = container.querySelector('.grid-card');
    await userEvent.click(within(card).getByRole('button', { name: '收藏' }));

    await waitFor(() => {
      const save = calls.find(([channel]) => channel === 'save-favorites');
      expect(save).toBeTruthy();
      expect(save[1].albums.map((item) => item.path)).toContain('/300/流萤（作品A）');
    });
  });

  test('右键菜单：打开 / 新标签 / 收藏 / Finder', async () => {
    const { calls } = installMock((channel) => {
      if (channel === 'cos-list-sets') return { items: [SET], total: 1 };
      return base(channel);
    });
    const { container } = render(<CosSetListPage viewKind="all" onOpenSet={jest.fn()} />);

    await screen.findByText('流萤');
    fireEvent.contextMenu(container.querySelector('.grid-card'));

    const menu = await screen.findByRole('menu', { name: '套图菜单' });
    expect(within(menu).getByRole('menuitem', { name: '打开' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '在新标签页打开' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '添加到收藏' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: '在 Finder 中显示' }));
    await waitFor(() => {
      expect(calls.some(([channel]) => channel === 'cos-show-set-in-folder')).toBe(true);
    });
  });

  test('键盘导航：方向键选中、Enter 打开', async () => {
    installMock((channel) => {
      if (channel === 'cos-list-sets') return { items: [SET], total: 1 };
      return base(channel);
    });
    const onOpenSet = jest.fn();
    const { container } = render(<CosSetListPage viewKind="all" onOpenSet={onOpenSet} />);

    await screen.findByText('流萤');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(container.querySelector('.grid-card.selected')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpenSet).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), expect.any(Object));
  });

  test('⌘R（pav:refresh）后重新取列表', async () => {
    let listCalls = 0;
    installMock((channel) => {
      if (channel === 'cos-list-sets') {
        listCalls += 1;
        return { items: [SET], total: 1 };
      }
      return base(channel);
    });
    render(<CosSetListPage viewKind="all" onOpenSet={jest.fn()} onSearchChange={jest.fn()} />);
    await screen.findByText('流萤');
    expect(listCalls).toBe(1);

    fireEvent(window, new Event('pav:refresh'));
    await waitFor(() => expect(listCalls).toBe(2));
  });

  test('套图照片页：页头有收藏/完整显示/排序/密度，照片卡收藏与排序参数生效', async () => {
    const { calls } = installMock((channel) => {
      if (channel === 'cos-get-set') return SET;
      if (channel === 'cos-get-set-images') {
        return { images: [IMAGE], totalCount: 1, hasMore: false };
      }
      return base(channel);
    });
    const { container } = render(
      <CosSetAlbumPage setId="s1" setName="流萤（作品A）" options={null} onNavigate={jest.fn()} />
    );

    await screen.findByText('001.jpg');
    expect(screen.getByRole('button', { name: '收藏这个套图' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完整显示' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '排序' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: '缩略图大小' })).toBeInTheDocument();

    await userEvent.click(within(container.querySelector('.grid-card')).getByRole('button', { name: '收藏' }));
    await waitFor(() => {
      const save = calls.find(([channel]) => channel === 'save-favorites');
      expect(save[1].images.map((item) => item.path)).toContain(IMAGE.path);
    });

    fireEvent.change(screen.getByRole('combobox', { name: '排序' }), { target: { value: 'size' } });
    await waitFor(() => {
      const last = calls.filter(([channel]) => channel === 'cos-get-set-images').pop();
      expect(last[2].sortBy).toBe('size');
    });
  });

  test('套图照片页 ←/→ 切上一套/下一套，↑↓ 仍移动选中（4.5.1）', async () => {
    const { calls } = installMock((channel, arg) => {
      if (channel === 'cos-get-set') {
        if (arg === 's2') return { ...SET, id: 's2', displayName: '流萤·第二套' };
        return SET;
      }
      if (channel === 'cos-get-set-images') {
        return { images: [IMAGE], totalCount: 1, hasMore: false };
      }
      if (channel === 'cos-list-set-ids') return ['s1', 's2'];
      return base(channel);
    });
    const onNavigateSet = jest.fn();
    const { container } = render(
      <CosSetAlbumPage
        setId="s1"
        setName="流萤（作品A）"
        options={{ sortBy: 'name' }}
        onNavigateSet={onNavigateSet}
        onNavigate={jest.fn()}
      />
    );

    await screen.findByText('001.jpg');
    await waitFor(() => {
      expect(calls.some(([channel]) => channel === 'cos-list-set-ids')).toBe(true);
    });

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(onNavigateSet).toHaveBeenCalledWith(expect.objectContaining({ setId: 's2' }));
    });

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(container.querySelector('.grid-card.selected')).toBeTruthy());
  });
});
