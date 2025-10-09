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

const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;
const { useAlbumImages } = require('../../../src/renderer/hooks/useAlbumImages');
const ipcRenderer = global.electronMock.ipcRenderer;

const defaultRequireImpl = (moduleName) =>
  moduleName === 'electron' ? global.electronMock : {};

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
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
    expect(imageCache.get).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('uses cache when cached data available', async () => {
    const cachedImages = [{ name: 'foo.jpg' }];
    imageCache.get.mockReturnValueOnce(cachedImages);

    const { result } = renderHook(() => useAlbumImages('/albums/2024'));

    await act(async () => {
      const data = await result.current.loadImages();
      expect(data).toEqual(cachedImages);
    });

    expect(result.current.images).toEqual(cachedImages);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    expect(imageCache.set).not.toHaveBeenCalled();
  });

  test('invokes IPC and caches result when cache miss', async () => {
    const mockImages = [{ name: 'a.jpg' }, { name: 'b.jpg' }];
    imageCache.get.mockReturnValueOnce(null);
    ipcRenderer.invoke.mockResolvedValueOnce(mockImages);

    const { result } = renderHook(() => useAlbumImages('/albums/holiday'));

    await act(async () => {
      const data = await result.current.loadImages();
      expect(data).toEqual(mockImages);
    });

    expect(imageCache.get).toHaveBeenCalledWith('album', '/albums/holiday');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.GET_ALBUM_IMAGES,
      '/albums/holiday'
    );
    expect(imageCache.set).toHaveBeenCalledWith('album', '/albums/holiday', mockImages);
    expect(result.current.images).toEqual(mockImages);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
  });

  test('exposes error state when IPC call fails', async () => {
    imageCache.get.mockReturnValueOnce(null);
    ipcRenderer.invoke.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useAlbumImages('/albums/error'));

    await act(async () => {
      const data = await result.current.loadImages();
      expect(data).toEqual([]);
    });

    expect(imageCache.set).not.toHaveBeenCalled();
    expect(result.current.images).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('加载相簿图片时出错: boom');
  });

  test('refresh clears cache and reloads album', async () => {
    const firstBatch = [{ name: 'old.jpg' }];
    const secondBatch = [{ name: 'new.jpg' }];

    imageCache.get.mockReturnValueOnce(null).mockReturnValueOnce(null);
    ipcRenderer.invoke
      .mockResolvedValueOnce(firstBatch)
      .mockResolvedValueOnce(secondBatch);

    const { result } = renderHook(() => useAlbumImages('/albums/refresh'));

    await act(async () => {
      await result.current.loadImages();
    });

    act(() => {
      result.current.refresh();
    });

    expect(imageCache.delete).toHaveBeenCalledWith('album', '/albums/refresh');

    await waitFor(() => {
      expect(imageCache.set).toHaveBeenLastCalledWith(
        'album',
        '/albums/refresh',
        secondBatch
      );
      expect(result.current.images).toEqual(secondBatch);
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(2);
  });
});
