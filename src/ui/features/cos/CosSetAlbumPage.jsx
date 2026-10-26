import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import StatusBar from '../../shell/StatusBar';
import Thumb from '../../components/Thumb';
import GridCard from '../../components/GridCard';
import VirtualGrid from '../../components/VirtualGrid';
import Menu from '../../components/Menu';
import ImageViewer from '../../components/ImageViewer';
import {
  ChevronLeftIcon, ChevronRightIcon, ShuffleIcon, HeartIcon, SettingsIcon, FitIcon
} from '../../icons';
import { DEFAULT_MIN_ITEM_WIDTH } from '../../data/prefs';
import { invoke, CHANNELS } from '../../data/ipc';
import {
  getSet, getSetImages, listSetIds, listRandomSetIds
} from '../../data/cos';
import { photoCardItems, setFavoriteEntry } from './cardItems';
import useGridSelection from './useGridSelection';
import useCosFavorites from './useCosFavorites';
import useCosAutoRefresh from './useCosAutoRefresh';
import { useCosDensity, useCosFit, useCosSort } from './useCosPrefs';
import CosHeaderControls from './CosHeaderControls';
import './cos.css';

const PAGE_SIZE = 120;
import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('cosSearch');

const SORT_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'size', label: '大小' },
  { key: 'lastModified', label: '修改日期' }
];

const ENTRANCE = {
  characters: { label: '按角色', kind: 'cos-characters' },
  cosers: { label: '按署名', kind: 'cos-cosers' }
};

