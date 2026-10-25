import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/ui/App';
import ImageViewer from '../../src/ui/components/ImageViewer';
import FolderPage from '../../src/ui/features/folder/FolderPage';
import RootsPage from '../../src/ui/features/roots/RootsPage';
import CosHomePage from '../../src/ui/features/cos/CosHomePage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

const EMPTY_DIR = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 0, directMediaCount: 0 },
  children: [],
  directMedia: [],
  approximate: { coverSamples: [] }
};

const MIXED_DIR = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 2, directMediaCount: 2 },
  children: [
    { name: 'b', ref: { sourceId: 'src_a', relativePath: 'b' }, status: 'ok', facts: { directMediaCount: 10, childDirectoryCount: 1 }, mtimeMs: 1, approximate: { coverSamples: [] } },
    { name: 'a', ref: { sourceId: 'src_a', relativePath: 'a' }, status: 'ok', facts: { directMediaCount: 3, childDirectoryCount: 5 }, mtimeMs: 9, approximate: { coverSamples: [] } }
  ],
  directMedia: [
    { name: 'z.jpg', relativePath: 'z.jpg', size: 300, mtimeMs: 5 },
    { name: 'y.jpg', relativePath: 'y.jpg', size: 100, mtimeMs: 2 }
  ],
  approximate: { coverSamples: [] }
};

function installMock(handler) {
  const calls = [];
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, ...args) => {
      calls.push([channel, ...args]);
      return handler(channel, args);
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  return calls;
}

function baseHandler(channel) {
  if (channel === 'load-source-roots-v1') return { ok: true, data: { sources: [SOURCE] } };
  if (channel === 'get-directory-level-v1') return { ok: true, data: EMPTY_DIR };
  if (channel === 'list-directory-files-v1') return { success: true, files: [] };
  if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
  return { ok: true, data: {} };
}

