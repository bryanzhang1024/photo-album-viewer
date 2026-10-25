import React, { useEffect, useState } from 'react';
import PageHeader from '../../shell/PageHeader';
import StatusBar from '../../shell/StatusBar';
import { FolderIcon } from '../../icons';
import { getDirectoryLevel } from '../../data/directory';
import Thumb from '../../components/Thumb';
import './roots.css';

import { statusHint } from '../../data/shortcuts';

const STATUS_HINTS = statusHint('roots');

/** 照片来源页（2.1）：每个根的封面、文件夹数与位置。 */
export default function RootsPage({ sources, onOpen, onOpenFolder }) {
  const [snapshots, setSnapshots] = useState({});
  const [errors, setErrors] = useState({});
  const [tick, setTick] = useState(0);

  const loadSource = (source) => {
    setErrors((prev) => ({ ...prev, [source.sourceId]: '' }));
    return getDirectoryLevel(source, '')
      .then((snapshot) => {
        setSnapshots((prev) => ({ ...prev, [source.sourceId]: snapshot }));
      })
      .catch((error) => {
        setErrors((prev) => ({
          ...prev,
          [source.sourceId]: error?.message || '这个位置暂时读不到'
        }));
      });
  };

  useEffect(() => {
    let alive = true;
    sources.forEach((source) => {
      getDirectoryLevel(source, '')
        .then((snapshot) => {
          if (alive) setSnapshots((prev) => ({ ...prev, [source.sourceId]: snapshot }));
        })
        .catch((error) => {
          if (alive) {
            setErrors((prev) => ({
              ...prev,
              [source.sourceId]: error?.message || '这个位置暂时读不到'
            }));
          }
        });
    });
    return () => {
      alive = false;
    };
  }, [sources, tick]);

  return (
    <>
      <PageHeader
        title="照片来源"
        count={sources.length > 0 ? `${sources.length} 个位置` : ''}
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
      <div className="folder-body">
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
        ) : null}
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
                  {errors[source.sourceId] ? (
                    <>
                      <span className="root-offline">{errors[source.sourceId]}</span>
                      <button
                        className="text-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (snapshot) setSnapshots((prev) => ({ ...prev, [source.sourceId]: undefined }));
                          setTick((value) => value + 1);
                          loadSource(source);
                        }}
                      >
                        重试
                      </button>
                    </>
                  ) : snapshot
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
