import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/ui/App';
import Toolbar from '../../src/ui/shell/Toolbar';
import ImageViewer from '../../src/ui/components/ImageViewer';
import FolderPage from '../../src/ui/features/folder/FolderPage';
import FavoritesPage from '../../src/ui/features/favorites/FavoritesPage';
import PageHeader from '../../src/ui/shell/PageHeader';

function mockInvoke(extra = {}) {
  const calls = [];
  const invoke = jest.fn(async (channel, ...args) => {
    calls.push([channel, ...args]);
    if (extra[channel]) return extra[channel](args);
    if (channel === 'load-source-roots-v1') return { ok: true, data: { sources: [] } };
    if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
    if (channel === 'list-directory-files-v1') return { ok: true, data: { files: [] } };
    return { ok: true, data: {} };
  });
  window.electronAPI = { invoke, platform: 'darwin' };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  return { calls, invoke };
}

const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 2, directMediaCount: 2 },
  children: [
    { name: 'B文件夹', ref: { sourceId: 'src_a', relativePath: 'B文件夹' }, status: 'ok', facts: { directMediaCount: 1, childDirectoryCount: 0 }, mtimeMs: 2, approximate: { coverSamples: [] } },
    { name: 'A文件夹', ref: { sourceId: 'src_a', relativePath: 'A文件夹' }, status: 'ok', facts: { directMediaCount: 1, childDirectoryCount: 0 }, mtimeMs: 1, approximate: { coverSamples: [] } }
  ],
  directMedia: [
    { name: 'a图片.jpg', relativePath: 'a图片.jpg', size: 2048, mtimeMs: 3 },
    { name: 'b图片.jpg', relativePath: 'b图片.jpg', size: 1024, mtimeMs: 4 }
  ],
  approximate: { coverSamples: [] }
};

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

