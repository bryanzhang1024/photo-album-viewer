import React, { useEffect, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import { getStatus, listSets, listCharacters, listCosers, refresh, selectRoot } from '../../data/cos';
import { CHANNELS } from '../../data/ipc';
import './cos.css';

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

function BigCard({ title, count, hint, coverMediaId, onClick }) {
  return (
    <button className="bigcard" type="button" onClick={onClick}>
      <div className="bigcard-cover"><CosThumb mediaId={coverMediaId} /></div>
      <div className="bigcard-body">
        <h2>{title}</h2>
        <p>{count}</p>
        <span className="bigcard-hint">{hint}</span>
      </div>
    </button>
  );
}

export default function CosHomePage({ onNavigate }) {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState([]);
  const [covers, setCovers] = useState({});

  const loadStatus = () => {
    getStatus()
      .then((value) => setStatus(value))
      .catch((reason) => setError(reason?.message || 'Cos 图库初始化失败'));
  };

  useEffect(() => {
    loadStatus();
    const off = window.electronAPI?.on?.(CHANNELS.COS_INDEX_PROGRESS, (payload) => {
      setProgress(payload?.done ? null : payload);
      if (payload?.done) loadStatus();
    });
    return () => {
      if (typeof off === 'function') off();
      else window.electronAPI?.removeListener?.(CHANNELS.COS_INDEX_PROGRESS);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!status) return undefined;
    let alive = true;
    listSets({ sortBy: 'lastModified', sortDirection: 'desc', limit: 6 })
      .then((result) => {
        if (alive) setRecent(result.items || []);
      })
      .catch(() => {});
    Promise.all([
      listCharacters({ limit: 1 }).catch(() => null),
      listCosers({ limit: 1, groupSingletons: false }).catch(() => null)
    ]).then(([characters, cosers]) => {
      if (!alive) return;
      setCovers({
        character: characters?.items?.[0]?.coverMediaId || null,
        coser: cosers?.items?.[0]?.coverMediaId || null
      });
    });
    return () => {
      alive = false;
    };
  }, [status]);

  const summary = status?.summary;
  const countText = summary
    ? `${Number(summary.setCount).toLocaleString('zh-CN')} 套 · ${Number(summary.imageCount).toLocaleString('zh-CN')} 张图片`
    : error ? '读取失败' : '读取中…';

  const addRoot = async () => {
    try {
      const next = await selectRoot();
      setStatus(next);
    } catch (reason) {
      window.alert(reason?.message || '添加根目录失败');
    }
  };

  return (
    <>
      <PageHeader title="Cos 图库" count={countText} />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}
        {process.env.NODE_ENV !== 'production' || progress ? null : null}
        {progress || status?.state === 'indexing' ? (
          <div className="cos-banner">
            <span className="cos-spinner" />
            <span>正在建立索引</span>
            <span className="cos-dim">{progress ? `${progress.processed || 0} / ${progress.total || 0}` : '准备中…'}</span>
            <span className="cos-grow" />
            <span className="cos-dim">建好后会缓存，下次打开只需几秒</span>
          </div>
        ) : null}
        <div className="cos-scroll">
          <div className="cos-big-grid">
            <BigCard
              title="按角色"
              count={summary ? `${Number(summary.characterCount).toLocaleString('zh-CN')} 个角色` : '—'}
              hint="角色 · 造型 · 套图"
              coverMediaId={covers.character}
              onClick={() => onNavigate?.({ kind: 'cos-characters' })}
            />
            <BigCard
              title="按署名"
              count={summary ? `${Number(summary.coserCount).toLocaleString('zh-CN')} 个署名` : '—'}
              hint="人物、组织与发行来源"
              coverMediaId={covers.coser}
              onClick={() => onNavigate?.({ kind: 'cos-cosers' })}
            />
            <BigCard
              title="全部作品"
              count={summary ? `${Number(summary.setCount).toLocaleString('zh-CN')} 套作品` : '—'}
              hint="名称、署名、角色与主题搜索"
              coverMediaId={recent[0]?.coverMediaId || null}
              onClick={() => onNavigate?.({ kind: 'cos-sets', viewKind: 'all' })}
            />
          </div>

          <div className="cos-roots-row">
            <span className="cos-dim">图库根目录</span>
            {(status?.roots || []).map((root) => (
              <span className={`cos-chip${root.status === 'online' ? '' : ' offline'}`} key={root.id}>
                {root.label}
              </span>
            ))}
            <button className="cos-chip add" type="button" onClick={addRoot}>＋ 添加</button>
          </div>

          <div className="cos-section-head">最近添加</div>
          <div className="cos-grid">
            {recent.map((set) => (
              <button className="cos-card" type="button" key={set.id}
                onClick={() => onNavigate?.({ kind: 'cos-set', setId: set.id })}>
                <div className="cos-cover"><CosThumb mediaId={set.coverMediaId} /></div>
                <div className="cos-name">{set.displayName}</div>
                <div className="cos-meta">{set.imageCount} 张</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <StatusBar
        left={status?.roots ? `${status.roots.length} 个根目录` : '未加载根目录'}
        right={STATUS_HINTS}
      />
    </>
  );
}
