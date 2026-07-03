import { renderHook, act, waitFor } from '@testing-library/react';
import CHANNELS from '../../../src/common/ipc-channels';

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn()
  }
}));

const { useAlbumImages, DEFAULT_ALBUM_PAGE_SIZE } = require('../../../src/renderer/hooks/useAlbumImages');
const ipcRenderer = global.electronMock.ipcRenderer;

const defaultRequireImpl = (moduleName) =>
  moduleName === 'electron' ? global.electronMock : {};

const pageResponse = (images, { totalCount = images.length, offset = 0, hasMore = false, globalIndex = null } = {}) => ({
  success: true,
  images,
  totalCount,
  offset,
  limit: DEFAULT_ALBUM_PAGE_SIZE,
  hasMore,
  globalIndex
});

describe('useAlbumImages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.require.mockImplementation(defaultRequireImpl);
  });

  test('returns empty result when albumPath missing', async () => {
    const { result } = renderHook(() => useAlbumImages(''));

    await act(async () => {
      const data = await result.current.loadImages();
      expect(data).toEqual([]);
    });

    expect(result.current.images).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasMore).toBe(false);
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('loads first page with pagination envelope', async () => {
    const mockImages = [{ path: '/albums/holiday/1.jpg', name: '1.jpg' }];
    ipcRenderer.invoke.mockResolvedValueOnce(pageResponse(mockImages, { totalCount: 250, hasMore: true }));

    const { result } = renderHook(() => useAlbumImages('/albums/holiday'));

    await act(async () => {
      await result.current.loadImages();
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/holiday',
      expect.objectContaining({
        offset: 0,
        limit: DEFAULT_ALBUM_PAGE_SIZE,
        sortBy: 'name',
        sortDirection: 'asc'
      })
    );
    expect(result.current.images).toEqual(mockImages);
    expect(result.current.totalCount).toBe(250);
    expect(result.current.hasMore).toBe(true);
  });

  test('loadMore appends the next page', async () => {
    const firstPage = [{ path: '/albums/holiday/1.jpg', name: '1.jpg' }];
    const secondPage = [{ path: '/albums/holiday/2.jpg', name: '2.jpg' }];

    ipcRenderer.invoke
      .mockResolvedValueOnce(pageResponse(firstPage, { totalCount: 2, hasMore: true }))
      .mockResolvedValueOnce(pageResponse(secondPage, { offset: 1, totalCount: 2, hasMore: false }));

    const { result } = renderHook(() => useAlbumImages('/albums/holiday', { pageSize: 1 }));

    await act(async () => {
      await result.current.loadImages();
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.images).toEqual([...firstPage, ...secondPage]);
    expect(result.current.hasMore).toBe(false);
  });

  test('ensureImageLoaded requests page containing target image', async () => {
    const targetPage = [
      { path: '/albums/holiday/201.jpg', name: '201.jpg' }
    ];

    ipcRenderer.invoke.mockResolvedValueOnce(pageResponse(targetPage, {
      totalCount: 250,
      offset: 200,
      hasMore: true,
      globalIndex: 200
    }));

    const { result } = renderHook(() => useAlbumImages('/albums/holiday'));

    await act(async () => {
      const located = await result.current.ensureImageLoaded('/albums/holiday/201.jpg');
      expect(located.globalIndex).toBe(200);
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/holiday',
      expect.objectContaining({
        locatePath: '/albums/holiday/201.jpg'
      })
    );
  });

  test('refresh bypasses main-process album metadata cache and reloads', async () => {
    const firstBatch = [{ path: '/albums/refresh/1.jpg', name: '1.jpg' }];
    const secondBatch = [{ path: '/albums/refresh/2.jpg', name: '2.jpg' }];

    ipcRenderer.invoke
      .mockResolvedValueOnce(pageResponse(firstBatch))
      .mockResolvedValueOnce(pageResponse(secondBatch));

    const { result } = renderHook(() => useAlbumImages('/albums/refresh'));

    await act(async () => {
      await result.current.loadImages();
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/refresh',
      expect.objectContaining({
        forceRefresh: true
      })
    );

    await waitFor(() => {
      expect(result.current.images).toEqual(secondBatch);
    });
  });

  test('removeImage updates local state and total count', async () => {
    const mockImages = [
      { path: '/albums/trip/a.jpg', name: 'a.jpg' },
      { path: '/albums/trip/b.jpg', name: 'b.jpg' }
    ];

    ipcRenderer.invoke.mockResolvedValueOnce(pageResponse(mockImages, { totalCount: 2 }));

    const { result } = renderHook(() => useAlbumImages('/albums/trip'));

    await act(async () => {
      await result.current.loadImages();
    });

    act(() => {
      result.current.removeImage('/albums/trip/a.jpg');
    });

    expect(result.current.images).toEqual([{ path: '/albums/trip/b.jpg', name: 'b.jpg' }]);
    expect(result.current.totalCount).toBe(1);
  });
});