describe('复核阻断项 · 修复验证', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('B2 重启后标签数量与顺序恢复', async () => {
    mockInvoke();
    const first = render(<App />);
    await screen.findByRole('tablist');
    await userEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    first.unmount();

    render(<App />);
    await screen.findByRole('tablist');
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
  });

  test('B3 默认分组下文件夹全部排在图片前', async () => {
    mockInvoke({ 'get-directory-level-v1': () => ({ ok: true, data: SNAPSHOT }) });
    const { container } = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );

    await screen.findByText('B文件夹');
    const names = [...container.querySelectorAll('.folder-row .c-name span')].map((el) => el.textContent);
    const lastFolder = Math.max(names.indexOf('A文件夹'), names.indexOf('B文件夹'));
    const firstImage = Math.min(names.indexOf('a图片.jpg'), names.indexOf('b图片.jpg'));
    expect(lastFolder).toBeLessThan(firstImage);
  });

  test('B4 查看器内按 ⌘F 不进全屏、不关闭查看器', async () => {
    const requestFullscreen = jest.fn();
    document.documentElement.requestFullscreen = requestFullscreen;
    mockInvoke();
    const onClose = jest.fn();
    render(
      <ImageViewer
        images={[{ path: '/A/1.jpg', name: '1.jpg' }]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={onClose}
      />
    );

    await userEvent.keyboard('{Meta>}f{/Meta}');
    expect(requestFullscreen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('B5 查看器有适应窗口、信息面板有尺寸、没有底部状态栏', async () => {
    mockInvoke();
    const { container } = render(
      <ImageViewer
        images={[{ path: '/A/1.jpg', name: '1.jpg', size: 1024 }]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: '适应窗口' })).toBeInTheDocument();
    // 查看器不再有底部状态栏
    expect(screen.queryByText(/Esc 关闭/)).not.toBeInTheDocument();

    const image = container.querySelector('.viewer-image');
    Object.defineProperty(image, 'naturalWidth', { value: 1200, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 1600, configurable: true });
    fireEvent.load(image);

    await userEvent.click(screen.getByRole('button', { name: '图片信息' }));
    expect(screen.getByText('尺寸')).toBeInTheDocument();
    expect(screen.getByText('1200 × 1600')).toBeInTheDocument();
  });

  test('B5 坏图显示占位并可跳到下一张', async () => {
    mockInvoke();
    const { container } = render(
      <ImageViewer
        images={[
          { path: '/A/1.jpg', name: '1.jpg' },
          { path: '/A/2.jpg', name: '2.jpg' }
        ]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    fireEvent.error(container.querySelector('.viewer-image'));
    expect(await screen.findByText('这张图片无法解码。')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '看下一张' }));
    expect(screen.getAllByText(/2 \/ 2/).length).toBeGreaterThan(0);
  });

  test('B5 末张坏图给「关闭查看器」而不是禁用的下一张', async () => {
    mockInvoke();
    const onClose = jest.fn();
    const { container } = render(
      <ImageViewer
        images={[{ path: '/A/1.jpg', name: '1.jpg' }]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={onClose}
      />
    );

    fireEvent.error(container.querySelector('.viewer-image'));
    await screen.findByText('这张图片无法解码。');
    expect(screen.queryByRole('button', { name: '看下一张' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '关闭查看器' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('B6 长按后退 500ms 触发历史菜单，单击只后退', async () => {
    mockInvoke();
    jest.useFakeTimers();
    const onBack = jest.fn();
    const onBackLongPress = jest.fn();
    render(
      <Toolbar
        title="t"
        sidebarCollapsed={false}
        onToggleSidebar={jest.fn()}
        onBack={onBack}
        onForward={jest.fn()}
        onBackLongPress={onBackLongPress}
        canGoBack
      />
    );

    const back = screen.getByRole('button', { name: '后退' });
    fireEvent.pointerDown(back);
    jest.advanceTimersByTime(600);
    expect(onBackLongPress).toHaveBeenCalledTimes(1);

    fireEvent.pointerUp(back);
    fireEvent.click(back);
    expect(onBack).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('B05 面包屑超过 4 段截断后，点击仍对应原始层级', async () => {
    const onCrumbClick = jest.fn();
    const crumbs = [
      { label: '文件夹', clickable: true },
      { label: '来源', clickable: true },
      { label: 'l1', clickable: true },
      { label: 'l2', clickable: true },
      { label: 'l3', clickable: true },
      { label: 'l4', clickable: true }
    ];
    render(<PageHeader crumbs={crumbs} title="当前层" onCrumbClick={onCrumbClick} />);

    expect(screen.getByText('…')).toBeInTheDocument();
    // 截断后保留最后两段：l3 是原始下标 4，l4 是 5
    await userEvent.click(screen.getByRole('button', { name: 'l3' }));
    expect(onCrumbClick).toHaveBeenLastCalledWith(4);
    await userEvent.click(screen.getByRole('button', { name: 'l4' }));
    expect(onCrumbClick).toHaveBeenLastCalledWith(5);
  });

  test('M7 相簿（photoSet）取消收藏真的会从 albums 里删掉', async () => {
    const { calls } = mockInvoke({
      'load-favorites': () => ({
        folders: [],
        albums: [{ id: 'a1', kind: 'photoSet', path: '/A/x', name: '相簿', imageCount: 3, addedAt: 1 }],
        images: []
      }),
      'save-favorites': () => ({ success: true })
    });
    render(<FavoritesPage />);

    await screen.findByText('相簿');
    await userEvent.click(screen.getByRole('button', { name: '取消收藏' }));

    await waitFor(() => {
      const save = calls.find(([channel]) => channel === 'save-favorites');
      expect(save).toBeTruthy();
      expect(save[1].albums).toHaveLength(0);
    });
  });

  test('M3 只命中非图片文件时，列表仍渲染「其他文件」段', async () => {
    mockInvoke({
      'get-directory-level-v1': () => ({
        ok: true,
        data: {
          locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
          facts: { childDirectoryCount: 1, directMediaCount: 1 },
          children: [{ name: '套图', ref: { sourceId: 'src_a', relativePath: '套图' }, status: 'ok', facts: { directMediaCount: 1, childDirectoryCount: 0 }, mtimeMs: 1, approximate: { coverSamples: [] } }],
          directMedia: [{ name: 'a.jpg', relativePath: 'a.jpg', size: 1024, mtimeMs: 2 }],
          approximate: { coverSamples: [] }
        }
      }),
      'list-directory-files-v1': () => ({
        success: true,
        files: [{ name: '视频.mp4', ext: '.mp4', kind: 'video', size: 2048, mtimeMs: 3 }]
      })
    });
    const { container } = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" searchQuery="视频" onSearchChange={jest.fn()} onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );

    await waitFor(() => expect(container.querySelectorAll('.folder-row.file').length).toBe(1));
    expect(container.textContent).toContain('视频.mp4');
  });

  test('M2 照片层列表只有三列，不摆空的「子文件夹」列', async () => {
    mockInvoke({ 'get-directory-level-v1': () => ({ ok: true, data: SNAPSHOT }) });
    const { unmount } = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await screen.findByText('B文件夹');
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
    unmount();

    // 进入纯图片目录（直接渲染成照片层）
    mockInvoke({
      'get-directory-level-v1': () => ({
        ok: true,
        data: {
          locator: { sourceId: 'src_a', relativePath: 'x', absolutePath: '/A/x' },
          facts: { childDirectoryCount: 0, directMediaCount: 2 },
          children: [],
          directMedia: SNAPSHOT.directMedia,
          approximate: { coverSamples: [] }
        }
      })
    });
    render(
      <FolderPage source={SOURCE} relativePath="x" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await waitFor(() => expect(screen.getAllByRole('columnheader')).toHaveLength(3));
  });
});
