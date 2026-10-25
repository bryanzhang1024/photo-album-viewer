import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FolderPage from '../../src/ui/features/folder/FolderPage';
import GridCard from '../../src/ui/features/folder/GridCard';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

function snapshot({ folders = [], images = [] } = {}) {
  return {
    locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
    facts: { childDirectoryCount: folders.length, directMediaCount: images.length },
    children: folders.map((name, index) => ({
      name,
      ref: { sourceId: 'src_a', relativePath: name },
      status: 'ok',
      facts: { directMediaCount: index === 0 ? 3 : 9, childDirectoryCount: 0 },
      mtimeMs: 100 + index,
      approximate: { coverSamples: [] }
    })),
    directMedia: images.map((name, index) => ({
      name,
      relativePath: name,
      size: 1024 * (index + 1),
      mtimeMs: 200 + index
    })),
    approximate: { coverSamples: [] }
  };
}

function installMock({ data = snapshot(), favorites = { folders: [], albums: [], images: [] } } = {}) {
  const calls = [];
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, payload) => {
      calls.push([channel, payload]);
      if (channel === 'get-directory-level-v1') return { ok: true, data };
      if (channel === 'list-directory-files-v1') return { ok: true, data: { files: [] } };
      if (channel === 'load-favorites') return JSON.parse(JSON.stringify(favorites));
      if (channel === 'save-favorites') return { success: true };
      if (channel === 'show-in-folder') return { success: true };
      return { ok: true, data: {} };
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  return { calls };
}

function renderPage(extra = {}) {
  return render(
    <FolderPage
      source={SOURCE}
      relativePath=""
      viewMode="grid"
      onOpenFolder={jest.fn()}
      onOpenRoots={jest.fn()}
      onOpenInNewTab={jest.fn()}
      onOpenInNewWindow={jest.fn()}
      {...extra}
    />
  );
}

describe('文件夹页 · 收藏入口', () => {
  beforeEach(() => window.localStorage.clear());

  test('图片卡片有心形，点它只切收藏、不打开查看器', async () => {
    const { calls } = installMock({ data: snapshot({ images: ['1.jpg'] }) });
    const { container } = renderPage();

    const heart = await screen.findByRole('button', { name: '收藏' });
    await userEvent.click(heart);

    await waitFor(() => {
      const save = calls.find(([channel]) => channel === 'save-favorites');
      expect(save).toBeTruthy();
      expect(save[1].images.map((item) => item.path)).toContain('/A/1.jpg');
    });
    // 收藏不应打开查看器
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test('普通文件夹页头也有收藏心形（不再只在纯图片相簿出现）', async () => {
    installMock({ data: snapshot({ folders: ['套图一'] }) });
    renderPage();

    expect(await screen.findByRole('button', { name: '收藏这个文件夹' })).toBeInTheDocument();
  });

  test('网格卡片右键出现菜单：打开 / 新标签 / 新窗口 / 收藏 / Finder', async () => {
    installMock({ data: snapshot({ folders: ['套图一'] }) });
    const { container } = renderPage();

    await screen.findByText('套图一');
    const card = container.querySelector('.grid-card');
    fireEvent.contextMenu(card);

    const menu = await screen.findByRole('menu', { name: '卡片菜单' });
    expect(within(menu).getByRole('menuitem', { name: '打开' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '在新标签页打开' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '在新窗口中打开' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '添加到收藏' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '在 Finder 中显示' })).toBeInTheDocument();
  });
});

describe('文件夹页 · 排序', () => {
  beforeEach(() => window.localStorage.clear());

  test('点列头切换排序与升降序', async () => {
    installMock({ data: snapshot({ folders: ['少的三张', '多的九张'] }) });
    const { container } = renderPage({ viewMode: 'list' });

    const header = await screen.findByRole('columnheader', { name: /图片 \/ 类型/ });
    await userEvent.click(header);

    const names = () => [...container.querySelectorAll('.folder-row .c-name span')].map((el) => el.textContent);
    // 图片数第一次点击按降序：九张在前
    await waitFor(() => expect(names()[0]).toBe('多的九张'));
    expect(screen.getByRole('columnheader', { name: /图片 \/ 类型/ })).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(screen.getByRole('columnheader', { name: /图片 \/ 类型/ }));
    await waitFor(() => expect(names()[0]).toBe('少的三张'));
    expect(screen.getByRole('columnheader', { name: /图片 \/ 类型/ })).toHaveAttribute('aria-sort', 'ascending');
  });
});

describe('文件夹页 · 搜索', () => {
  beforeEach(() => window.localStorage.clear());

  test('搜索词从外面传入，页面只负责过滤与计数', async () => {
    installMock({ data: snapshot({ folders: ['流萤 01', '别的套图'] }) });
    const { rerender } = renderPage({ searchQuery: '' });

    expect(await screen.findByText('别的套图')).toBeInTheDocument();

    rerender(
      <FolderPage
        source={SOURCE}
        relativePath=""
        viewMode="grid"
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
        searchQuery="流萤"
        onSearchChange={jest.fn()}
      />
    );

    await waitFor(() => expect(screen.queryByText('别的套图')).not.toBeInTheDocument());
    expect(screen.getByText('流萤 01')).toBeInTheDocument();
    expect(screen.getAllByText(/个结果 · 搜索范围：当前文件夹/).length).toBeGreaterThan(0);
  });

describe('容器文件夹封面（按需向下取图）', () => {
  test('自己没图时会请求并显示拼贴封面', async () => {
    const calls = [];
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel, payload) => {
        calls.push([channel, payload]);
        if (channel === 'get-folder-cover-v1') {
          return {
            success: true,
            samples: ['容器/子/1.jpg', '容器/子/2.jpg', '容器/子/3.jpg', '容器/子/4.jpg']
          };
        }
        return { ok: true, data: {} };
      })
    };

    const item = {
      kind: 'folder',
      key: 'folder:容器',
      name: '容器',
      relativePath: '容器',
      childCount: 2,
      imageCount: 0,
      coverSamples: []
    };
    const { container } = render(
      <GridCard item={item} rootPath="/A" width={180} coverHeight={240} />
    );

    await waitFor(() => expect(container.querySelector('.collage')).toBeTruthy());
    expect(calls.some(([channel]) => channel === 'get-folder-cover-v1')).toBe(true);
  });

  test('快照里已有足够封面时不再发请求', async () => {
    const calls = [];
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        calls.push(channel);
        return { ok: true, data: {} };
      })
    };

    const item = {
      kind: 'folder',
      key: 'folder:套图',
      name: '套图',
      relativePath: '套图',
      childCount: 2,
      imageCount: 3,
      coverSamples: ['套图/1.jpg', '套图/2.jpg', '套图/3.jpg']
    };
    const { container } = render(
      <GridCard item={item} rootPath="/A" width={180} coverHeight={240} />
    );

    await waitFor(() => expect(container.querySelector('.collage')).toBeTruthy());
    expect(calls).not.toContain('get-folder-cover-v1');
  });
});
});
