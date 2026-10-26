import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/ui/App';

const SOURCE_A = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

const IMAGE = { name: 'b.jpg', relativePath: 'b.jpg', size: 1024, mtimeMs: 2 };
const CHILD_FOLDER = {
  name: 'a-文件夹',
  ref: { sourceId: 'src_a', relativePath: 'a-文件夹' },
  status: 'ok',
  facts: { directMediaCount: 0, childDirectoryCount: 0 },
  mtimeMs: 1,
  approximate: { coverSamples: [] }
};

const COS_SET = {
  id: 's1',
  displayName: '流萤（作品A）',
  originalName: '流萤（作品A）',
  imageCount: 8,
  coverMediaId: null,
  works: [],
  type: '',
  favoriteTargets: [{
    path: '/300/流萤（作品A）',
    online: true,
    previewImagePath: '/300/流萤（作品A）/001.jpg'
  }]
};
const COS_CHARACTER = { id: 'c1', name: '流萤', setCount: 1, coverMediaId: null };
const COS_IMAGE = {
  path: '/300/流萤（作品A）/001.jpg',
  name: '001.jpg',
  size: 844800,
  lastModified: new Date(2022, 11, 7)
};

function snapshot(relativePath, { children = [], directMedia = [] } = {}) {
  return {
    locator: {
      sourceId: 'src_a',
      relativePath,
      absolutePath: relativePath ? `/A/${relativePath}` : '/A'
    },
    facts: { childDirectoryCount: children.length, directMediaCount: directMedia.length },
    children,
    directMedia,
    approximate: { coverSamples: [] }
  };
}

const ROOT = snapshot('', { children: [CHILD_FOLDER] });
const CHILD = snapshot('a-文件夹', { directMedia: [IMAGE] });

function install() {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, payload) => {
      if (channel === 'load-source-roots-v1') return { ok: true, data: { sources: [SOURCE_A] } };
      if (channel === 'get-directory-level-v1') {
        const relativePath = payload?.ref?.relativePath || '';
        return { ok: true, data: relativePath === 'a-文件夹' ? CHILD : ROOT };
      }
      if (channel === 'watch-directory-v1') return { ok: true };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      if (channel === 'save-favorites') return { success: true };
      if (channel === 'cos-get-status') {
        return {
          state: 'ready',
          roots: [],
          summary: { setCount: 1, imageCount: 8, characterCount: 1, coserCount: 0 }
        };
      }
      if (channel === 'cos-list-sets') return { items: [COS_SET], total: 1 };
      if (channel === 'cos-list-characters') return { items: [COS_CHARACTER], total: 1 };
      if (channel === 'cos-list-cosers') return { items: [], total: 0 };
      if (channel === 'cos-get-set') return COS_SET;
      if (channel === 'cos-get-set-images') {
        return { images: [COS_IMAGE], totalCount: 1, hasMore: false };
      }
      if (channel === 'cos-list-set-ids') return ['s1'];
      if (channel === 'cos-list-random-set-ids') return ['s1'];
      if (channel === 'cos-get-media-thumbnail') return '';
      return { ok: true, data: {} };
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}

async function renderApp() {
  const view = render(<App />);
  await screen.findByRole('tablist');
  return view;
}

const breadcrumbText = () => screen.queryByRole('navigation', { name: '面包屑' })?.textContent || '';
const rootCard = () => document.querySelector('.root-card');
const firstGridCard = () => document.querySelector('.grid-card');
const sidebar = () => within(screen.getByLabelText('侧栏'));

async function enterChildFolder() {
  fireEvent.click(await waitFor(() => {
    const card = rootCard();
    expect(card).toBeTruthy();
    return card;
  }));
  await waitFor(() => expect(breadcrumbText()).toContain('A-库'));

  fireEvent.click(await waitFor(() => {
    const card = firstGridCard();
    expect(card).toBeTruthy();
    return card;
  }));
  await waitFor(() => expect(breadcrumbText()).toContain('a-文件夹'));
}

