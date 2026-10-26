import React, { useEffect, useState } from 'react';
import { FolderIcon } from '../../icons';
import Thumb from '../../components/Thumb';
import { loadFolderCover } from '../../data/directory';

/**
 * 目录卡封面：有子目录且样本足够时用 2×2 拼贴，否则用首图；
 * 容器目录自己没图时按需向下找（有预算、带缓存）。
 *
 * 从 4.4.1 的 GridCard 里原样搬出来，行为不变；Cos 套图卡不用它，直接用单图封面。
 */
export default function FolderCover({ item, rootPath, coverMode = 'auto' }) {
  const [samples, setSamples] = useState(() => (item.coverSamples || []).slice(0, 4));

  useEffect(() => {
    if (samples.length >= 3) return undefined;
    let alive = true;
    loadFolderCover({ rootPath }, item.relativePath).then((next) => {
      if (alive && next.length > samples.length) setSamples(next.slice(0, 4));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.relativePath, rootPath]);

  const collage = coverMode === 'collage' || (coverMode !== 'single' && item.childCount > 0);
  if (collage && samples.length >= 3) {
    return (
      <div className="collage">
        {samples.map((sample) => (
          <Thumb key={sample} rootPath={rootPath} relativePath={sample} />
        ))}
      </div>
    );
  }
  if (samples.length > 0) {
    return <Thumb rootPath={rootPath} relativePath={samples[0]} />;
  }
  return (
    <div className="thumb thumb-empty">
      <FolderIcon />
    </div>
  );
}
