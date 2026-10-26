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
import { listCharacters, listCosers } from '../../data/cos';
import { entityCardItems } from './cardItems';
import useCosPagedList from './useCosPagedList';
import useGridSelection from './useGridSelection';
import useCosAutoRefresh from './useCosAutoRefresh';
import useWindowWidth from '../../hooks/useWindowWidth';
import { minWidthForDensity, useCosDensity } from './useCosPrefs';
import CosHeaderControls from './CosHeaderControls';
import './cos.css';

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('cosSearch');

const FETCHERS = {
  characters: listCharacters,
  cosers: (options) => listCosers({ ...options, groupSingletons: true })
};

const TITLES = { characters: '按角色', cosers: '按署名' };

/** 角色 / 署名总览：与套图列表同一套页头（面包屑、密度、设置）与键盘操作。 */
export default function CosEntityPage({ kind, onOpenEntity, onNavigate, searchQuery = '', onSearchChange }) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [menu, setMenu] = useState(null);
  const [density, setDensity] = useCosDensity();
  const windowWidth = useWindowWidth();
  const minItemWidth = minWidthForDensity(density, windowWidth);

  const fetcher = FETCHERS[kind] || listCharacters;
  const options = { sortBy: 'name' };
  if (searchQuery) options.query = searchQuery;
  const { items, total, loading, error, loadMore, reload, hasMore } = useCosPagedList(fetcher, options);
  useCosAutoRefresh(reload);
  const cards = useMemo(() => entityCardItems(items), [items]);

  const openEntity = useCallback((card, navigateOptions) => {
    if (navigateOptions) onOpenEntity?.(card.payload, navigateOptions);
    else onOpenEntity?.(card.payload);
  }, [onOpenEntity]);

  const [selectedKey] = useGridSelection({
    items: cards,
    onOpen: (card) => openEntity(card)
  });

  const title = TITLES[kind] || '按角色';
  const crumbs = [{ label: 'Cos 图库', clickable: true }];
  const countText = loading && items.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} ${kind === 'cosers' ? '个署名' : '个角色'}`;

  const controls = (
    <CosHeaderControls
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
    return [
      { key: 'open', label: '打开', onSelect: () => openEntity(card) },
      { key: 'new-tab', label: '在新标签页打开', onSelect: () => openEntity(card, { newTab: true }) }
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
        onCrumbClick={() => onNavigate?.({ kind: 'cos-home' })}
      />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        {!error && cards.length === 0 ? (
          <div className="folder-state">
            {loading ? '读取中…' : (searchQuery ? `没有找到「${searchQuery}」` : '还没有内容')}
          </div>
        ) : null}
        {cards.length > 0 ? (
          <VirtualGrid
            items={cards}
            minItemWidth={minItemWidth}
            hasMore={hasMore && !error}
            loadingMore={loading}
            onLoadMore={loadMore}
            renderItem={(card, width, coverHeight) => (
              <GridCard
                key={card.key}
                dataKey={card.key}
                width={width}
                coverHeight={coverHeight}
                selected={selectedKey === card.key}
                name={card.name}
                meta={card.meta}
                cover={<CosThumb mediaId={card.coverMediaId} />}
                onClick={() => openEntity(card)}
                onContextMenu={(event) => setMenu({
                  point: { x: event.clientX, y: event.clientY },
                  card
                })}
              />
            )}
          />
        ) : null}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
      <Menu
        open={Boolean(menu)}
        point={menu?.point}
        label="角色菜单"
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </>
  );
}
