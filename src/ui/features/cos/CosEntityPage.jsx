import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import { SearchIcon } from '../../icons';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import GridCard from '../../components/GridCard';
import VirtualGrid from '../../components/VirtualGrid';
import { DEFAULT_MIN_ITEM_WIDTH } from '../../data/prefs';
import { listCharacters, listCosers } from '../../data/cos';
import { entityCardItems } from './cardItems';
import useCosPagedList from './useCosPagedList';
import './cos.css';

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('cosSearch');

const FETCHERS = {
  characters: listCharacters,
  cosers: (options) => listCosers({ ...options, groupSingletons: true })
};

export default function CosEntityPage({ kind, onOpenEntity }) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const fetcher = FETCHERS[kind] || listCharacters;
  const options = { sortBy: 'name' };
  if (search) options.query = search;
  const { items, total, loading, error, loadMore, hasMore } = useCosPagedList(fetcher, options);
  const cards = useMemo(() => entityCardItems(items), [items]);
  const title = kind === 'cosers' ? '按署名' : '按角色';
  const countText = loading && items.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} ${kind === 'cosers' ? '个署名' : '个角色'}`;

  return (
    <>
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'}
        title={title}
        count={countText}
        controls={(
          <label className="cos-search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              placeholder="搜索名字"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
      />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        {!error && cards.length === 0 ? (
          <div className="folder-state">
            {loading ? '读取中…' : (search ? `没有找到「${search}」` : '还没有内容')}
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
                onClick={() => onOpenEntity?.(card.payload)}
              />
            )}
          />
        ) : null}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
    </>
  );
}
