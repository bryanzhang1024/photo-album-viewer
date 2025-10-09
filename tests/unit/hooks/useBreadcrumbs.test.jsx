import { renderHook, act } from '@testing-library/react';
import CHANNELS from '../../../src/common/ipc-channels';

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn()
  }
}));

jest.mock('../../../src/renderer/utils/pathUtils', () => ({
  __esModule: true,
  getBreadcrumbPaths: jest.fn()
}));

const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;
const { getBreadcrumbPaths } = require('../../../src/renderer/utils/pathUtils');
const { useBreadcrumbs } = require('../../../src/renderer/hooks/useBreadcrumbs');
const ipcRenderer = global.electronMock.ipcRenderer;

const defaultRequireImpl = (moduleName) =>
  moduleName === 'electron' ? global.electronMock : {};

describe('useBreadcrumbs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.require.mockImplementation(defaultRequireImpl);
  });

  test('clears state when albumPath missing', async () => {
    const { result } = renderHook(() => useBreadcrumbs('', '/root'));

    await act(async () => {
      await result.current.loadBreadcrumbs();
    });

    expect(result.current.breadcrumbs).toEqual([]);
    expect(result.current.metadata).toBeNull();
    expect(imageCache.get).not.toHaveBeenCalled();
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
  });

  test('reuses cached navigation data', async () => {
    const cachedResponse = {
      breadcrumbs: [
        { name: 'root', path: '/root' },
        { name: 'albums', path: '/root/albums' }
      ],
      metadata: { totalNodes: 3 }
    };

    imageCache.get.mockReturnValueOnce(cachedResponse);

    const { result } = renderHook(() =>
      useBreadcrumbs('/root/albums', '/root')
    );

    await act(async () => {
      await result.current.loadBreadcrumbs();
    });

    expect(result.current.breadcrumbs).toEqual(cachedResponse.breadcrumbs);
    expect(result.current.metadata).toEqual(cachedResponse.metadata);
    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    expect(imageCache.set).not.toHaveBeenCalled();
  });

  test('fetches navigation info over IPC on cache miss', async () => {
    const response = {
      success: true,
      breadcrumbs: [
        { name: 'root', path: '/root' },
        { name: 'albums', path: '/root/albums' },
        { name: 'trip', path: '/root/albums/trip' }
      ],
      metadata: { totalNodes: 5, albumCount: 2 }
    };

    imageCache.get.mockReturnValueOnce(null);
    ipcRenderer.invoke.mockResolvedValueOnce(response);

    const { result } = renderHook(() =>
      useBreadcrumbs('/root/albums/trip', '/root')
    );

    await act(async () => {
      await result.current.loadBreadcrumbs();
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.SCAN_NAVIGATION_LEVEL,
      '/root/albums/trip'
    );
    expect(imageCache.set).toHaveBeenCalledWith(
      'navigation',
      '/root/albums/trip',
      response
    );
    expect(result.current.breadcrumbs).toEqual(response.breadcrumbs);
    expect(result.current.metadata).toEqual(response.metadata);
  });

  test('falls back to local breadcrumb calculation on failed response', async () => {
    const fallback = [
      { name: 'root', path: '/root' },
      { name: 'manual', path: '/root/manual' }
    ];

    imageCache.get.mockReturnValueOnce(null);
    ipcRenderer.invoke.mockResolvedValueOnce({ success: false });
    getBreadcrumbPaths.mockReturnValueOnce(fallback);

    const { result } = renderHook(() =>
      useBreadcrumbs('/root/manual', '/root')
    );

    await act(async () => {
      await result.current.loadBreadcrumbs();
    });

    expect(result.current.breadcrumbs).toEqual(fallback);
    expect(result.current.metadata).toBeNull();
    expect(imageCache.set).not.toHaveBeenCalled();
  });

  test('falls back when IPC throws error', async () => {
    const fallback = [
      { name: 'root', path: '/root' },
      { name: 'error', path: '/root/error' }
    ];

    imageCache.get.mockReturnValueOnce(null);
    ipcRenderer.invoke.mockRejectedValueOnce(new Error('ipc failed'));
    getBreadcrumbPaths.mockReturnValueOnce(fallback);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() =>
      useBreadcrumbs('/root/error', '/root')
    );

    await act(async () => {
      await result.current.loadBreadcrumbs();
    });

    expect(result.current.breadcrumbs).toEqual(fallback);
    expect(result.current.metadata).toBeNull();
    expect(imageCache.set).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
