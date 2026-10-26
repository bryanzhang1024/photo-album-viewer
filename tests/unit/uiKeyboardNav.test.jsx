import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import FolderPage from '../../src/ui/features/folder/FolderPage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 1, directMediaCount: 2 },
  children: [{
    name: 'a-文件夹',
    ref: { sourceId: 'src_a', relativePath: 'a-文件夹' },
    status: 'ok',
    facts: { directMediaCount: 0, childDirectoryCount: 0 },
    mtimeMs: 1,
    approximate: { coverSamples: [] }
  }],
  directMedia: [
    { name: 'b.jpg', relativePath: 'b.jpg', size: 1024, mtimeMs: 2 },
    { name: 'c.jpg', relativePath: 'c.jpg', size: 2048, mtimeMs: 3 }
  ],
  approximate: { coverSamples: [] }
};

function install() {
  const calls = [];
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      calls.push(channel);
      if (channel === 'get-directory-level-v1') return { ok: true, data: SNAPSHOT };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      if (channel === 'save-favorites') return { success: true };
      return { ok: true, success: true, data: {} };
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  return calls;
}

function renderList(extra = {}) {
  return render(
    <FolderPage
      source={SOURCE}
      relativePath=""
      viewMode="list"
      onOpenFolder={jest.fn()}
      onOpenRoots={jest.fn()}
      {...extra}
    />
  );
}

const selectedName = (container) => container.querySelector('.folder-row.selected .c-name span')?.textContent;

describe('P2 列表键盘导航与单键', () => {
  beforeEach(() => window.localStorage.clear());

  test('方向键移动选中、Home/End 跳首尾；Esc 不再由本页清选中（交给 App 退层）', async () => {
    install();
    const { container } = renderList();
    await screen.findByText('a-文件夹');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(selectedName(container)).toBe('a-文件夹'));

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(selectedName(container)).toBe('b.jpg'));

    fireEvent.keyDown(window, { key: 'End' });
    await waitFor(() => expect(selectedName(container)).toBe('c.jpg'));

    fireEvent.keyDown(window, { key: 'Home' });
    await waitFor(() => expect(selectedName(container)).toBe('a-文件夹'));

    // B 方案：Esc 只退层，选中态随换页消失，不由页面清空。
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(selectedName(container)).toBe('a-文件夹'));
  });

  test('Enter 打开选中项：文件夹进入目录', async () => {
    install();
    const onOpenFolder = jest.fn();
    renderList({ onOpenFolder });
    await screen.findByText('a-文件夹');

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(onOpenFolder).toHaveBeenCalledWith('a-文件夹', expect.anything()));
  });

  test('列表单键：C 收藏、O 在 Finder 显示、Delete 移到废纸篓', async () => {
    const calls = install();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderList();
    await screen.findByText('a-文件夹');

    // 选中第二行（b.jpg）
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await screen.findByText('b.jpg');

    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() => expect(calls).toContain('save-favorites'));

    fireEvent.keyDown(window, { key: 'o' });
    await waitFor(() => expect(calls).toContain('show-in-folder'));

    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(calls).toContain('trash-image'));
  });

  test('左右方向键也能移动选中；网格里同样可用', async () => {
    install();
    const { container } = renderList();
    await screen.findByText('a-文件夹');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(selectedName(container)).toBe('a-文件夹'));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(selectedName(container)).toBe('b.jpg'));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(selectedName(container)).toBe('a-文件夹'));
  });

  test('R 随机打开当前文件夹的一张图', async () => {
    install();
    jest.spyOn(Math, 'random').mockReturnValue(0);
    renderList();
    await screen.findByText('a-文件夹');

    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: '大图查看器' })).toBeInTheDocument());
    Math.random.mockRestore();
  });

  test('输入框内方向键/单键不触发列表导航', async () => {
    install();
    const { container } = renderList();
    await screen.findByText('a-文件夹');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'c' });
    expect(container.querySelector('.folder-row.selected')).toBeNull();
    input.remove();
  });
});

const ALBUM_SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '当前套', absolutePath: '/A/当前套' },
  facts: { childDirectoryCount: 0, directMediaCount: 2 },
  children: [],
  directMedia: [
    { name: 'b.jpg', relativePath: 'b.jpg', size: 1024, mtimeMs: 2 },
    { name: 'c.jpg', relativePath: 'c.jpg', size: 2048, mtimeMs: 3 }
  ],
  approximate: { coverSamples: [] }
};

describe('P2 套图界面左右键切上一套/下一套', () => {
  test('←/→ 切相邻套图，不移动选中', async () => {
    install();
    window.electronAPI.invoke.mockImplementation(async (channel) => {
      if (channel === 'get-directory-level-v1') return { ok: true, data: ALBUM_SNAPSHOT };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      return { ok: true, success: true, data: {} };
    });
    const onOpenFolder = jest.fn();
    const siblings = ['上一套', '当前套', '下一套'];
    render(
      <FolderPage
        source={SOURCE}
        relativePath="当前套"
        viewMode="grid"
        siblings={siblings}
        onOpenFolder={onOpenFolder}
        onOpenRoots={jest.fn()}
      />
    );
    await screen.findByText('b.jpg');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(onOpenFolder).toHaveBeenCalledWith('下一套', expect.anything()));

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(onOpenFolder).toHaveBeenCalledWith('上一套', expect.anything()));
  });
});

describe('P2 网格键盘导航', () => {
  beforeEach(() => window.localStorage.clear());

  test('方向键在网格里移动选中，Enter 打开图片进查看器', async () => {
    install();
    const { container } = render(
      <FolderPage
        source={SOURCE}
        relativePath=""
        viewMode="grid"
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
      />
    );
    await screen.findByText('b.jpg');

    fireEvent.keyDown(window, { key: 'ArrowDown' }); // 选中文件夹
    fireEvent.keyDown(window, { key: 'ArrowDown' }); // 选中第一张图片
    await waitFor(() => expect(container.querySelector('.grid-card.selected')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: '大图查看器' })).toBeInTheDocument());
  });
});
