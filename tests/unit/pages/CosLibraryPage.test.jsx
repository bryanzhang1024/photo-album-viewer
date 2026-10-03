import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import CHANNELS from '../../../src/common/ipc-channels';
import CosLibraryPage from '../../../src/renderer/pages/CosLibraryPage';
import imageCache from '../../../src/renderer/utils/ImageCacheManager';
import { FavoritesContext } from '../../../src/renderer/contexts/FavoritesContext';

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
  albumPath,
  onRandomBrowse,
  randomBrowseDisabled
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
    <button onClick={onRandomBrowse} disabled={randomBrowseDisabled}>随机下一套</button>
    <button type="button" onClick={() => globalThis.localStorage.setItem('userDensity', 'compact')}>模拟相簿密度</button>
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
  const cardItem = {
    id: 'set-one', displayName: 'Alice｜初音未来·原皮（VOCALOID）',
    originalName: 'Alice - Miku', cosers: ['Alice'], characters: ['初音未来'],
    looks: ['原皮', '角色服装'], works: ['VOCALOID'], themes: ['角色Cos'],
    type: '角色Cos', imageCount: 48, coverMediaId: 'media:one', status: 'online',
    favoriteTargets: [{ path: '/library/set-one', online: true, previewImagePath: '/library/set-one/01.jpg' }]
  };

  function renderCoserCard(item = cardItem, albums = [], toggleAlbumFavorite = jest.fn()) {
    const original = window.electronAPI.invoke.getMockImplementation();
    window.electronAPI.invoke.mockImplementation((channel, ...args) => channel === CHANNELS.COS_LIST_SETS
      ? Promise.resolve({ items: [item], total: 1 }) : original(channel, ...args));
    render(
      <FavoritesContext.Provider value={{ favorites: { albums }, isLoading: false, toggleAlbumFavorite }}>
        <MemoryRouter initialEntries={['/cos/sets?context=coser&coser=coser%3AAlice']}>
          <CosLibraryPage />
          <LocationProbe />
        </MemoryRouter>
      </FavoritesContext.Provider>
    );
    return toggleAlbumFavorite;
  }

  test('uses concise identity and work text under a coser without repeating the filing name or generic look labels', async () => {
    renderCoserCard();
    await screen.findByAltText(cardItem.displayName);
    expect(screen.queryByText(cardItem.displayName)).not.toBeInTheDocument();
    expect(screen.getByText('初音未来')).toBeInTheDocument();
    expect(screen.getByText('VOCALOID')).toBeInTheDocument();
    expect(screen.queryByText('原皮')).not.toBeInTheDocument();
    expect(screen.queryByText('角色服装')).not.toBeInTheDocument();
    expect(screen.getByText('48 张')).toBeInTheDocument();
  });

  test('favorites from the text footer without opening the album, using its verified path and existing favorite system', async () => {
    const toggle = renderCoserCard();
    const favorite = await screen.findByRole('button', { name: '添加收藏' });
    const footer = favorite.parentElement;
    expect(within(footer).getByText('48 张')).toBeInTheDocument();
    expect(within(footer).queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(favorite);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(expect.objectContaining({
      path: '/library/set-one', name: cardItem.displayName, imageCount: 48,
      previewImagePath: '/library/set-one/01.jpg'
    })));
    expect(screen.getByTestId('location')).toHaveTextContent('/cos/sets');
    expect(window.electronAPI.invoke).toHaveBeenCalledWith(CHANNELS.COS_GET_SET_ALBUM_PATH, 'set-one');
  });

  test('reflects and removes an existing album favorite, including when the Cos location is offline', async () => {
    const existing = { path: '/library/set-one', name: 'original favorite', kind: 'photoSet' };
    const toggle = renderCoserCard({ ...cardItem, status: 'offline', favoriteTargets: [{ path: existing.path, online: false }] }, [existing]);
    const favorite = await screen.findByRole('button', { name: '取消收藏' });
    expect(favorite).toBeEnabled();
    fireEvent.click(favorite);
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(existing));
    expect(window.electronAPI.invoke).not.toHaveBeenCalledWith(CHANNELS.COS_GET_SET_ALBUM_PATH, 'set-one');
    expect(screen.getByTestId('location')).toHaveTextContent('/cos/sets');
  });

  test('waits for path verification and prevents repeated favorite requests', async () => {
    const invoke = window.electronAPI.invoke.getMockImplementation();
    let finish;
    window.electronAPI.invoke.mockImplementation((channel, ...args) => channel === CHANNELS.COS_GET_SET_ALBUM_PATH
      ? new Promise(resolve => { finish = resolve; }) : invoke(channel, ...args));
    const toggle = renderCoserCard();
    const favorite = await screen.findByRole('button', { name: '添加收藏' });
    fireEvent.click(favorite);
    fireEvent.click(favorite);
    expect(favorite).toBeDisabled();
    expect(toggle).not.toHaveBeenCalled();
    expect(window.electronAPI.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.COS_GET_SET_ALBUM_PATH)).toHaveLength(1);
    await act(async () => { finish('/library/set-one'); });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(favorite).toBeEnabled();
  });

  test('reports an unavailable set without adding a favorite or leaving the list', async () => {
    const invoke = window.electronAPI.invoke.getMockImplementation();
    window.electronAPI.invoke.mockImplementation((channel, ...args) => channel === CHANNELS.COS_GET_SET_ALBUM_PATH
      ? Promise.resolve(null) : invoke(channel, ...args));
    const toggle = renderCoserCard();
    fireEvent.click(await screen.findByRole('button', { name: '添加收藏' }));
    expect(await screen.findByText('套图所在目录当前不可用')).toBeInTheDocument();
    expect(toggle).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/cos/sets');
  });

  test('keeps a no-character photo release name and shows collaborators without repeating the current coser', async () => {
    renderCoserCard({ ...cardItem, displayName: 'Alice＋Bob｜Maid姉妹（原创写真）',
      cosers: ['Alice', 'Bob'], characters: [], looks: [], works: [], type: '原创写真' });
    await screen.findByAltText('Alice＋Bob｜Maid姉妹（原创写真）');
    expect(screen.getByText('Maid姉妹')).toBeInTheDocument();
    expect(screen.getByText('原创写真 · 与 Bob 合作')).toBeInTheDocument();
    expect(screen.queryByText('角色Cos')).not.toBeInTheDocument();
  });

  test('reuses loaded covers when returning to a grid', async () => {
    const first = renderCosPage('/cos/sets?context=all');
    fireEvent.load(await screen.findByAltText('兔子洞写真套图'));
    first.unmount();
    window.electronAPI.invoke.mockClear();
    renderCosPage('/cos/sets?context=all');
    expect(await screen.findByAltText('兔子洞写真套图')).toHaveAttribute('src', 'thumbnail-protocol://cover.webp');
    expect(window.electronAPI.invoke).not.toHaveBeenCalledWith(CHANNELS.COS_GET_MEDIA_THUMBNAIL, 'media:one');
  });

  test('retries a failed cover once and then displays a failure state', async () => {
    renderCosPage('/cos/sets?context=all');
    fireEvent.error(await screen.findByAltText('兔子洞写真套图'));
    await waitFor(() => {
      expect(window.electronAPI.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.COS_GET_MEDIA_THUMBNAIL)).toHaveLength(2);
    });
    fireEvent.error(await screen.findByAltText('兔子洞写真套图'));
    expect(await screen.findByText('封面加载失败')).toBeInTheDocument();
  });

  test('finishes loading when the thumbnail service cannot provide a cover', async () => {
    const invoke = window.electronAPI.invoke.getMockImplementation();
    window.electronAPI.invoke.mockImplementation((channel, ...args) => (
      channel === CHANNELS.COS_GET_MEDIA_THUMBNAIL ? Promise.resolve(null) : invoke(channel, ...args)
    ));
    renderCosPage('/cos/sets?context=all');
    expect(await screen.findByRole('progressbar', { name: '加载封面' })).toBeInTheDocument();
    expect(await screen.findByText('封面加载失败')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: '加载封面' })).not.toBeInTheDocument();
    expect(window.electronAPI.invoke.mock.calls.filter(([channel]) => channel === CHANNELS.COS_GET_MEDIA_THUMBNAIL)).toHaveLength(2);
  });

  test('does not display a details popup when hovering a set card', async () => {
    renderCosPage('/cos/sets?context=all');
    const card = await screen.findByRole('button', { name: /兔子洞写真套图/ });
    fireEvent.mouseOver(card);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 700)); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    localStorage.clear();
    imageCache.deleteEntry('thumbnail', 'media:one');
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

  test('randomizes beyond loaded cards, continues without repeats and returns to the filtered list', async () => {
    const base = window.electronAPI.invoke.getMockImplementation();
    window.electronAPI.invoke.mockImplementation(async (channel, payload) => {
      if (channel === 'cos-list-random-set-ids') return ['set-one', 'set-two', 'set-three'];
      if (channel === CHANNELS.COS_GET_SET) return { id: payload, displayName: payload };
      if (channel === CHANNELS.COS_GET_SET_ALBUM_PATH) return `/library/${payload}`;
      return base(channel, payload);
    });
    const origin = '/cos/sets?context=all&q=写真&type=原创写真&theme=公共浴室';
    renderCosPage(origin);
    await screen.findByAltText('兔子洞写真套图');
    fireEvent.click(screen.getByRole('button', { name: '随机套图 (E)' }));
    const first = (await screen.findByTestId('cos-album-page')).dataset.setId;
    const selected = new Set([first]);
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: '随机下一套' }));
      await waitFor(() => expect(screen.getByTestId('cos-album-page').dataset.setId).not.toBe(first));
      await waitFor(() => expect(screen.getByRole('button', { name: '随机下一套' })).toBeEnabled());
      selected.add(screen.getByTestId('cos-album-page').dataset.setId);
    }
    expect(selected.size).toBe(3);
    expect(window.electronAPI.invoke).toHaveBeenCalledWith('cos-list-random-set-ids', expect.objectContaining({
      viewKind: 'sets', query: '写真', type: '原创写真', theme: '公共浴室'
    }));
    expect(new URLSearchParams(screen.getByTestId('location').textContent.split('?')[1]).get('from')).toBe(origin);
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(origin));
  });

  test('offers random on the landing page and ignores E while editing a classification search', async () => {
    const base = window.electronAPI.invoke.getMockImplementation();
    window.electronAPI.invoke.mockImplementation(async (channel, payload) => channel === 'cos-list-random-set-ids'
      ? ['set-one'] : base(channel, payload));
    renderCosPage();
    await screen.findByRole('button', { name: /按角色/ });
    fireEvent.click(screen.getByRole('button', { name: '随机套图 (E)' }));
    await screen.findByTestId('cos-album-page');
    fireEvent.click(screen.getByRole('button', { name: '返回上一级' }));
    fireEvent.click(await screen.findByRole('button', { name: /按角色/ }));
    const search = await screen.findByPlaceholderText('搜索当前分类');
    act(() => search.focus());
    window.electronAPI.invoke.mockClear();
    fireEvent.keyDown(window, { key: 'e' });
    expect(window.electronAPI.invoke).not.toHaveBeenCalledWith('cos-list-random-set-ids', expect.anything());
    act(() => search.blur());
    fireEvent.keyDown(window, { key: 'e' });
    await screen.findByTestId('cos-album-page');
  });

  test('does not randomize while editing a native filter', async () => {
    renderCosPage('/cos/sets?context=all');
    await screen.findByAltText('兔子洞写真套图');
    act(() => screen.getByRole('combobox', { name: '类型' }).focus());
    window.electronAPI.invoke.mockClear();
    fireEvent.keyDown(window, { key: 'e' });
    expect(window.electronAPI.invoke).not.toHaveBeenCalledWith('cos-list-random-set-ids', expect.anything());
  });

  test('disables random while a library root is being removed', async () => {
    const base = window.electronAPI.invoke.getMockImplementation();
    let finish;
    window.electronAPI.invoke.mockImplementation((channel, payload) => channel === CHANNELS.COS_REMOVE_ROOT
      ? new Promise(resolve => { finish = resolve; }) : base(channel, payload));
    renderCosPage();
    await screen.findByRole('button', { name: /按角色/ });
    fireEvent.click(screen.getByTestId('CancelIcon'));
    expect(screen.getByRole('button', { name: '随机套图 (E)' })).toBeDisabled();
    await act(async () => { finish({ state: 'empty', roots: [], summary: {} }); });
    expect(screen.getByRole('button', { name: '随机套图 (E)' })).toBeDisabled();
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
    expect(setCard.closest('article')).toHaveTextContent('48 张');
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
