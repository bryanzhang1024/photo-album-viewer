import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
    expect(screen.getAllByText(/1 \/ 3/).length).toBeGreaterThan(0);

    fireEvent.wheel(stage(), { deltaY: 120 });
    await waitFor(() => expect(screen.getAllByText(/2 \/ 3/).length).toBeGreaterThan(0));
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

  test('滚轮防抖：连续小位移不翻页，累计过阈值只翻一张', async () => {
    renderViewer();
    const stage = () => screen.getByRole('dialog', { name: '大图查看器' }).querySelector('.viewer-stage');

    fireEvent.wheel(stage(), { deltaY: 40 });
    fireEvent.wheel(stage(), { deltaY: 40 });
    expect(screen.getAllByText(/1 \/ 3/).length).toBeGreaterThan(0);

    fireEvent.wheel(stage(), { deltaY: 60 });
    await waitFor(() => expect(screen.getAllByText(/2 \/ 3/).length).toBeGreaterThan(0));
  });

  test('到最后一张再往后会回到第一张，并提示已回到首张', async () => {
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
        return { success: true };
      })
    };
    render(
      <ImageViewer
        images={IMAGES}
        initialIndex={2}
        title="套图"
        albumPath="/A/a"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(screen.getAllByText(/1 \/ 3/).length).toBeGreaterThan(0));
    expect(screen.getByRole('status')).toHaveTextContent('已到末尾，已回到第一张');
  });

  test('底部工具栏默认隐藏，鼠标到底部附近才出现', async () => {
    renderViewer();
    const viewer = screen.getByRole('dialog', { name: '大图查看器' });
    expect(viewer.querySelector('.viewer-bar').className).toContain('hidden');

    // 鼠标还在画面上半部分：保持隐藏
    fireEvent.mouseMove(viewer, { clientY: 100 });
    expect(viewer.querySelector('.viewer-bar').className).toContain('hidden');

    // 移到窗口底部附近：出现
    fireEvent.mouseMove(viewer, { clientY: window.innerHeight - 10 });
    expect(viewer.querySelector('.viewer-bar').className).not.toContain('hidden');

    // 移出窗口：再次隐藏
    fireEvent.mouseLeave(viewer);
    expect(viewer.querySelector('.viewer-bar').className).toContain('hidden');
  });

  test('收藏后按钮与卡片使用同一套实心红样式', async () => {
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        if (channel === 'load-favorites') {
          return { folders: [], albums: [], images: [{ path: '/A/a/1.jpg', name: '1.jpg' }] };
        }
        return { success: true };
      })
    };
    render(
      <ImageViewer images={IMAGES} initialIndex={0} title="套图" albumPath="/A/a" albumName="套图" onClose={jest.fn()} />
    );

    await waitFor(() => {
      const button = screen.getByRole('button', { name: '收藏' });
      expect(button.className).toContain('favorite-toggle');
      expect(button.className).toContain('favorited');
    });
  });

  test('顶部显示当前图片文件名，而不是文件夹名', async () => {
    renderViewer();
    const title = screen.getByText(/1\.jpg/);
    expect(title).toBeInTheDocument();
    expect(title.textContent).toContain('1 / 3');
  });

  test('底部按钮都有说明性 tooltip', async () => {
    renderViewer();
    expect(screen.getByRole('button', { name: '复制文件' }).getAttribute('title')).toContain('⌘C');
    expect(screen.getByRole('button', { name: '复制像素' }).getAttribute('title')).toContain('⌘⇧C');
    expect(screen.getByRole('button', { name: '旋转' }).getAttribute('title')).toContain('旋转');
    expect(screen.getByRole('button', { name: '移到废纸篓' }).getAttribute('title')).toContain('废纸篓');
  });

  test('最后一张的「下一张」不再禁用，点击会循环回第一张', async () => {
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
        return { success: true };
      })
    };
    render(
      <ImageViewer
        images={IMAGES}
        initialIndex={2}
        title="套图"
        albumPath="/A/a"
        albumName="套图"
        onClose={jest.fn()}
      />
    );

    const next = screen.getByRole('button', { name: '下一张' });
    expect(next).not.toBeDisabled();
    await userEvent.click(next);
    await waitFor(() => expect(screen.getAllByText(/1 \/ 3/).length).toBeGreaterThan(0));
  });

  test('恢复旧版键位：A/D 翻页、Q/E 旋转、C 收藏、O 在 Finder 显示', async () => {
    const calls = [];
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        calls.push(channel);
        if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
        return { success: true };
      })
    };
    const { container } = render(
      <ImageViewer images={IMAGES} initialIndex={0} title="套图" albumPath="/A/a" albumName="套图" onClose={jest.fn()} />
    );
    const image = () => container.querySelector('.viewer-image, .viewer-pair img');

    await userEvent.keyboard('d');
    await waitFor(() => expect(screen.getAllByText(/2 \/ 3/).length).toBeGreaterThan(0));
    await userEvent.keyboard('a');
    await waitFor(() => expect(screen.getAllByText(/1 \/ 3/).length).toBeGreaterThan(0));

    await userEvent.keyboard('e');
    expect(image().style.transform).toContain('rotate(90deg)');
    await userEvent.keyboard('q');
    expect(image().style.transform).toContain('rotate(0deg)');

    await userEvent.keyboard('c');
    expect(calls).toContain('save-favorites');

    await userEvent.keyboard('o');
    expect(calls).toContain('show-in-folder');
  });

  test('Backspace 关闭查看器（先把信息面板关掉）', async () => {
    const onClose = renderViewer();
    await userEvent.click(screen.getByRole('button', { name: '图片信息' }));
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByRole('button', { name: '图片信息' })).toHaveAttribute('aria-pressed', 'false');
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.keyboard('{Backspace}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Delete 把当前图片移到废纸篓（二次确认）', async () => {
    const calls = [];
    window.electronAPI = {
      platform: 'darwin',
      invoke: jest.fn(async (channel) => {
        calls.push(channel);
        if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
        return { ok: true, success: true };
      })
    };
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(<ImageViewer images={IMAGES} initialIndex={0} title="套图" albumPath="/A/a" albumName="套图" onClose={jest.fn()} />);

    await userEvent.keyboard('{Delete}');
    await waitFor(() => expect(calls).toContain('trash-image'));
  });

  test('R 是随机看下一张（不是旋转）', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9);
    const { container } = render(
      <ImageViewer images={IMAGES} initialIndex={0} title="套图" albumPath="/A/a" albumName="套图" onClose={jest.fn()} />
    );
    const before = container.querySelector('.viewer-image, .viewer-pair img').style.transform;

    await userEvent.keyboard('r');
    await waitFor(() => expect(screen.getAllByText(/3 \/ 3/).length).toBeGreaterThan(0));
    expect(container.querySelector('.viewer-image, .viewer-pair img').style.transform).toBe(before);
    Math.random.mockRestore();
  });

  test('T 切换底部工具栏显示', async () => {
    renderViewer();
    const viewer = screen.getByRole('dialog', { name: '大图查看器' });
    expect(viewer.querySelector('.viewer-bar').className).toContain('hidden');

    await userEvent.keyboard('t');
    expect(viewer.querySelector('.viewer-bar').className).not.toContain('hidden');
    await userEvent.keyboard('t');
    expect(viewer.querySelector('.viewer-bar').className).toContain('hidden');
  });
});
