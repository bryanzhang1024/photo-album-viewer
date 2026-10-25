import {
  loadFavorites,
  isFolderFavorited,
  toggleFolderFavorite,
  isImageFavorited
} from '../../src/ui/data/favorites';

function installMock(initial) {
  const state = { data: JSON.parse(JSON.stringify(initial)) };
  const calls = [];
  window.electronAPI = {
    invoke: jest.fn(async (channel, payload) => {
      calls.push([channel, payload]);
      if (channel === 'load-favorites') return JSON.parse(JSON.stringify(state.data));
      if (channel === 'save-favorites') {
        state.data = JSON.parse(JSON.stringify(payload));
        return { success: true };
      }
      return { ok: true, data: {} };
    })
  };
  return { state, calls };
}

describe('收藏 · 统一身份', () => {
  test('旧数据里 folders 与 albums 同路径的重复记录会合并成一条', async () => {
    installMock({
      folders: [{ path: '/A/x', name: 'x', kind: 'folder', imageCount: 3, addedAt: 2 }],
      albums: [{ path: '/A/x', name: 'x', kind: 'photoSet', imageCount: 5, previewImages: [], addedAt: 1 }],
      images: []
    });

    const favorites = await loadFavorites();
    const all = [...favorites.folders, ...favorites.albums].filter((item) => item.path === '/A/x');
    expect(all).toHaveLength(1);
    expect(all[0].imageCount).toBe(5);
  });

  test('身份只看路径：不管记录落在 folders 还是 albums，都算已收藏', async () => {
    installMock({ folders: [{ path: '/A/x', name: 'x', kind: 'folder' }], albums: [], images: [] });
    const favorites = await loadFavorites();
    expect(isFolderFavorited(favorites, '/A/x')).toBe(true);
    expect(isFolderFavorited(favorites, '/A/y')).toBe(false);
  });

  test('收藏一个文件夹后再取消，两个数组都会被清掉', async () => {
    const { state } = installMock({ folders: [], albums: [], images: [] });
    await toggleFolderFavorite({ path: '/A/x', name: 'x', kind: 'folder', imageCount: 3 });
    expect(state.data.folders.map((item) => item.path)).toEqual(['/A/x']);

    await toggleFolderFavorite({ path: '/A/x', name: 'x', kind: 'folder', imageCount: 3 });
    expect(state.data.folders).toHaveLength(0);
    expect(state.data.albums).toHaveLength(0);
  });

  test('内容类型变化不丢收藏：相簿变成普通文件夹后再切一次仍是取消，不会出现两条', async () => {
    const { state } = installMock({ folders: [], albums: [], images: [] });
    await toggleFolderFavorite({ path: '/A/x', name: 'x', kind: 'photoSet', imageCount: 3 });
    expect(state.data.albums).toHaveLength(1);

    // 目录里加了子文件夹，内容类型变了，但路径没变
    const favorites = await loadFavorites();
    expect(isFolderFavorited(favorites, '/A/x')).toBe(true);

    await toggleFolderFavorite({ path: '/A/x', name: 'x', kind: 'folder', imageCount: 3 });
    expect(state.data.albums).toHaveLength(0);
    expect(state.data.folders).toHaveLength(0);
  });

  test('图片收藏仍按路径判断', async () => {
    installMock({ folders: [], albums: [], images: [{ path: '/A/x/1.jpg', name: '1.jpg' }] });
    const favorites = await loadFavorites();
    expect(isImageFavorited(favorites, '/A/x/1.jpg')).toBe(true);
    expect(isImageFavorited(favorites, '/A/x/2.jpg')).toBe(false);
  });
});
