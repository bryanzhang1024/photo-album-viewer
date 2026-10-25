import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FavoritesPage from '../../src/ui/features/favorites/FavoritesPage';

const DATA = {
  folders: [
    { id: 'f1', kind: 'folder', path: '/A/x', name: '收藏的文件夹', addedAt: 3, imageCount: 8, sourceId: 'src_a', relativePath: 'x' }
  ],
  albums: [
    { id: 'a1', kind: 'photoSet', path: '/A/y', name: '收藏的相簿', addedAt: 2, imageCount: 5, sourceId: 'src_a', relativePath: 'y' }
  ],
  images: [
    { id: 'i1', path: '/A/x/1.jpg', name: '1.jpg', size: 2048, addedAt: 1, albumName: 'x' }
  ]
};

function installMock() {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel) => {
      if (channel === 'load-favorites') return JSON.parse(JSON.stringify(DATA));
      if (channel === 'save-favorites') return { success: true };
      return { ok: true, data: {} };
    })
  };
}

describe('收藏页', () => {
  beforeEach(() => {
    window.localStorage.clear();
    installMock();
  });

  test('文件夹与相簿共用「文件夹」词，不再混用「相簿」', async () => {
    render(<FavoritesPage />);
    await screen.findByText('收藏的文件夹');
    expect(screen.getAllByText(/文件夹/).length).toBeGreaterThan(0);
    expect(screen.queryByText('相簿')).not.toBeInTheDocument();
  });

  test('图片标签支持列表视图（4.0 里点了没反应）', async () => {
    const { container } = render(<FavoritesPage />);
    await screen.findByText('收藏的文件夹');

    await userEvent.click(screen.getByRole('button', { name: /图片/ }));
    await waitFor(() => expect(container.querySelector('.fav-grid')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: '列表视图' }));
    await waitFor(() => expect(container.querySelectorAll('.fav-row').length).toBe(1));
    expect(container.querySelector('.fav-grid')).toBeNull();
  });

  test('收藏页可切换排序字段与方向', async () => {
    render(<FavoritesPage />);
    await screen.findByText('收藏的文件夹');

    const select = screen.getByRole('combobox', { name: '排序' });
    await userEvent.selectOptions(select, 'name');
    expect(select).toHaveValue('name');

    // 默认按收藏时间倒序，点一下变升序
    await userEvent.click(screen.getByRole('button', { name: /降序，点击改为升序/ }));
    expect(screen.getByRole('button', { name: /升序，点击改为降序/ })).toHaveAttribute('aria-pressed', 'false');
  });
});
