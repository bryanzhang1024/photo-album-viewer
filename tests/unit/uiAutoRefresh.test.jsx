import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import FolderPage from '../../src/ui/features/folder/FolderPage';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const SNAPSHOT = {
  locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
  facts: { childDirectoryCount: 0, directMediaCount: 0 },
  children: [],
  directMedia: [],
  approximate: { coverSamples: [] }
};

let changedHandler = null;
let calls = [];

function install() {
  calls = [];
  changedHandler = null;
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      calls.push(channel);
      if (channel === 'get-directory-level-v1') return { ok: true, data: SNAPSHOT };
      if (channel === 'list-directory-files-v1') return { success: true, files: [] };
      if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
      return { ok: true, data: {} };
    }),
    on: jest.fn((channel, handler) => {
      if (channel === 'directory-changed-v1') changedHandler = handler;
      return () => { if (changedHandler === handler) changedHandler = null; };
    }),
    removeListener: jest.fn()
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}

describe('文件夹自动刷新', () => {
  test('挂载时开始监听当前目录，离开时停止', async () => {
    install();
    const { unmount } = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await screen.findByRole('contentinfo');
    await waitFor(() => expect(calls).toContain('watch-directory-v1'));

    unmount();
    await waitFor(() => {
      const watchCalls = calls.filter((c) => c === 'watch-directory-v1');
      return expect(watchCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  test('当前目录收到变动事件后重新扫描；其它目录的事件忽略', async () => {
    install();
    render(
      <FolderPage source={SOURCE} relativePath="" viewMode="list" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await screen.findByRole('contentinfo');
    await waitFor(() => expect(changedHandler).not.toBeNull());
    const before = calls.filter((c) => c === 'get-directory-level-v1').length;

    changedHandler({ sourceId: 'src_other', relativePath: '' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((c) => c === 'get-directory-level-v1').length).toBe(before);

    changedHandler({ sourceId: 'src_a', relativePath: '' });
    await waitFor(() => expect(
      calls.filter((c) => c === 'get-directory-level-v1').length
    ).toBeGreaterThan(before));
  });
});
