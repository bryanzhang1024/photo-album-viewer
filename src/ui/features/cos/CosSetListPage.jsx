import React from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import { listSets, describeSet } from '../../data/cos';
import useCosPagedList from './useCosPagedList';
import CosLoadMore from './CosLoadMore';
import './cos.css';

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

/** 套图列表：按角色 / 按署名 / 全部作品三种入口共用。 */
export default function CosSetListPage({ viewKind = 'all', entity, onOpenSet }) {
  const options = { sortBy: 'name' };
  if (viewKind === 'characters' && entity?.id) options.characterId = entity.id;
  if (viewKind === 'cosers' && entity?.id) options.coserId = entity.id;

  const { items, total, loading, error, loadMore, hasMore } = useCosPagedList(listSets, options);
  const title = entity?.name || '全部作品';
  const context = { coserName: viewKind === 'cosers' ? entity?.name : '' };
  const countText = loading && items.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} 套`;

  return (
    <>
      <PageHeader title={title} count={countText} />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        <div className="cos-scroll">
          <div className="cos-grid">
            {items.map((set) => {
              const text = describeSet(set, context);
              return (
                <button className="cos-card" type="button" key={set.id}
                  onClick={() => onOpenSet?.(set)}>
                  <div className="cos-cover"><CosThumb mediaId={set.coverMediaId} /></div>
                  <div className="cos-name">{text.name}</div>
                  <div className="cos-meta">{text.meta}</div>
                </button>
              );
            })}
          </div>
          <CosLoadMore onLoadMore={loadMore} hasMore={hasMore} loading={loading} />
        </div>
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
    </>
  );
}
