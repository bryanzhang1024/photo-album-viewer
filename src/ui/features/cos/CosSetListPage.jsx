import React, { useCallback, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import GridCard from '../../components/GridCard';
import VirtualGrid from '../../components/VirtualGrid';
import Menu from '../../components/Menu';
import { SettingsIcon } from '../../icons';
import { invoke, CHANNELS } from '../../data/ipc';
import { listSets, showSetInFolder } from '../../data/cos';
import { setCardItems, setFavoriteEntry } from './cardItems';
import useCosPagedList from './useCosPagedList';
import useGridSelection from './useGridSelection';
import useCosFavorites from './useCosFavorites';
import useCosAutoRefresh from './useCosAutoRefresh';
import useWindowWidth from '../../hooks/useWindowWidth';
import { minWidthForDensity, useCosDensity, useCosSort } from './useCosPrefs';
import CosHeaderControls from './CosHeaderControls';
import './cos.css';

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('cosSearch');

const SORT_FIELDS = [
  { key: 'name', label: '名称' },
  { key: 'imageCount', label: '图片' },
  { key: 'lastModified', label: '修改日期' }
];

const ENTRANCE = {
  characters: { label: '按角色', kind: 'cos-characters' },
  cosers: { label: '按署名', kind: 'cos-cosers' }
};

/** 套图列表：按角色 / 按署名 / 全部作品三种入口共用。 */
export default function CosSetListPage({
  viewKind = 'all', entity, onOpenSet, onNavigate, searchQuery = '', onSearchChange
}) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [menu, setMenu] = useState(null);

  const [sort, setSort] = useCosSort(`sets:${viewKind}:${entity?.id || 'all'}`, 'name');
  const [density, setDensity] = useCosDensity();
  const windowWidth = useWindowWidth();
  const minItemWidth = minWidthForDensity(density, windowWidth);
  const options = { sortBy: sort.field, sortDirection: sort.direction };
  if (viewKind === 'characters' && entity?.id) options.characterId = entity.id;
  if (viewKind === 'cosers' && entity?.id) options.coserId = entity.id;
  if (searchQuery) options.query = searchQuery;

  const { items, total, loading, error, loadMore, reload, hasMore } = useCosPagedList(listSets, options);
  useCosAutoRefresh(reload);
  const coserName = viewKind === 'cosers' ? entity?.name : '';
  const cards = useMemo(() => setCardItems(items, { coserName }), [items, coserName]);
  const { isAlbumFavorited, toggleAlbum } = useCosFavorites();

  const openSet = useCallback((card, navigateOptions) => {
    const optionsForSet = {
      sortBy: sort.field,
      sortDirection: sort.direction,
      ...(viewKind === 'characters' && entity?.id ? { characterId: entity.id } : {}),
      ...(viewKind === 'cosers' && entity?.id ? { coserId: entity.id } : {}),
      ...(searchQuery ? { query: searchQuery } : {})
    };
    if (navigateOptions) onOpenSet?.(card.payload, optionsForSet, navigateOptions);
    else onOpenSet?.(card.payload, optionsForSet);
  }, [onOpenSet, sort.field, sort.direction, viewKind, entity, searchQuery]);

  const [selectedKey] = useGridSelection({
    items: cards,
    onOpen: (card) => openSet(card)
  });

  const title = entity?.name || '全部作品';
  const entrance = ENTRANCE[viewKind] || null;
  const crumbs = [
    { label: 'Cos 图库', clickable: true },
    ...(entrance ? [{ label: entrance.label, clickable: true }] : [])
  ];
  const handleCrumbClick = (index) => {
    if (index === 0) onNavigate?.({ kind: 'cos-home' });
    else if (index === 1 && entrance) onNavigate?.({ kind: entrance.kind });
  };

  const countText = loading && items.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} 套`;

  const controls = (
    <CosHeaderControls
      sortFields={SORT_FIELDS}
      sort={sort}
      onSortChange={setSort}
      density={density}
      onDensityChange={setDensity}
      extra={(
        <button className="icon-button" type="button" aria-label="设置"
          onClick={() => invoke(CHANNELS.OPEN_SETTINGS_WINDOW).catch(() => {})}>
          <SettingsIcon />
        </button>
      )}
    />
  );

  const menuItems = (() => {
    const card = menu?.card;
    if (!card) return [];
    const entry = setFavoriteEntry(card.payload);
    const favorited = entry ? isAlbumFavorited(entry.path) : false;
    const result = [
      { key: 'open', label: '打开', onSelect: () => openSet(card) },
      { key: 'new-tab', label: '在新标签页打开', onSelect: () => openSet(card, { newTab: true }) }
    ];
    if (entry) {
      result.push({
        key: 'favorite',
        label: favorited ? '取消收藏' : '添加到收藏',
        onSelect: () => toggleAlbum(entry)
      });
    }
    result.push({
      key: 'reveal',
      label: '在 Finder 中显示',
      onSelect: () => showSetInFolder(card.payload.id).catch(() => {})
    });
    return result;
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
            {loading ? '读取中…' : (searchQuery ? `没有找到「${searchQuery}」` : '还没有套图')}
          </div>
        ) : null}
        {cards.length > 0 ? (
          <VirtualGrid
            items={cards}
            minItemWidth={minItemWidth}
            hasMore={hasMore && !error}
            loadingMore={loading}
            onLoadMore={loadMore}
            renderItem={(card, width, coverHeight) => {
              const entry = setFavoriteEntry(card.payload);
              return (
                <GridCard
                  key={card.key}
                  dataKey={card.key}
                  width={width}
                  coverHeight={coverHeight}
                  selected={selectedKey === card.key}
                  name={card.name}
                  meta={card.meta}
                  cover={<CosThumb mediaId={card.coverMediaId} />}
                  favorited={entry ? isAlbumFavorited(entry.path) : false}
                  onToggleFavorite={entry ? () => toggleAlbum(entry) : undefined}
                  onClick={() => openSet(card)}
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
        label="套图菜单"
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </>
  );
}
