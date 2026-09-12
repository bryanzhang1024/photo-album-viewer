import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import CHANNELS from '../../../src/common/ipc-channels';
import CosLibraryPage from '../../../src/renderer/pages/CosLibraryPage';

jest.mock('react-virtuoso', () => ({
  Virtuoso: ({ data = [], itemContent, scrollerRef, style }) => (
    <div ref={scrollerRef} data-testid="cos-virtual-grid" style={style}>
      {data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}
    </div>
  )
}));

jest.mock('../../../src/renderer/pages/AlbumPage', () => ({
  embeddedMode,
  headerLeadingContent,
  headerExtraActions,
  readOnly,
  collectionSetId,
  albumPath
}) => (
  <div
    data-testid="cos-album-page"
    data-embedded-mode={String(embeddedMode)}
    data-read-only={String(readOnly)}
    data-set-id={collectionSetId}
    data-album-path={albumPath}
  >
    {headerLeadingContent}
    {headerExtraActions}
    <button type="button" onClick={() => localStorage.setItem('userDensity', 'compact')}>模拟相簿密度</button>
  </div>
));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function BrowserBackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>浏览器返回</button>;
}

function renderCosPage(initialEntry = '/cos') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <CosLibraryPage />
      <LocationProbe />
      <BrowserBackButton />
    </MemoryRouter>
  );
}

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
    facets: { types: ['原创写真'], themes: ['公共浴室'] },
    errors: []
  };
}