describe('App · Esc 分层（按页面层级，B 方案）', () => {
  beforeEach(() => {
    window.innerWidth = 1440;
    window.localStorage.clear();
    window.sessionStorage.clear();
    install();
  });

  test('顶层页 Esc 无动作', async () => {
    await renderApp();
    await waitFor(() => expect(rootCard()).toBeTruthy());

    await userEvent.keyboard('{Escape}');

    expect(rootCard()).toBeTruthy();
  });

  test('文件夹页按层级逐层退：子目录 → 来源根 → 照片来源', async () => {
    await renderApp();
    await enterChildFolder();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(breadcrumbText()).toContain('A-库'));
    expect(breadcrumbText()).not.toContain('a-文件夹');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(rootCard()).toBeTruthy());
  });

  test('选中项不再挡住退层：Esc 直接回上一层（选中随换页消失）', async () => {
    await renderApp();
    await enterChildFolder();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(breadcrumbText()).toContain('A-库'));
    await waitFor(() => expect(firstGridCard()).toBeTruthy());

    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => expect(document.querySelector('.grid-card.selected')).toBeTruthy());

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(rootCard()).toBeTruthy());
  });

  test('搜索框有字时 Esc 只清空并失焦，再按一次才退层', async () => {
    await renderApp();
    fireEvent.click(await waitFor(() => {
      const card = rootCard();
      expect(card).toBeTruthy();
      return card;
    }));
    await waitFor(() => expect(firstGridCard()).toBeTruthy());

    const input = screen.getByRole('searchbox', { name: '搜索这个文件夹' });
    await userEvent.click(input);
    await userEvent.type(input, '流萤');
    expect(input).toHaveValue('流萤');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(input).toHaveValue(''));
    expect(breadcrumbText()).toContain('A-库');
    expect(document.activeElement).not.toBe(input);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(rootCard()).toBeTruthy());
  });

  test('查看器打开时 Esc 只关查看器，不会同时退一层', async () => {
    await renderApp();
    await enterChildFolder();

    fireEvent.click(await waitFor(() => {
      const card = firstGridCard();
      expect(card).toBeTruthy();
      return card;
    }));
    await screen.findByRole('dialog', { name: '大图查看器' });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(breadcrumbText()).toContain('a-文件夹');
  });

  test('菜单打开时 Esc 只关菜单，不导航', async () => {
    await renderApp();
    await enterChildFolder();

    fireEvent.contextMenu(screen.getAllByRole('tab')[0]);
    await screen.findByRole('menu', { name: '标签页菜单' });

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(breadcrumbText()).toContain('a-文件夹');
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  test('Cos 链路逐层退：照片 → 署名套图列表 → 按角色 → 总览；⌘↑ 同去向', async () => {
    await renderApp();

    await userEvent.click(sidebar().getByRole('button', { name: '按角色' }));
    await waitFor(() => expect(breadcrumbText()).toContain('按角色'));
    await waitFor(() => expect(firstGridCard()).toBeTruthy());

    fireEvent.click(firstGridCard());
    await waitFor(() => expect(breadcrumbText()).toContain('流萤'));
    expect(breadcrumbText()).not.toContain('流萤（作品A）');

    fireEvent.click(await waitFor(() => {
      const card = firstGridCard();
      expect(card).toBeTruthy();
      return card;
    }));
    await waitFor(() => expect(breadcrumbText()).toContain('流萤（作品A）'));

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(breadcrumbText()).toContain('流萤'));
    expect(breadcrumbText()).not.toContain('流萤（作品A）');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(breadcrumbText()).toContain('按角色'));
    expect(breadcrumbText()).not.toContain('流萤');

    await userEvent.keyboard('{Escape}');
    await screen.findByText('1 套 · 8 张图片');

    // 顶层：Cos 总览再按 Esc 无动作。
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText('1 套 · 8 张图片')).toBeInTheDocument();

    // 全部作品入口：进入套图照片页后 ⌘↑ 与 Esc 同一父级。
    await userEvent.click(sidebar().getByRole('button', { name: '全部作品' }));
    await waitFor(() => expect(breadcrumbText()).toContain('全部作品'));
    fireEvent.click(await waitFor(() => {
      const card = firstGridCard();
      expect(card).toBeTruthy();
      return card;
    }));
    await waitFor(() => expect(breadcrumbText()).toContain('流萤（作品A）'));

    await userEvent.keyboard('{Meta>}{ArrowUp}{/Meta}');
    await waitFor(() => expect(breadcrumbText()).toContain('全部作品'));
    expect(breadcrumbText()).not.toContain('流萤（作品A）');
  });

  test('全部作品入口的套图照片页面包屑补「全部作品」一段，与 Esc 父级一致', async () => {
    await renderApp();

    await userEvent.click(sidebar().getByRole('button', { name: '全部作品' }));
    await waitFor(() => expect(breadcrumbText()).toContain('全部作品'));

    fireEvent.click(await waitFor(() => {
      const card = firstGridCard();
      expect(card).toBeTruthy();
      return card;
    }));
    await waitFor(() => expect(breadcrumbText()).toContain('流萤（作品A）'));
    expect(breadcrumbText()).toContain('全部作品');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(breadcrumbText()).toContain('全部作品'));
    expect(breadcrumbText()).not.toContain('流萤（作品A）');
  });
});
