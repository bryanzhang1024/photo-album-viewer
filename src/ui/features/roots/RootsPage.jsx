import React, { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import Thumb from '../../components/Thumb';
import useBreakpoint, { isNarrowBreakpoint } from '../../hooks/useBreakpoint';
import { FolderIcon } from '../../icons';
import { getDirectoryLevel } from '../../data/directory';
import { listRecentLocations, forgetLocation } from '../../data/recentLocations';
import {
  buildSourceEntries,
  registeredRootPaths,
  mergeFeed,
  countToday,
  formatWhen,
  FEED_LIMIT
} from './rootsActivity';
import './roots.css';

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('roots');
const RESUME_LIMIT = 2;
const SKELETON_KEYS = ['s1', 's2', 's3', 's4', 's5', 's6'];

function segmentName(source, relativePath) {
  const segments = String(relativePath || '').split('/').filter(Boolean);
  if (segments.length === 0) return source?.label || '来源根';
  return segments[segments.length - 1];
}

/** 一张「接着看」卡：封面 + 名称 + 来源/张数/上次打开时间。 */
function ResumeCard({ item, source, onOpen }) {
  const samples = (item.coverSamples || []).slice(0, 4);
  // 容器目录（还有子文件夹）用 2×2 拼贴；套图这种直接一层的用单图，更好认。
  const collage = Number(item.childCount) > 0 && samples.length >= 3;
  return (
    <button
      className="resume-card"
      type="button"
      onClick={() => onOpen(item.sourceId, item.relativePath)}
      title={item.relativePath ? `${source?.label || ''}/${item.relativePath}` : (source?.label || '')}
    >
      <span className="resume-cover">
        {collage ? (
          <span className="roots-collage">
            {samples.map((sample) => (
              <Thumb key={sample} rootPath={source?.rootPath} relativePath={sample} />
            ))}
          </span>
        ) : samples.length > 0 ? (
          <Thumb rootPath={source?.rootPath} relativePath={samples[0]} />
        ) : (
          <span className="resume-cover-empty"><FolderIcon /></span>
        )}
      </span>
      <span className="resume-shade" />
      <span className="resume-body">
        <span className="resume-name">{segmentName(source, item.relativePath)}</span>
        <span className="resume-meta">
          {source?.label || '来源'} · {(Number(item.imageCount) || 0).toLocaleString('zh-CN')} 张 · {formatWhen(item.at)}
        </span>
      </span>
      <span className="resume-go">继续</span>
    </button>
  );
}

/**
 * 「文件夹」页（4.6.0 起）：接着看 + 最近有变化。
 *
 * 来源清单留在侧栏；这页只回答两件侧栏回答不了的事：
 * 上次看到哪、最近几天有哪些文件夹变了。
 */
export default function RootsPage({ sources = [], onOpenLocation, onOpenFolder }) {
  const breakpoint = useBreakpoint();
  const narrow = isNarrowBreakpoint(breakpoint);
  const [activity, setActivity] = useState({});
  const [failed, setFailed] = useState({});
  const [resume, setResume] = useState(null);
  const [tick, setTick] = useState(0);

  const sourcesById = useMemo(() => {
    const map = new Map();
    (sources || []).forEach((source) => map.set(source.sourceId, source));
    return map;
  }, [sources]);

  // 接着看：本地记录 → 过滤掉已移除的来源 → 取前两条 → 读封面与张数。
  useEffect(() => {
    let alive = true;
    const records = listRecentLocations()
      .map((record) => ({ record, source: sourcesById.get(record.sourceId) }))
      .filter(({ source }) => Boolean(source))
      .slice(0, RESUME_LIMIT);

    if (records.length === 0) {
      setResume([]);
      return () => { alive = false; };
    }

    setResume(records.map(({ record, source }) => ({
      ...record,
      sourceId: record.sourceId,
      name: segmentName(source, record.relativePath),
      coverSamples: [],
      imageCount: 0,
      childCount: 0
    })));

    records.forEach(({ record, source }) => {
      getDirectoryLevel(source, record.relativePath)
        .then((snapshot) => {
          if (!alive) return;
          setResume((prev) => (prev || []).map((item) => (
            item.sourceId === record.sourceId
              ? {
                ...item,
                coverSamples: (snapshot?.approximate?.coverSamples || []).slice(0, 4),
                imageCount: snapshot?.facts?.directMediaCount || 0,
                childCount: snapshot?.facts?.childDirectoryCount || 0
              }
              : item
          )));
        })
        .catch(() => {
          // 文件夹被删、盘没挂：删掉这条记录，免得下次还画一张坏卡。
          forgetLocation(record.sourceId);
          if (alive) setResume((prev) => (prev || []).filter((item) => item.sourceId !== record.sourceId));
        });
    });

    return () => { alive = false; };
  }, [sourcesById, tick]);

  // 最近有变化：每个来源根的首层快照，逐条填进来（不阻塞首屏）。
  useEffect(() => {
    if (sources.length === 0) {
      setActivity({});
      setFailed({});
      return undefined;
    }
    let alive = true;
    setActivity({});
    setFailed({});
    const registeredPaths = registeredRootPaths(sources);
    const now = Date.now();

    sources.forEach((source) => {
      getDirectoryLevel(source, '')
        .then((snapshot) => {
          if (!alive) return;
          setActivity((prev) => ({
            ...prev,
            [source.sourceId]: buildSourceEntries(source, snapshot, { registeredPaths, now })
          }));
        })
        .catch((error) => {
          if (!alive) return;
          setFailed((prev) => ({
            ...prev,
            [source.sourceId]: error?.message || '这个位置暂时读不到'
          }));
        });
    });

    return () => { alive = false; };
  }, [sources, tick]);

  const allEntries = useMemo(() => mergeFeed(activity, Number.POSITIVE_INFINITY), [activity]);
  const feed = useMemo(() => allEntries.slice(0, FEED_LIMIT), [allEntries]);
  const todayCount = useMemo(() => countToday(allEntries), [allEntries]);
  const failedCount = Object.keys(failed).length;
  const settledCount = Object.keys(activity).length + failedCount;
  const scanning = sources.length > 0 && settledCount < sources.length;

  const countText = useMemo(() => {
    if (sources.length === 0) return '';
    const base = `${sources.length} 个位置`;
    return todayCount > 0 ? `${base} · 今天 ${todayCount} 个有改动` : base;
  }, [sources.length, todayCount]);

  const feedHint = scanning
    ? `正在读取 ${settledCount}/${sources.length} 个位置…`
    : '跨来源按修改时间排序 · 最近 7 天';

  const open = (sourceId, relativePath) => {
    onOpenLocation?.(sourceId, relativePath);
  };

  return (
    <>
      <PageHeader
        title="文件夹"
        count={countText}
        controls={onOpenFolder ? (
          <button
            className="text-button"
            type="button"
            onClick={(event) => onOpenFolder(event.currentTarget)}
          >
            打开文件夹
          </button>
        ) : null}
      />
      <div className="roots-body">
        {sources.length === 0 ? (
          <div className="roots-empty">
            <p>还没有照片来源。选一个文件夹加进来，就能在这里浏览。</p>
            <button
              className="button-primary"
              type="button"
              onClick={(event) => onOpenFolder?.(event.currentTarget)}
            >
              打开文件夹
            </button>
          </div>
        ) : (
          <>
            <section className="roots-section">
              <div className="roots-section-head">
                <h2>接着看</h2>
                <span>上次打开的位置，点一下回到那一层</span>
              </div>
              {resume && resume.length > 0 ? (
                <div className={`resume-row${narrow || resume.length === 1 ? ' single' : ''}`}>
                  {resume.map((item) => (
                    <ResumeCard
                      key={item.sourceId}
                      item={item}
                      source={sourcesById.get(item.sourceId)}
                      onOpen={open}
                    />
                  ))}
                </div>
              ) : (
                <div className="roots-hint-row">
                  <span>还没有打开过文件夹</span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={(event) => onOpenFolder?.(event.currentTarget)}
                  >
                    选一个位置
                  </button>
                </div>
              )}
            </section>

            <section className="roots-section">
              <div className="roots-section-head">
                <h2>最近有变化</h2>
                <span>{feedHint}</span>
              </div>
              {feed.length > 0 ? (
                <div className="feed">
                  {feed.map((item) => (
                    <button
                      className="feed-row"
                      type="button"
                      key={item.key}
                      onClick={() => open(item.sourceId, item.relativePath)}
                      title={`${item.sourceLabel}/${item.relativePath}`}
                    >
                      <span className="feed-thumb">
                        {item.cover ? (
                          <Thumb
                            rootPath={sourcesById.get(item.sourceId)?.rootPath}
                            relativePath={item.cover}
                          />
                        ) : <span className="feed-thumb-empty" />}
                      </span>
                      <span className="feed-name">{item.name}</span>
                      <span className="feed-source">{item.sourceLabel}</span>
                      <span className="feed-count">{item.imageCount.toLocaleString('zh-CN')} 张</span>
                      <span className="feed-when">{formatWhen(item.mtimeMs)}</span>
                    </button>
                  ))}
                </div>
              ) : scanning ? (
                <div className="feed" aria-label="正在读取">
                  {SKELETON_KEYS.map((key) => (
                    <div className="feed-row feed-skeleton" key={key}>
                      <span className="feed-thumb skeleton-block" />
                      <span className="feed-name skeleton-block" />
                      <span className="feed-source skeleton-block" />
                      <span className="feed-count skeleton-block" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="roots-hint-row">最近 7 天没有新内容</div>
              )}
            </section>

            {failedCount > 0 ? (
              <div className="roots-foot">
                <span>{failedCount} 个位置读不到</span>
                <button className="text-button" type="button" onClick={() => setTick((value) => value + 1)}>
                  重试
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      <StatusBar
        left={sources.length > 0 ? `${sources.length} 个位置` : '还没有照片来源'}
        right={STATUS_HINTS}
      />
    </>
  );
}
