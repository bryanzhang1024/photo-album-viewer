import React from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import { listCharacters, listCosers } from '../../data/cos';
import useCosPagedList from './useCosPagedList';
import CosLoadMore from './CosLoadMore';
import './cos.css';

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

const FETCHERS = {
  characters: listCharacters,
  cosers: (options) => listCosers({ ...options, groupSingletons: true })
};

export default function CosEntityPage({ kind, onOpenEntity }) {
  const fetcher = FETCHERS[kind] || listCharacters;
  const { items, total, loading, error, loadMore, hasMore } = useCosPagedList(fetcher, { sortBy: 'name' });
  const title = kind === 'cosers' ? '按署名' : '按角色';
  const countText = loading && items.length === 0
    ? '读取中…'
    : `${Number(total).toLocaleString('zh-CN')} ${kind === 'cosers' ? '个署名' : '个角色'}`;

  return (
    <>
      <PageHeader title={title} count={countText} />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        <div className="cos-scroll">
          <div className={`cos-grid ${kind === 'characters' ? 'chars' : ''}`}>
            {items.map((entity) => (
              <button className="cos-card" type="button" key={entity.id}
                onClick={() => onOpenEntity?.(entity)}>
                <div className="cos-cover square"><CosThumb mediaId={entity.coverMediaId} /></div>
                <div className="cos-name">{entity.name}</div>
                <div className="cos-meta">
                  {entity.id && entity.name === '其他'
                    ? `${entity.coserCount || 0} 位 · ${entity.setCount} 套`
                    : `${entity.setCount} 套`}
                </div>
              </button>
            ))}
          </div>
          <CosLoadMore onLoadMore={loadMore} hasMore={hasMore} loading={loading} />
        </div>
      </div>
      <StatusBar left={countText} right={STATUS_HINTS} />
    </>
  );
}