/** 套内照片：网格 + 查看器；页头与文件夹照片层一致（上一套/下一套、收藏、完整显示、排序、密度）。 */
export default function CosSetAlbumPage({
  setId, setName, options = null, origin = null, onNavigateSet, onNavigate,
  searchQuery = '', onSearchChange
}) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [set, setSet] = useState(null);
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewerIndex, setViewerIndex] = useState(null);
  const [setIds, setSetIds] = useState([]);
  const [position, setPosition] = useState(-1);
  const [menu, setMenu] = useState(null);
  const [tick, setTick] = useState(0);

  const [sort, setSort] = useCosSort(`set:${setId}`, 'name');
  const [density, setDensity] = useCosDensity();
  const [fit, setFit] = useCosFit(setId);
  const { isAlbumFavorited, isPhotoFavorited, toggleAlbum, togglePhoto } = useCosFavorites();
  const forceNextRef = useRef(false);

  const fetchPage = useCallback((offset) => {
    const force = forceNextRef.current;
    forceNextRef.current = false;
    return getSetImages(setId, {
      offset,
      limit: PAGE_SIZE,
      sortBy: sort.field,
      sortDirection: sort.direction,
      ...(searchQuery ? { searchQuery } : {}),
      ...(force ? { forceRefresh: true } : {})
    });
  }, [setId, sort.field, sort.direction, searchQuery]);

  useEffect(() => {
    let alive = true;
    forceNextRef.current = false;
    setLoading(true);
    setImages([]);
    setTotal(0);
    setHasMore(false);
    setViewerIndex(null);
    setError('');
    Promise.all([
      getSet(setId).catch(() => null),
      fetchPage(0).catch((reason) => {
        if (alive) setError(reason?.message || '读取失败');
        return null;
      })
    ]).then(([record, page]) => {
      if (!alive) return;
      setSet(record);
      setImages(page?.images || []);
      setTotal(page?.totalCount || 0);
      setHasMore(Boolean(page?.hasMore));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [setId, fetchPage, tick]);

  const reload = useCallback((force = false) => {
    forceNextRef.current = force;
    setTick((value) => value + 1);
  }, []);
  const onAutoRefresh = useCallback(() => reload(true), [reload]);
  useCosAutoRefresh(onAutoRefresh);

  useEffect(() => {
    let alive = true;
    if (!options) {
      setSetIds([]);
      setPosition(-1);
      return () => { alive = false; };
    }
    listSetIds(options)
      .then((ids) => {
        if (!alive) return;
        const list = Array.isArray(ids) ? ids : [];
        setSetIds(list);
        setPosition(list.indexOf(setId));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId, JSON.stringify(options)]);

  const navigateTo = async (targetId) => {
    if (!targetId) return;
    const record = await getSet(targetId).catch(() => null);
    onNavigateSet?.({
      setId: targetId,
      name: record?.displayName || '',
      options,
      origin
    });
  };

  const goRelative = (offset) => {
    if (position < 0) return;
    const target = setIds[position + offset];
    if (target) navigateTo(target);
  };

  const openRandom = async () => {
    const pool = await listRandomSetIds(options || {}).catch(() => []);
    if (!Array.isArray(pool) || pool.length === 0) return;
    const candidates = pool.filter((id) => id !== setId);
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    navigateTo(pick);
  };

  const loadMore = () => {
    if (loading || !hasMore) return;
    setLoading(true);
    fetchPage(images.length)
      .then((page) => {
        setImages((prev) => [...prev, ...(page?.images || [])]);
        setTotal(page?.totalCount || 0);
        setHasMore(Boolean(page?.hasMore));
      })
      .catch((reason) => setError(reason?.message || '加载失败'))
      .finally(() => setLoading(false));
  };

  const title = set?.displayName || setName || '套图';
  const countText = loading && images.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} 张照片`;
  const cards = useMemo(() => photoCardItems(images), [images]);
  const viewerImages = images.map((image) => ({
    path: image.path,
    name: image.name,
    size: image.size,
    lastModified: image.lastModified
  }));
  const canPrev = position > 0;
  const canNext = position >= 0 && position < setIds.length - 1;
  const albumEntry = setFavoriteEntry(set);
  const albumFavorited = albumEntry ? isAlbumFavorited(albumEntry.path) : false;
  const albumPath = albumEntry?.path || '';

  const openPhoto = useCallback((card) => setViewerIndex(card.payload.index), []);
  const [selectedKey] = useGridSelection({
    items: cards,
    onOpen: openPhoto,
    escapeAction: () => { if (searchQuery) onSearchChange?.(''); }
  });

  const crumbs = [{ label: 'Cos 图库', clickable: true }];
  const entrance = ENTRANCE[origin?.viewKind] || null;
  if (entrance) crumbs.push({ label: entrance.label, clickable: true });
  if (origin?.entityName) crumbs.push({ label: origin.entityName, clickable: true });
  const handleCrumbClick = (index) => {
    if (index === 0) {
      onNavigate?.({ kind: 'cos-home' });
      return;
    }
    if (index === 1 && entrance) {
      onNavigate?.({ kind: entrance.kind });
      return;
    }
    if (index === 2 && origin?.entityName) {
      onNavigate?.({
        kind: 'cos-sets',
        viewKind: origin.viewKind,
        entity: { id: origin.entityId || '', name: origin.entityName }
      });
    }
  };

  const controls = (
    <CosHeaderControls
      sortFields={SORT_FIELDS}
      sort={sort}
      onSortChange={setSort}
      density={density}
      onDensityChange={setDensity}
      extra={(
        <>
          <div className="album-nav">
            <button className="icon-button" type="button" aria-label="上一套" disabled={!canPrev}
              onClick={() => goRelative(-1)}><ChevronLeftIcon /></button>
            <span className="album-pos">{position >= 0 ? `${position + 1} / ${setIds.length}` : ''}</span>
            <button className="icon-button" type="button" aria-label="下一套" disabled={!canNext}
              onClick={() => goRelative(1)}><ChevronRightIcon /></button>
          </div>
          <button className="icon-button" type="button" aria-label="随机一套" onClick={openRandom}>
            <ShuffleIcon />
          </button>
          <button
            className={`icon-button${albumFavorited ? ' favorited' : ''}`}
            type="button"
            aria-label="收藏这个套图"
            aria-pressed={albumFavorited}
            onClick={() => albumEntry && toggleAlbum(albumEntry)}
          >
            <HeartIcon />
          </button>
          <button className="icon-button" type="button" aria-label="设置"
            onClick={() => invoke(CHANNELS.OPEN_SETTINGS_WINDOW).catch(() => {})}>
            <SettingsIcon />
          </button>
          <button
            className={`icon-button${fit ? ' active' : ''}`}
            type="button"
            aria-label="完整显示"
            aria-pressed={fit}
            onClick={() => setFit(!fit)}
          >
            <FitIcon />
          </button>
        </>
      )}
    />
  );

  const menuItems = (() => {
    const card = menu?.card;
    if (!card) return [];
    const image = card.payload.image;
    const imageEntry = {
      path: image.path,
      name: image.name,
      size: image.size,
      lastModified: image.lastModified
    };
    return [
      { key: 'open', label: '打开', onSelect: () => openPhoto(card) },
      {
        key: 'favorite',
        label: isPhotoFavorited(image.path) ? '取消收藏' : '添加到收藏',
        onSelect: () => togglePhoto(imageEntry, albumPath, title)
      },
      {
        key: 'reveal',
        label: '在 Finder 中显示',
        onSelect: () => invoke(CHANNELS.SHOW_IN_FOLDER, image.path).catch(() => {})
      }
    ];
  })();

  return (
    <>
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'}
        crumbs={crumbs}
        title={title}
        count={countText}
        controls={controls}
        onCrumbClick={handleCrumbClick}
      />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        {!error && cards.length === 0 ? (
          <div className="folder-state">
            {loading ? '读取中…' : (searchQuery ? `没有找到「${searchQuery}」` : '这套图里没有照片')}
          </div>
        ) : null}
        {cards.length > 0 ? (
          <VirtualGrid
            items={cards}
            minItemWidth={DEFAULT_MIN_ITEM_WIDTH}
            hasMore={hasMore && !error}
            loadingMore={loading}
            onLoadMore={loadMore}
            renderItem={(card, width, coverHeight) => {
              const image = card.payload.image;
              const imageEntry = {
                path: image.path,
                name: image.name,
                size: image.size,
                lastModified: image.lastModified
              };
              return (
                <GridCard
                  key={card.key}
                  dataKey={card.key}
                  width={width}
                  coverHeight={coverHeight}
                  selected={selectedKey === card.key}
                  contain={fit}
                  name={card.name}
                  meta={card.meta}
                  cover={<Thumb absolutePath={image.path} />}
                  favorited={isPhotoFavorited(image.path)}
                  onToggleFavorite={() => togglePhoto(imageEntry, albumPath, title)}
                  onClick={() => openPhoto(card)}
                  onContextMenu={(event) => setMenu({
                    point: { x: event.clientX, y: event.clientY },
                    card
                  })}
                />
              );
            }}
          />
        ) : null}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
      <Menu
        open={Boolean(menu)}
        point={menu?.point}
        label="照片菜单"
        items={menuItems}
        onClose={() => setMenu(null)}
      />
      {viewerIndex !== null && viewerImages[viewerIndex] ? (
        <ImageViewer
          images={viewerImages}
          initialIndex={viewerIndex}
          title={title}
          albumPath={albumPath}
          albumName={title}
          onClose={() => setViewerIndex(null)}
          onDeleted={(image) => {
            setImages((prev) => prev.filter((item) => item.path !== image.path));
            setTotal((value) => Math.max(0, value - 1));
          }}
        />
      ) : null}
    </>
  );
}
