import { renderHook, act } from '@testing-library/react';

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  get: jest.fn(),
  set: jest.fn()
}));

jest.mock('../../../src/renderer/utils/pathUtils', () => {
  const actual = jest.requireActual('../../../src/renderer/utils/pathUtils');
  return {
    ...actual,
    getDirname: jest.fn((p) => actual.getDirname(p))
  };
});

const imageCache = require('../../../src/renderer/utils/ImageCacheManager');
const CHANNELS = require('../../../src/common/ipc-channels');
const ipcRenderer = { invoke: jest.fn() };

window.require = jest.fn((module) => {
  if (module === 'electron') {
    return { ipcRenderer };
  }
  return {};
});

const { useNeighboringAlbums } = require('../../../src/renderer/hooks/useNeighboringAlbums');

describe('useNeighboringAlbums', () => {

  beforeEach(() => {
    ipcRenderer.invoke.mockReset();
    imageCache.get.mockReset();
    imageCache.set.mockReset();
    localStorage.clear();
  });

  const createResponse = () => ({
    success: true,
    nodes: [
      { type: 'folder', name: 'Misc', path: '/photos/Misc' },
      { type: 'album', name: 'Album1', path: '/photos/Album1', imageCount: 5, lastModified: '2024-01-01' },
      { type: 'album', name: 'Album2', path: '/photos/Album2', imageCount: 8, lastModified: '2024-01-02' },
      { type: 'album', name: 'Album3', path: '/photos/Album3', imageCount: 3, lastModified: '2024-01-03' }
    ],
    metadata: { folderCount: 1, albumCount: 3 }
  });

  test('loads neighboring albums via ipc when cache misses', async () => {
    imageCache.get.mockReturnValue(null);
    const response = createResponse();
    ipcRenderer.invoke.mockResolvedValue(response);
    localStorage.setItem('sortBy', 'name');
    localStorage.setItem('sortDirection', 'asc');

    const { result } = renderHook(() => useNeighboringAlbums('/photos/Album2'));

    await act(async () => {
      await result.current.loadNeighboringAlbums();
    });

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      CHANNELS.SCAN_NAVIGATION_LEVEL,
      '/photos'
    );
    expect(imageCache.set).toHaveBeenCalledWith('navigation', '/photos', response);
    expect(result.current.neighboringAlbums.prev.name).toBe('Album1');
    expect(result.current.neighboringAlbums.next.name).toBe('Album3');
    expect(result.current.neighboringAlbums.total).toBe(3);
    expect(result.current.siblingAlbums.map((a) => a.name)).toEqual([
      'Album1',
      'Album2',
      'Album3'
    ]);
  });

  test('uses cached response when available', async () => {
    const response = createResponse();
    imageCache.get.mockReturnValue(response);

    const { result } = renderHook(() => useNeighboringAlbums('/photos/Album1'));

    await act(async () => {
      await result.current.loadNeighboringAlbums();
    });

    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    expect(imageCache.set).not.toHaveBeenCalled();
    expect(result.current.neighboringAlbums.prev).toBeNull();
    expect(result.current.neighboringAlbums.next.name).toBe('Album2');
  });

  test('skips loading when albumPath missing', async () => {
    const { result } = renderHook(() => useNeighboringAlbums(''));

    await act(async () => {
      await result.current.loadNeighboringAlbums();
    });

    expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    expect(result.current.neighboringAlbums.total).toBe(0);
  });

  test('handles errors by resetting state', async () => {
    imageCache.get.mockReturnValue(null);
    ipcRenderer.invoke.mockRejectedValue(new Error('boom'));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useNeighboringAlbums('/photos/AlbumX'));

    await act(async () => {
      await result.current.loadNeighboringAlbums();
    });

    expect(result.current.neighboringAlbums.total).toBe(0);
    expect(result.current.siblingAlbums).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
