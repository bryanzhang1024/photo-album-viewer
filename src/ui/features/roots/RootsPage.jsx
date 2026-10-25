import React, { useEffect, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import { FolderIcon } from '../../icons';
import { getDirectoryLevel } from '../../data/directory';
import Thumb from '../../components/Thumb';
import './roots.css';

const STATUS_HINTS = '⌘[ 后退　⌘] 前进　⌘↑ 上一级　⌘F 搜索　⌘, 设置　⌘W 关闭标签';

/** 照片来源页（2.1）：每个根的封面、文件夹数与位置。 */
export default function RootsPage({ sources, onOpen }) {
  const [snapshots, setSnapshots] = useState({});

  useEffect(() => {
    let alive = true;
    sources.forEach((source) => {
      getDirectoryLevel(source, '')
        .then((snapshot) => {
          if (alive) setSnapshots((prev) => ({ ...prev, [source.sourceId]: snapshot }));
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [sources]);

  return (
    <>
      <PageHeader title="照片来源" count={sources.length > 0 ? `${sources.length} 个位置` : ''} />
      <div className="folder-body">
        <div className="roots-grid">
          {sources.map((source) => {
            const snapshot = snapshots[source.sourceId];
            const cover = snapshot?.approximate?.coverSamples?.[0];
            return (
              <button className="root-card" type="button" key={source.sourceId} onClick={() => onOpen(source)}>
                <div className="root-cover">
                  {cover ? <Thumb rootPath={source.rootPath} relativePath={cover} /> : <FolderIcon />}
                </div>
                <div className="root-name">{source.label}</div>
                <div className="root-meta">
                  {snapshot
                    ? `${snapshot.facts.childDirectoryCount.toLocaleString()} 个文件夹 · ${snapshot.locator.absolutePath}`
                    : '读取中…'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <StatusBar left={sources.length > 0 ? `${sources.length} 个位置` : '还没有照片来源'} right={STATUS_HINTS} />
    </>
  );
}
