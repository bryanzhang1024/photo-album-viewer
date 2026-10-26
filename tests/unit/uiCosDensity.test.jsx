import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../src/ui/components/VirtualGrid', () => {
  const React = require('react');
  const stub = (props) => {
    stub.calls.push(props);
    return React.createElement('div', { 'data-testid': 'virtual-grid' });
  };
  stub.calls = [];
  return { __esModule: true, default: stub };
});

import VirtualGrid from '../../src/ui/components/VirtualGrid';
import CosSetListPage from '../../src/ui/features/cos/CosSetListPage';
import CosSetAlbumPage from '../../src/ui/features/cos/CosSetAlbumPage';

const SET = {
  id: 's1',
  displayName: '流萤（作品A）',
  imageCount: 8,
  coverMediaId: null,
  favoriteTargets: [{ path: '/300/流萤（作品A）', online: true, previewImagePath: null }]
};

function installMock(handler) {
  window.electronAPI = {
    platform: 'darwin',
    invoke: jest.fn(async (channel, ...args) => handler(channel, ...args))
  };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}

function base(channel) {
  if (channel === 'load-favorites') return { folders: [], albums: [], images: [] };
  if (channel === 'cos-get-set') return SET;
  if (channel === 'cos-get-set-images') {
    return { images: [{ path: '/A/001.jpg', name: '001.jpg', size: 1024, lastModified: new Date() }], totalCount: 1, hasMore: false };
  }
  return { ok: true, data: {} };
}

describe('Cos 缩略图滑杆真正改变网格（4.5.1）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    VirtualGrid.calls = [];
  });

  test('套图列表：滑杆从紧凑切到舒适，传给网格的最小卡宽从 148 变 196', async () => {
    installMock((channel) => (channel === 'cos-list-sets' ? { items: [SET], total: 1 } : base(channel)));
    render(<CosSetListPage viewKind="all" onOpenSet={jest.fn()} />);

    await waitFor(() => expect(VirtualGrid.calls.length).toBeGreaterThan(0));
    expect(VirtualGrid.calls[VirtualGrid.calls.length - 1].minItemWidth).toBe(148);

    fireEvent.change(screen.getByRole('slider', { name: '缩略图大小' }), { target: { value: '2' } });
    await waitFor(() => {
      expect(VirtualGrid.calls[VirtualGrid.calls.length - 1].minItemWidth).toBe(196);
    });
    expect(window.localStorage.getItem('pav.cos.density.v1')).toBe('2');
  });

  test('套图照片页：滑杆同样生效', async () => {
    installMock((channel) => base(channel));
    render(<CosSetAlbumPage setId="s1" setName="流萤（作品A）" options={null} onNavigate={jest.fn()} />);

    await waitFor(() => expect(VirtualGrid.calls.length).toBeGreaterThan(0));
    expect(VirtualGrid.calls[VirtualGrid.calls.length - 1].minItemWidth).toBe(148);

    fireEvent.change(screen.getByRole('slider', { name: '缩略图大小' }), { target: { value: '1' } });
    await waitFor(() => {
      expect(VirtualGrid.calls[VirtualGrid.calls.length - 1].minItemWidth).toBe(168);
    });
  });
});
