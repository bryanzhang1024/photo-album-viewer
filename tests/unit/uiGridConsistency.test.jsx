import React from 'react';
import { render, screen } from '@testing-library/react';

import FolderPage from '../../src/ui/features/folder/FolderPage';
import CosSetListPage from '../../src/ui/features/cos/CosSetListPage';
import CosSetAlbumPage from '../../src/ui/features/cos/CosSetAlbumPage';
import { getFolderDensity, setFolderDensity, DEFAULT_DENSITY } from '../../src/ui/data/prefs';

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const SIZE = 844800; // 825 KB
const MTIME = new Date(2022, 11, 7).getTime();

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
  if (channel === 'list-directory-files-v1') return { success: true, files: [] };
  return { ok: true, data: {} };
}

describe('网格与卡片一致性（S1）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  test('缺省缩略图密度是紧凑档（148），与照片来源现状一致', () => {
    expect(DEFAULT_DENSITY).toBe(0);
    expect(getFolderDensity('src_a', '')).toBe(0);
    setFolderDensity('src_a', '', 2);
    expect(getFolderDensity('src_a', '')).toBe(2);
    window.localStorage.removeItem('pav.density.v1:src_a:');
    expect(getFolderDensity('src_a', '')).toBe(0);
  });

  test('文件夹卡与 Cos 照片卡共用同一套卡片结构和次行文字', async () => {
    installMock((channel, arg) => {
      if (channel === 'get-directory-level-v1') {
        return {
          ok: true,
          data: {
            locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
            facts: { childDirectoryCount: 0, directMediaCount: 1 },
            children: [],
            directMedia: [{ relativePath: '001.jpg', name: '001.jpg', size: SIZE, mtimeMs: MTIME }],
            approximate: { coverSamples: [] }
          }
        };
      }
      if (channel === 'cos-get-set') return { displayName: '套图一', locations: [{ relativePath: '套图一' }] };
      if (channel === 'cos-get-set-images') {
        return {
          images: [{ path: '/A/001.jpg', name: '001.jpg', size: SIZE, lastModified: new Date(MTIME) }],
          totalCount: 1,
          hasMore: false
        };
      }
      return base(channel);
    });

    const folder = render(
      <FolderPage source={SOURCE} relativePath="" viewMode="grid" onOpenFolder={jest.fn()} onOpenRoots={jest.fn()} />
    );
    await screen.findByText('001.jpg');
    const folderCard = folder.container.querySelector('.grid-card');
    expect(folderCard.querySelector('.grid-card-cover')).toBeTruthy();
    expect(folderCard.querySelector('.grid-card-name').textContent).toBe('001.jpg');
    expect(folderCard.querySelector('.grid-card-meta').textContent).toBe('825 KB · 2022年12月7日');
    folder.unmount();

    const cos = render(<CosSetAlbumPage setId="s1" setName="套图一" options={null} />);
    await screen.findByText('001.jpg');
    const cosCard = cos.container.querySelector('.grid-card');
    expect(cosCard.querySelector('.grid-card-cover')).toBeTruthy();
    expect(cosCard.querySelector('.grid-card-name').textContent).toBe('001.jpg');
    expect(cosCard.querySelector('.grid-card-meta').textContent).toBe('825 KB · 2022年12月7日');
  });

  test('套图列表用同一套卡片结构，名字与次行仍走 Cos 规则', async () => {
    installMock((channel) => {
      if (channel === 'cos-list-sets') {
        return {
          items: [{
            id: 's1',
            displayName: '玛吉｜流萤（作品A）',
            imageCount: 8,
            coverMediaId: null
          }],
          total: 1
        };
      }
      return base(channel);
    });

    const { container } = render(
      <CosSetListPage viewKind="cosers" entity={{ id: 'coser1', name: '玛吉' }} onOpenSet={jest.fn()} />
    );

    await screen.findByText('流萤');
    const card = container.querySelector('.grid-card');
    expect(card.querySelector('.grid-card-cover')).toBeTruthy();
    expect(card.querySelector('.grid-card-name').textContent).toBe('流萤');
    expect(card.querySelector('.grid-card-meta').textContent).toBe('8 张');
  });
});
