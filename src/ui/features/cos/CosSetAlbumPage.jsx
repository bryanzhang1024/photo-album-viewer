import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import StatusBar from '../../shell/StatusBar';
import Thumb from '../../components/Thumb';
import GridCard from '../../components/GridCard';
import VirtualGrid from '../../components/VirtualGrid';
import ImageViewer from '../../components/ImageViewer';
import { ChevronLeftIcon, ChevronRightIcon, ShuffleIcon } from '../../icons';
import { DEFAULT_MIN_ITEM_WIDTH } from '../../data/prefs';
import {
  getSet, getSetImages, listSetIds, listRandomSetIds
} from '../../data/cos';
import { photoCardItems } from './cardItems';
import './cos.css';

const PAGE_SIZE = 120;
import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('cos');

/** 套内照片：网格 + 查看器；页头可上一套 / 下一套 / 随机。 */
export default function CosSetAlbumPage({ setId, setName, options = null, onNavigateSet }) {
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
  const [set, setSet] = useState(null);
  const [images, setImages] = useState([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [setIds, setSetIds] = useState([]);
  const [position, setPosition] = useState(-1);

  const fetchPage = (offset) => getSetImages(setId, { offset, limit: PAGE_SIZE, sortBy: 'name' });

  useEffect(() => {
    let alive = true;
    setImages([]);
    setTotal(0);
    setViewerIndex(null);
    Promise.all([
      getSet(setId).catch(() => null),
      fetchPage(0).catch(() => null)
    ]).then(([record, page]) => {
      if (!alive) return;
      setSet(record);
      setImages(page?.images || []);
      setTotal(page?.totalCount || 0);
      setHasMore(Boolean(page?.hasMore));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

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
    onNavigateSet?.({ setId: targetId, name: record?.displayName || '', options });
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
      .finally(() => setLoading(false));
  };

  const title = set?.displayName || setName || '套图';
  const countText = total > 0 ? `${Number(total).toLocaleString('zh-CN')} 张照片` : '读取中…';
  const cards = useMemo(() => photoCardItems(images), [images]);
  const viewerImages = images.map((image) => ({
    path: image.path,
    name: image.name,
    size: image.size,
    lastModified: image.lastModified
  }));
  const canPrev = position > 0;
  const canNext = position >= 0 && position < setIds.length - 1;

  return (
    <>
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'}
        title={title}
        count={countText}
        controls={(
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
          </>
        )}
      />
      <div className="folder-body">
        {cards.length === 0 ? (
          <div className="folder-state">{total > 0 ? '读取中…' : '这套图里没有照片'}</div>
        ) : (
          <VirtualGrid
            items={cards}
            minItemWidth={DEFAULT_MIN_ITEM_WIDTH}
            hasMore={hasMore}
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
                cover={<Thumb absolutePath={card.payload.image.path} />}
                onClick={() => setViewerIndex(card.payload.index)}
              />
            )}
          />
        )}
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
      {viewerIndex !== null && viewerImages[viewerIndex] ? (
        <ImageViewer
          images={viewerImages}
          initialIndex={viewerIndex}
          title={title}
          albumPath={set?.locations?.[0]?.relativePath || ''}
          albumName={title}
          onClose={() => setViewerIndex(null)}
          onDeleted={() => {}}
        />
      ) : null}
    </>
  );
}
