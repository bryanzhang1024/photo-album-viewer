import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from '../../src/ui/App';
import ImageViewer from '../../src/ui/components/ImageViewer';
import FolderPage from '../../src/ui/features/folder/FolderPage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };

function imageSnapshot(names = ['1.jpg', '2.jpg']) {
  return {
    locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
    facts: { childDirectoryCount: 0, directMediaCount: names.length },
    children: [],
    directMedia: names.map((name, index) => ({
      name,
      relativePath: name,
      size: 1024 * (index + 1),
      mtimeMs: 100 + index
    })),
    approximate: { coverSamples: [] }
  };
}

function installMock(snapshot = imageSnapshot(), extra = {}) {
  const calls = [];
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, ...args) => {
      calls.push([channel, ...args]);
      if (extra[channel]) return extra[channel](args);
      if (channel === 'load-source-roots-v1') {
        return { ok: true, data: { sources: [SOURCE] } };
      }
      if (channel === 'get-directory-level-v1') return { ok: true, data: snapshot };
      if (channel === 'list-directory-files-v1') return { ok: true, data: { files: [] } };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      return { ok: true, data: {} };
    })
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  return calls;
}

describe('能力矩阵证据补齐', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('R18 删除图片：确认后调用 trash-image，取消则不调用', async () => {
    const calls = installMock();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
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

    await userEvent.click(screen.getByRole('button', { name: '移到废纸篓' }));
    expect(calls.some(([channel]) => channel === 'trash-image')).toBe(false);

    confirmSpy.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: '移到废纸篓' }));
    await waitFor(() => expect(calls.some(([channel]) => channel === 'trash-image')).toBe(true));
  });

  test('R20 网格「完整显示」开关切换卡片裁切方式，并按文件夹记住', async () => {
    installMock();
    const { container } = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="grid" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );

    await screen.findByText('1.jpg');
    expect(container.querySelector('.grid-card-cover').className).not.toContain('contain');

    await userEvent.click(screen.getByRole('button', { name: '完整显示' }));
    await waitFor(() => {
      expect(container.querySelector('.grid-card-cover').className).toContain('contain');
    });
    expect(window.localStorage.getItem('pav.fit.v1:src_a:')).toBe('1');
  });

  test('R22 缩略图密度切档后按文件夹记住', async () => {
    installMock();
    render(
      <FolderPage source={SOURCE} relativePath="" viewMode="grid" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await screen.findByText('1.jpg');

    const slider = screen.getByRole('slider', { name: '缩略图大小' });
    fireEvent.change(slider, { target: { value: '2' } });
    await waitFor(() => {
      expect(window.localStorage.getItem('pav.density.v1:src_a:')).toBe('2');
    });
  });

  test('R29 相簿页头有上一套/下一套与收藏', async () => {
    installMock();
    render(
      <FolderPage
        source={SOURCE}
        relativePath="a"
        viewMode="grid"
        siblings={['a', 'b', 'c']}
        onOpenFolder={jest.fn()}
        onOpenRoots={jest.fn()}
      />
    );

    await screen.findByText('1.jpg');
    expect(screen.getByRole('button', { name: '上一套' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一套' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收藏这个相簿' })).toBeInTheDocument();
  });

  test('R07 打开文件夹选「在新窗口打开」会调用 create-new-instance', async () => {
    const calls = installMock(imageSnapshot(), {
      'select-directory': () => '/tmp/new-root',
      'save-source-root-v1': () => ({
        ok: true,
        data: { source: { sourceId: 'src_new', label: 'new-root', rootPath: '/tmp/new-root' } }
      }),
      'create-new-instance': () => ({ success: true })
    });

    render(<App />);
    await screen.findByRole('tablist');
    await userEvent.click(within(screen.getByLabelText('侧栏')).getByRole('button', { name: '打开文件夹' }));

    const menu = await screen.findByRole('menu', { name: '选择打开方式' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: '在新窗口中打开' }));

    await waitFor(() => {
      expect(calls.some(([channel]) => channel === 'create-new-instance')).toBe(true);
    });
  });
});
