import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FolderPage from '../../src/ui/features/folder/FolderPage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: 'a/b', absolutePath: '/A/a/b' },
  facts: { childDirectoryCount: 1, directMediaCount: 0 },
  children: [
    {
      name: 'c',
      ref: { sourceId: 'src_a', relativePath: 'a/b/c' },
      status: 'ok',
      facts: { directMediaCount: 0, childDirectoryCount: 0 },
      mtimeMs: 1,
      approximate: { coverSamples: [] }
    }
  ],
  directMedia: [],
  approximate: { coverSamples: [] }
};

function installMock() {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      if (channel === 'get-directory-level-v1') return { ok: true, data: SNAPSHOT };
      if (channel === 'load-favorites') return { ok: true, data: { folders: [], albums: [], images: [] } };
      if (channel === 'list-directory-files-v1') return { ok: true, data: { files: [] } };
      return { ok: true, data: {} };
    })
  };
}

describe('文件夹页 · 面包屑', () => {
  beforeEach(() => {
    window.localStorage.clear();
    installMock();
    // react-virtuoso 依赖 ResizeObserver，jsdom 没有
    if (!window.ResizeObserver) {
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  test('网格视图也有面包屑，且每一级都是可点的按钮', async () => {
    render(
      <FolderPage
        source={SOURCE}
        relativePath="a/b"
        viewMode="grid"
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
      />
    );

    const nav = await screen.findByRole('navigation', { name: '面包屑' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文件夹' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A-库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'a' })).toBeInTheDocument();
    // 当前层用标题展示，不是按钮
    expect(screen.queryByRole('button', { name: 'b' })).not.toBeInTheDocument();
  });

  test('点「文件夹」回到照片来源页，点来源名回到来源根，点中间层跳到那一层', async () => {
    const onOpenFolder = jest.fn();
    const onOpenRoots = jest.fn();
    render(
      <FolderPage
        source={SOURCE}
        relativePath="a/b"
        viewMode="grid"
        onOpenFolder={onOpenFolder}
        onOpenRoots={onOpenRoots}
      />
    );

    await screen.findByRole('navigation', { name: '面包屑' });

    await userEvent.click(screen.getByRole('button', { name: '文件夹' }));
    expect(onOpenRoots).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'A-库' }));
    expect(onOpenFolder).toHaveBeenCalledWith('', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'a' }));
    expect(onOpenFolder).toHaveBeenCalledWith('a', expect.anything());
  });

  test('网格与列表渲染同一套面包屑结构', async () => {
    const { rerender } = render(
      <FolderPage
        source={SOURCE}
        relativePath="a/b"
        viewMode="grid"
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
      />
    );

    const gridCrumbs = (await screen.findByRole('navigation', { name: '面包屑' })).textContent;

    rerender(
      <FolderPage
        source={SOURCE}
        relativePath="a/b"
        viewMode="list"
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: '面包屑' }).textContent).toBe(gridCrumbs);
    });
  });
});
