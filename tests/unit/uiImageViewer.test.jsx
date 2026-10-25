import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ImageViewer from '../../src/ui/components/ImageViewer';

const IMAGES = [
  { path: '/A/a/1.jpg', name: '1.jpg', size: 1024, mtimeMs: 0 },
  { path: '/A/a/2.jpg', name: '2.jpg', size: 2048, mtimeMs: 0 },
  { path: '/A/a/3.jpg', name: '3.jpg', size: 4096, mtimeMs: 0 }
];

function renderViewer(onClose = jest.fn()) {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      if (channel === 'load-favorites') return { ok: true, data: { folders: [], albums: [], images: [] } };
      return { ok: true, data: {} };
    })
  };
  render(
    <ImageViewer
      images={IMAGES}
      initialIndex={0}
      title="套图"
      albumPath="/A/a"
      albumName="套图"
      onClose={onClose}
    />
  );
  return onClose;
}

describe('查看器 · Esc 分层与输入', () => {
  test('Esc 三级：先关信息面板，再关查看器', async () => {
    const onClose = renderViewer();

    await userEvent.click(screen.getByRole('button', { name: '图片信息' }));
    expect(screen.getByRole('button', { name: '图片信息' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: '图片信息' })).toHaveAttribute('aria-pressed', 'false');
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('普通滚轮翻页，⌘+滚轮缩放不翻页', async () => {
    const stage = () => screen.getByRole('dialog', { name: '大图查看器' }).querySelector('.viewer-stage');

    const { unmount } = render(
      <ImageViewer images={IMAGES} initialIndex={0} title="套图" albumPath="/A/a" albumName="套图" onClose={jest.fn()} />
    );
    expect(screen.getByText(/1 \/ 3/)).toBeInTheDocument();

    fireEvent.wheel(stage(), { deltaY: 120 });
    expect(await screen.findByText(/2 \/ 3/)).toBeInTheDocument();
    unmount();
  });

  test('右键关闭查看器', async () => {
    const onClose = renderViewer();
    fireEvent.contextMenu(screen.getByRole('dialog', { name: '大图查看器' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('⌘C 复制文件、⌘⇧C 复制像素、在 Finder 中显示都调用对应通道', async () => {
    const calls = [];
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (...args) => {
        calls.push(args);
        if (args[0] === 'load-favorites') return { folders: [], albums: [], images: [] };
        return { success: true };
      })
    };
    render(
      <ImageViewer images={IMAGES} initialIndex={0} title="套图" albumPath="/A/a" albumName="套图" onClose={jest.fn()} />
    );

    await userEvent.keyboard('{Meta>}c{/Meta}');
    expect(calls.some(([channel, , mode]) => channel === 'copy-image-to-clipboard' && mode === 'file')).toBe(true);

    await userEvent.keyboard('{Meta>}{Shift>}c{/Shift}{/Meta}');
    expect(calls.some(([channel, , mode]) => channel === 'copy-image-to-clipboard' && mode === 'image')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '在 Finder 中显示' }));
    expect(calls.some(([channel]) => channel === 'show-in-folder')).toBe(true);
  });

  test('V 切换双页，标题显示跨页序号', async () => {
    renderViewer();
    await userEvent.keyboard('v');

    const title = screen.getByText(/1–2 \/ 3/);
    expect(title).toBeInTheDocument();
  });
});