describe('CosLibraryPage', () => {
  beforeEach(() => {
    localStorage.clear();
    window.electronAPI.invoke = jest.fn(async (channel, payload) => {
      switch (channel) {
        case CHANNELS.COS_GET_STATUS:
          return readyStatus();
        case CHANNELS.COS_LIST_CHARACTERS:
          return { items: [{ id: 'character:初音未来', name: '初音未来', setCount: 110 }], total: 1 };
        case CHANNELS.COS_LIST_LOOKS:
          if (payload?.query) return { items: [], total: 0 };
          return { items: [{ id: 'look:兔子洞', name: '兔子洞', setCount: 7 }], total: 1 };
        case CHANNELS.COS_LIST_COSERS:
          if (payload?.query) {
            return { items: [{ id: 'coser:Aki', name: 'Aki', setCount: 1 }], total: 1 };
          }
          return {
            items: [
              { id: 'coser:Alice', name: 'Alice', setCount: 2 },
              { id: 'coser:__singletons__', name: '其他', coserCount: 292, setCount: 279 },
              { id: 'coser:__unknown__', name: '未知 Coser', setCount: 204 }
            ],
            total: 3
          };
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
        case CHANNELS.COS_GET_SET:
          return { id: 'set-one', displayName: '兔子洞写真套图' };
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
    renderCosPage();

    expect(await screen.findByText('8,891 项')).toBeInTheDocument();
    expect(screen.getByText('1,287 个角色')).toBeInTheDocument();
    expect(screen.getByText('587 个署名')).toBeInTheDocument();
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
    const albumPage = await screen.findByTestId('cos-album-page');
    expect(albumPage).toHaveAttribute('data-read-only', 'true');
    expect(albumPage).toHaveAttribute('data-embedded-mode', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent('/cos/album?');
    expect(albumPage).toHaveTextContent('兔子洞写真套图');
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

    renderCosPage();

    fireEvent.click(await screen.findByRole('button', { name: '添加图库根目录' }));
    await waitFor(() => {
      expect(window.electronAPI.invoke).toHaveBeenCalledWith(CHANNELS.COS_SELECT_ROOT);
    });
  });

  test('shows one Other card for one-set cosers and opens their deduplicated set grid', async () => {
    renderCosPage();

    fireEvent.click(await screen.findByRole('button', { name: /按署名/ }));
    const otherCard = await screen.findByRole('button', { name: /其他/ });
    expect(otherCard).toHaveTextContent('292 个署名 · 279 项');
    fireEvent.click(otherCard);

    const setCard = await screen.findByRole('button', { name: /兔子洞写真套图/ });
    expect(setCard).toHaveTextContent('Alice');
    expect(window.electronAPI.invoke).toHaveBeenCalledWith(
      CHANNELS.COS_LIST_SETS,
      expect.objectContaining({ coserId: 'coser:__singletons__' })
    );
  });

  test('keeps a one-set coser directly findable from the Coser search box', async () => {
    renderCosPage();

    fireEvent.click(await screen.findByRole('button', { name: /按署名/ }));
    fireEvent.change(await screen.findByPlaceholderText('搜索当前分类'), { target: { value: 'Aki' } });

    expect(await screen.findByRole('button', { name: /Aki/ })).toHaveTextContent('1 项');
    expect(window.electronAPI.invoke).toHaveBeenCalledWith(
      CHANNELS.COS_LIST_COSERS,
      expect.objectContaining({ query: 'Aki', groupSingletons: true })
    );
  });

  test('restores a Cos category directly from its URL', async () => {
    renderCosPage('/cos/cosers');

    expect(await screen.findByRole('button', { name: /其他/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /按角色/ })).not.toBeInTheDocument();
  });

  test('gives the virtual card grid the remaining viewport height', async () => {
    renderCosPage('/cos/cosers');

    expect(await screen.findByTestId('cos-virtual-grid')).toHaveStyle({ flex: '1', minHeight: '0' });
  });

  test('restores an album parent from a deep link and returns to it', async () => {
    const from = encodeURIComponent('/cos/cosers');
    renderCosPage(`/cos/album?set=set-one&from=${from}`);

    const albumPage = await screen.findByTestId('cos-album-page');
    expect(albumPage).toHaveTextContent('Cos 图库 / 署名');
    expect(albumPage).toHaveTextContent('兔子洞写真套图');

    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/cos/cosers');
    expect(await screen.findByRole('button', { name: /其他/ })).toBeInTheDocument();
  });

  test('uses Backspace for semantic parent navigation outside editable fields', async () => {
    renderCosPage();

    fireEvent.click(await screen.findByRole('button', { name: /按署名/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/cos/cosers');

    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(await screen.findByRole('button', { name: /按署名/ })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/cos');
  });

  test('does not navigate on Backspace while the Cos search field is focused', async () => {
    renderCosPage('/cos/cosers');

    const search = await screen.findByPlaceholderText('搜索当前分类');
    act(() => search.focus());
    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(screen.getByTestId('location')).toHaveTextContent('/cos/cosers');
  });

  test('reuses the persisted three-level grid density control', async () => {
    renderCosPage('/cos/characters');

    fireEvent.click(await screen.findByRole('button', { name: '视图选项' }));
    fireEvent.mouseDown(screen.getByLabelText('密度'));
    fireEvent.click(await screen.findByRole('option', { name: '紧凑' }));

    expect(localStorage.getItem('userDensity')).toBe('compact');
  });

  test('restores the parent search after opening and returning from a result', async () => {
    renderCosPage('/cos/cosers');

    fireEvent.change(await screen.findByPlaceholderText('搜索当前分类'), { target: { value: 'Aki' } });
    fireEvent.click(await screen.findByRole('button', { name: /Aki/ }));
    fireEvent.click(await screen.findByRole('button', { name: /兔子洞写真套图/ }));
    await screen.findByTestId('cos-album-page');
    fireEvent.click(await screen.findByRole('button', { name: '返回上一级' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cos/sets?'));
    fireEvent.click(await screen.findByRole('button', { name: '返回上一级' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cos/cosers?q=Aki'));
    expect(screen.getByPlaceholderText('搜索当前分类')).toHaveValue('Aki');
  });

  test('shows a true empty state for a look search without keeping the all-sets card', async () => {
    renderCosPage('/cos/looks?character=character%3A初音未来&q=没有');

    expect(await screen.findByText('没有匹配的项目')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /全部收藏/ })).not.toBeInTheDocument();
  });

  test('resynchronizes density after browser Back returns from an album', async () => {
    renderCosPage();

    fireEvent.click(await screen.findByRole('button', { name: /全部收藏/ }));
    fireEvent.click(await screen.findByRole('button', { name: /兔子洞写真套图/ }));
    await screen.findByTestId('cos-album-page');
    fireEvent.click(screen.getByRole('button', { name: '模拟相簿密度' }));
    fireEvent.click(screen.getByRole('button', { name: '浏览器返回' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/cos/sets?'));

    fireEvent.click(await screen.findByRole('button', { name: '视图选项' }));
    expect(screen.getByLabelText('密度')).toHaveTextContent('紧凑');
  });
  test('restores an old album state by stable identity and uses the collection media provider', async () => {
    renderCosPage({ pathname: '/cos/album', search: '?set=set-one', state: {
      cosAlbumPath: '/old/deleted', cosAlbum: { id: 'set-one', displayName: '旧名' }
    }});
    const album = await screen.findByTestId('cos-album-page');
    expect(album).toHaveAttribute('data-set-id', 'set-one');
    expect(album).toHaveAttribute('data-album-path', '/library/set-one');
    expect(album).toHaveTextContent('兔子洞写真套图');
  });
  test('filters collection category, type and theme while retaining the filters in the URL', async () => {
    renderCosPage('/cos/sets?context=all');
    fireEvent.change(await screen.findByLabelText('收藏类别'), { target: { value: 'collections' } });
    fireEvent.change(screen.getByLabelText('类型'), { target: { value: '原创写真' } });
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: '公共浴室' } });
    await waitFor(() => expect(window.electronAPI.invoke).toHaveBeenCalledWith(CHANNELS.COS_LIST_SETS,
      expect.objectContaining({kind: 'collections', type: '原创写真', theme: '公共浴室'})));
    expect(screen.getByTestId('location')).toHaveTextContent('kind=collections');
  });

});