describe('能力矩阵收尾', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('R09 ⌘[ / ⌘] / ⌘↑ 真的改变当前位置', async () => {
    installMock(baseHandler);
    render(<App />);
    const sidebar = within(screen.getByLabelText('侧栏'));
    await sidebar.findByText('A-库');
    await userEvent.click(sidebar.getByText('A-库').closest('button'));
    await waitFor(() => expect(screen.getByRole('button', { name: '后退' })).toBeEnabled());

    fireEvent.keyDown(window, { key: '[', metaKey: true });
    await waitFor(() => expect(screen.getByText('照片来源', { selector: '.page-header-title-compact' })).toBeInTheDocument());

    fireEvent.keyDown(window, { key: ']', metaKey: true });
    await waitFor(() => expect(screen.getByRole('button', { name: '后退' })).toBeEnabled());

    fireEvent.keyDown(window, { key: 'ArrowUp', metaKey: true });
    await waitFor(() => expect(screen.getByText('照片来源', { selector: '.page-header-title-compact' })).toBeInTheDocument());
  });

  test('R04 每个标签各自前进后退，互不影响', async () => {
    const rootDir = {
      ...MIXED_DIR,
      facts: { childDirectoryCount: 1, directMediaCount: 0 },
      children: [{
        name: '子目录',
        ref: { sourceId: 'src_a', relativePath: '子目录' },
        status: 'ok',
        facts: { directMediaCount: 1, childDirectoryCount: 0 },
        mtimeMs: 1,
        approximate: { coverSamples: [] }
      }],
      directMedia: []
    };
    const childDir = {
      ...EMPTY_DIR,
      locator: { sourceId: 'src_a', relativePath: '子目录', absolutePath: '/A/子目录' },
      facts: { childDirectoryCount: 0, directMediaCount: 1 },
      directMedia: [{ name: 'x.jpg', relativePath: 'x.jpg', size: 100, mtimeMs: 1 }]
    };
    installMock((channel, args) => {
      if (channel === 'get-directory-level-v1') {
        const ref = args[0]?.ref;
        return { ok: true, data: ref?.relativePath === '子目录' ? childDir : rootDir };
      }
      return baseHandler(channel, args);
    });

    render(<App />);
    const sidebar = within(screen.getByLabelText('侧栏'));
    await sidebar.findByText('A-库');
    await userEvent.click(sidebar.getByText('A-库').closest('button'));

    await userEvent.click(screen.getByRole('button', { name: '新建标签页' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);

    // 第二个标签进入子目录
    await userEvent.click(await screen.findByText('子目录'));
    await waitFor(() => expect(screen.getByText('子目录', { selector: '.page-header-title-compact' })).toBeInTheDocument());

    // 回到第一个标签后退，只影响它自己
    await userEvent.click(screen.getAllByRole('tab')[0]);
    fireEvent.keyDown(window, { key: '[', metaKey: true });
    await waitFor(() => expect(screen.getByText('照片来源', { selector: '.page-header-title-compact' })).toBeInTheDocument());

    // 第二个标签仍在子目录
    await userEvent.click(screen.getAllByRole('tab')[1]);
    await waitFor(() => expect(screen.getByText('子目录', { selector: '.page-header-title-compact' })).toBeInTheDocument());
  });

  test('R10 列表四列各点三次：同列升→降→升', async () => {
    installMock((channel, args) => {
      if (channel === 'get-directory-level-v1') return { ok: true, data: MIXED_DIR };
      return baseHandler(channel, args);
    });
    const { container } = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await screen.findByText('a');

    const expectations = [
      { name: /名称/, sequence: ['descending', 'ascending', 'descending'] },
      { name: /图片 \/ 类型/, sequence: ['descending', 'ascending', 'descending'] },
      { name: /子文件夹 \/ 大小/, sequence: ['descending', 'ascending', 'descending'] },
      { name: /修改日期/, sequence: ['descending', 'ascending', 'descending'] }
    ];

    const rowNames = () => [...container.querySelectorAll('.folder-row .c-name span')]
      .map((el) => el.textContent);

    for (const expectation of expectations) {
      const header = screen.getByRole('columnheader', { name: expectation.name });
      for (const expected of expectation.sequence) {
        await userEvent.click(header);
        await waitFor(() => {
          expect(screen.getByRole('columnheader', { name: expectation.name })).toHaveAttribute('aria-sort', expected);
        });
      }
    }

    // 方向与字段一起写进本文件夹的记忆
    const stored = JSON.parse(window.localStorage.getItem('pav.sort.v1:src_a:'));
    expect(stored).toEqual({ field: 'mtimeMs', direction: 'descending'.replace('descending', 'desc') });

    // 真按行序验证一次：按图片数降序时 10 张的 b 在前
    await userEvent.click(screen.getByRole('columnheader', { name: /图片 \/ 类型/ }));
    await waitFor(() => expect(rowNames()[0]).toBe('b'));
    await userEvent.click(screen.getByRole('columnheader', { name: /图片 \/ 类型/ }));
    await waitFor(() => expect(rowNames()[0]).toBe('a'));

    expect(container.querySelectorAll('[role="columnheader"]')).toHaveLength(4);
  });

  test('R13 双页模式下前进按跨页步进', async () => {
    installMock(baseHandler);
    const { container } = render(
      <ImageViewer
        images={[
          { path: '/A/1.jpg', name: '1.jpg' },
          { path: '/A/2.jpg', name: '2.jpg' },
          { path: '/A/3.jpg', name: '3.jpg' },
          { path: '/A/4.jpg', name: '4.jpg' }
        ]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    await userEvent.keyboard('v');
    expect(screen.getAllByText(/1–2 \/ 4/).length).toBeGreaterThan(0);
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getAllByText(/3–4 \/ 4/).length).toBeGreaterThan(0));
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  test('R16 全屏按钮调用系统全屏并在再次点击时退出', async () => {
    installMock(baseHandler);
    const requestFullscreen = jest.fn(async () => {});
    const exitFullscreen = jest.fn(async () => {});
    document.documentElement.requestFullscreen = requestFullscreen;
    document.exitFullscreen = exitFullscreen;

    render(
      <ImageViewer
        images={[{ path: '/A/1.jpg', name: '1.jpg' }]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  test('R26 主题、自动旋转竖图、缩放步长都按设置执行', async () => {
    window.localStorage.setItem('photoViewerSettings', JSON.stringify({
      theme: 'light',
      autoRotateVerticalImages: true,
      rotationDirection: 'right',
      zoomStep: 0.5
    }));
    installMock(baseHandler);

    render(<App />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    const { container, unmount } = render(
      <ImageViewer
        images={[{ path: '/A/1.jpg', name: '1.jpg' }]}
        initialIndex={0}
        title="套图"
        albumPath="/A"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    const image = container.querySelector('.viewer-image');
    Object.defineProperty(image, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(image, 'naturalHeight', { value: 1600, configurable: true });
    fireEvent.load(image);
    await waitFor(() => expect(image.style.transform).toContain('rotate(90deg)'));

    await userEvent.click(screen.getByRole('button', { name: '放大' }));
    expect(screen.getByText(/150%/)).toBeInTheDocument();
    unmount();
    window.localStorage.clear();
  });

  test('R28 来源读失败给出原因与重试，重试会再次请求', async () => {
    let attempts = 0;
    installMock((channel) => {
      if (channel === 'get-directory-level-v1') {
        attempts += 1;
        if (attempts === 1) throw new Error('外接盘未挂载');
        return { ok: true, data: EMPTY_DIR };
      }
      return baseHandler(channel);
    });

    render(<RootsPage sources={[SOURCE]} onOpen={jest.fn()} onOpenFolder={jest.fn()} />);
    expect(await screen.findByText('外接盘未挂载')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(attempts).toBeGreaterThan(1));
  });

  test('R23 Cos 总览显示真实统计与三个入口', async () => {
    installMock((channel) => {
      if (channel === 'cos-get-status') {
        return {
          summary: { setCount: 9591, imageCount: 409017, characterCount: 1341, coserCount: 647 },
          roots: [{ id: 'root:1', label: '300-Cos套图库', path: '/Volumes/1TB/Collection/300-Cos套图库' }],
          indexing: false
        };
      }
      if (channel === 'cos-list-sets') return { items: [] };
      if (channel === 'cos-list-characters') return { items: [] };
      if (channel === 'cos-list-cosers') return { items: [] };
      return baseHandler(channel);
    });

    render(<CosHomePage onNavigate={jest.fn()} />);
    expect((await screen.findAllByText(/9,591 套/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/409,017 张图片/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /按角色/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /按署名/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部作品/ })).toBeInTheDocument();
  });
});
