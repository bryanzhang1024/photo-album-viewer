import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CHANNELS from '../../../src/common/ipc-channels';
import CosLibraryPage from '../../../src/renderer/pages/CosLibraryPage';

jest.mock('react-virtuoso', () => ({
  Virtuoso: ({ data = [], itemContent }) => (
    <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>
  )
}));

jest.mock('../../../src/renderer/pages/AlbumPage', () => ({ tabsHeaderContent, readOnly }) => (
  <div data-testid="cos-album-page" data-read-only={String(readOnly)}>
    {tabsHeaderContent}
  </div>
));

function readyStatus() {
  return {
    state: 'ready',
    roots: [{ id: 'root:one', label: '300-Cos套图库', status: 'online' }],
    summary: {
      setCount: 8891,
      characterCount: 1287,
      coserCount: 587,
      lookCount: 4766,
      imageCount: 352719,
      errorCount: 0
    },
    cached: true,
    lastIndexedAt: 1234,
    errors: []
  };
}

describe('CosLibraryPage', () => {
  beforeEach(() => {
    window.electronAPI.invoke = jest.fn(async (channel, payload) => {
      switch (channel) {
        case CHANNELS.COS_GET_STATUS:
          return readyStatus();
        case CHANNELS.COS_LIST_CHARACTERS:
          return { items: [{ id: 'character:初音未来', name: '初音未来', setCount: 110 }], total: 1 };
        case CHANNELS.COS_LIST_LOOKS:
          return { items: [{ id: 'look:兔子洞', name: '兔子洞', setCount: 7 }], total: 1 };
        case CHANNELS.COS_LIST_SETS:
          return {
            items: [{
              id: 'set-one',
              displayName: '兔子洞写真套图',
              cosers: ['Alice', 'Bob', 'Carol'],
              characters: ['初音未来'],
              looks: ['兔子洞'],
              imageCount: 48,
              coverMediaId: 'media:one',
              status: 'online'
            }],
            total: 7,
            offset: 0,
            limit: 200
          };
        case CHANNELS.COS_GET_MEDIA_THUMBNAIL:
          return 'thumbnail-protocol://cover.webp';
        case CHANNELS.COS_GET_SET_ALBUM_PATH:
          return '/library/set-one';
        case CHANNELS.COS_OPEN_IN_PICTUREVIEW:
        case CHANNELS.COS_SHOW_SET_IN_FOLDER:
          return { success: true };
        default:
          return null;
      }
    });
    window.electronAPI.on = jest.fn();
    window.electronAPI.removeListener = jest.fn();
  });

  test('navigates character to look to a compact set card and opens the existing album view', async () => {
    render(
      <MemoryRouter>
        <CosLibraryPage />
      </MemoryRouter>
    );

    expect(await screen.findByText('8,891 套')).toBeInTheDocument();
    expect(screen.getByText('1,287 个角色')).toBeInTheDocument();
    expect(screen.getByText('587 位 Coser')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /按角色/ }));
    fireEvent.click(await screen.findByRole('button', { name: /初音未来/ }));
    fireEvent.click(await screen.findByRole('button', { name: /兔子洞/ }));

    const setCard = await screen.findByRole('button', { name: /兔子洞写真套图/ });
    expect(setCard).toHaveTextContent('48 张');
    expect(setCard).toHaveTextContent('Alice');
    expect(setCard).toHaveTextContent('Bob');
    expect(setCard).toHaveTextContent('+1');
    expect(setCard).not.toHaveTextContent('初音未来');

    fireEvent.click(setCard);
    expect(await screen.findByTestId('cos-album-page')).toHaveAttribute('data-read-only', 'true');
    fireEvent.click(screen.getByRole('button', { name: '用 PictureView 打开' }));
    fireEvent.click(screen.getByRole('button', { name: '在 Finder 中显示' }));

    await waitFor(() => {
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(CHANNELS.COS_OPEN_IN_PICTUREVIEW, 'set-one');
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(CHANNELS.COS_SHOW_SET_IN_FOLDER, 'set-one');
    });
  });

  test('offers root selection when the Cos library has not been configured', async () => {
    window.electronAPI.invoke.mockImplementation(async (channel) => {
      if (channel === CHANNELS.COS_GET_STATUS) {
        return { state: 'empty', roots: [], summary: { setCount: 0 }, errors: [] };
      }
      if (channel === CHANNELS.COS_SELECT_ROOT) return readyStatus();
      return null;
    });

    render(
      <MemoryRouter>
        <CosLibraryPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: '添加图库根目录' }));
    await waitFor(() => {
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(CHANNELS.COS_SELECT_ROOT);
    });
  });
});
