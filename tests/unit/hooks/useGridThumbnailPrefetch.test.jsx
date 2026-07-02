import { renderHook, act, waitFor } from '@testing-library/react';
import CHANNELS from '../../../src/common/ipc-channels';

jest.mock('../../../src/renderer/utils/ImageCacheManager', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn()
  }
}));

const imageCache = require('../../../src/renderer/utils/ImageCacheManager').default;
const {
  useGridThumbnailPrefetch,
  extractAlbumImageRowPaths,
  extractHomePageRowPaths,
  extractFavoriteAlbumRowPaths
} = require('../../../src/renderer/hooks/useGridThumbnailPrefetch');
const ipcRenderer = global.electronMock.ipcRenderer;

describe('useGridThumbnailPrefetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    imageCache.get.mockReturnValue(null);
    ipcRenderer.invoke.mockResolvedValue({});
  });

  test('extractors collect image paths from mixed rows', () => {
    expect(extractAlbumImageRowPaths([{ path: '/a.jpg' }, { path: '/b.jpg' }])).toEqual(['/a.jpg', '/b.jpg']);
    expect(extractHomePageRowPaths([
      { itemKind: 'image', image: { path: '/direct.jpg' } },
      { itemKind: 'node', node: { samples: ['/sample.jpg'] } }
    ])).toEqual(['/direct.jpg', '/sample.jpg']);
    expect(extractFavoriteAlbumRowPaths([
      { previewSamples: ['/cover.jpg'] }
    ])).toEqual(['/cover.jpg']);
  });

  test('prefetches initial visible rows on mount', async () => {
    const gridRows = [
      [{ path: '/photos/1.jpg' }, { path: '/photos/2.jpg' }],
      [{ path: '/photos/3.jpg' }]
    ];

    ipcRenderer.invoke.mockResolvedValue({
      '/photos/1.jpg': '1.webp',
      '/photos/2.jpg': '2.webp',
      '/photos/3.jpg': '3.webp'
    });

    renderHook(() => useGridThumbnailPrefetch({
      gridRows,
      extractPathsFromRow: extractAlbumImageRowPaths
    }));

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.GET_BATCH_THUMBNAILS,
        expect.arrayContaining(['/photos/1.jpg', '/photos/2.jpg', '/photos/3.jpg']),
        0
      );
    });
  });

  test('handleRangeChanged prefetches visible and nearby rows with priorities', async () => {
    const gridRows = Array.from({ length: 6 }, (_, rowIndex) => (
      [{ path: `/photos/${rowIndex + 1}.jpg` }]
    ));

    const { result } = renderHook(() => useGridThumbnailPrefetch({
      gridRows,
      extractPathsFromRow: extractAlbumImageRowPaths,
      rowsAhead: 1,
      rowsBehind: 1
    }));

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalled();
    });

    jest.clearAllMocks();

    act(() => {
      result.current.handleRangeChanged({ startIndex: 2, endIndex: 2 });
    });

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.GET_BATCH_THUMBNAILS,
        ['/photos/3.jpg'],
        0
      );
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.GET_BATCH_THUMBNAILS,
        ['/photos/2.jpg'],
        1
      );
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        CHANNELS.GET_BATCH_THUMBNAILS,
        ['/photos/4.jpg'],
        1
      );
    });
  });

  test('skips prefetch when disabled', async () => {
    renderHook(() => useGridThumbnailPrefetch({
      gridRows: [[{ path: '/photos/1.jpg' }]],
      extractPathsFromRow: extractAlbumImageRowPaths,
      enabled: false
    }));

    await waitFor(() => {
      expect(ipcRenderer.invoke).not.toHaveBeenCalled();
    });
  });
});
