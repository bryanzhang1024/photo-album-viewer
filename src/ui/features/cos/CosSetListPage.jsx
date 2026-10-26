import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import { SearchIcon } from '../../icons';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import GridCard from '../../components/GridCard';
import VirtualGrid from '../../components/VirtualGrid';
import { DEFAULT_MIN_ITEM_WIDTH } from '../../data/prefs';
import { listSets } from '../../data/cos';
import { setCardItems } from './cardItems';
import useCosPagedList from './useCosPagedList';
import './cos.css';

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('cosSearch');

/** 套图列表：按角色 / 按署名 / 全部作品三种入口共用。 */
export default function CosSetListPage({ viewKind = 'all', entity, onOpenSet }) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const options = { sortBy: 'name' };
  if (viewKind === 'characters' && entity?.id) options.characterId = entity.id;
  if (viewKind === 'cosers' && entity?.id) options.coserId = entity.id;
  if (search) options.query = search;

  const { items, total, loading, error, loadMore, hasMore } = useCosPagedList(listSets, options);
  const coserName = viewKind === 'cosers' ? entity?.name : '';
  const cards = useMemo(() => setCardItems(items, { coserName }), [items, coserName]);
  const title = entity?.name || '全部作品';
  const countText = loading && items.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} 套`;

  const controls = (
    <label className="cos-search">
      <SearchIcon />
      <input
        type="search"
        value={query}
        placeholder="搜索名称、角色、作品"
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );

  return (
    <>
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'} title={title} count={countText} controls={controls} />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        {!error && cards.length === 0 ? (
          <div className="folder-state">
            {loading ? '读取中…' : (search ? `没有找到「${search}」` : '还没有套图')}
          </div>
        ) : null}
        {cards.length > 0 ? (
          <VirtualGrid
            items={cards}
            minItemWidth={DEFAULT_MIN_ITEM_WIDTH}
            hasMore={hasMore && !error}
            loadingMore={loading}
            onLoadMore={loadMore}
            renderItem={(card, width, coverHeight) => (
              <GridCard
                key={card.key}
                dataKey={card.key}
                width={width}
                coverHeight={coverHeight}
                name={card.name}
                meta={card.meta}
                cover={<CosThumb mediaId={card.coverMediaId} />}
                onClick={() => onOpenSet?.(card.payload, options)}
              />
            )}
          />
        ) : null}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
    </>
  );
}
