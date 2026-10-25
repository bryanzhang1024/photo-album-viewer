import React, { useEffect, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import useBreakpoint from '../../hooks/useBreakpoint';
import StatusBar from '../../shell/StatusBar';
import CosThumb from '../../components/CosThumb';
import { getStatus, listSets, listCharacters, listCosers, refresh, selectRoot, removeRoot } from '../../data/cos';
import { CHANNELS } from '../../data/ipc';
import { RotateIcon } from '../../icons';
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
  const breakpoint = useBreakpoint();
  const compactHeader = breakpoint === 'medium' || breakpoint === 'small';
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

  const runRefresh = async () => {
    try {
      await refresh();
      loadStatus();
    } catch (reason) {
      window.alert(reason?.message || '刷新索引失败');
    }
  };

  const dropRoot = async (root) => {
    const confirmed = window.confirm(`从 Cos 图库移除「${root.label}」？只移除索引配置，不修改磁盘文件。`);
    if (!confirmed) return;
    try {
      const next = await removeRoot(root.id);
      setStatus(next);
    } catch (reason) {
      window.alert(reason?.message || '移除根目录失败');
    }
  };

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
      <PageHeader
        variant={compactHeader ? 'compact' : 'inline'}
        title="Cos 图库"
        count={countText}
        controls={(
          <button className="tool-text" type="button" onClick={runRefresh}>
            <RotateIcon />
            <span>刷新索引</span>
          </button>
        )}
      />
      <div className="folder-body">
        {error ? <div className="folder-state error">{error}</div> : null}

        {progress || status?.state === 'indexing' ? (
          <div className="cos-banner">
            <span className="cos-spinner" />
            <span>正在建立索引</span>
            <span className="cos-dim">{progress ? `${progress.processed || 0} / ${progress.total || 0}` : '准备中…'}</span>
            <span className="cos-grow" />
            <span className="cos-dim">建好后会缓存，下次打开只需几秒</span>
          </div>
        ) : null}
        {status?.roots?.some((root) => root.status !== 'online') ? (
          <div className="cos-banner offline">
            <span>部分图库根目录离线，相关套图会标记为不可用；接回磁盘后点「刷新索引」即可恢复。</span>
          </div>
        ) : null}
        <div className="cos-scroll">
          {status && summary && summary.setCount === 0 ? (
            <div className="folder-state">
              <div>还没有 Cos 索引。添加图库根目录后会开始建立索引。</div>
              <button className="btn-primary" type="button" onClick={addRoot}>添加根目录</button>
            </div>
          ) : null}
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
                <button className="cos-chip-x" type="button" aria-label={`移除 ${root.label}`}
                  onClick={() => dropRoot(root)}>×</button>
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
