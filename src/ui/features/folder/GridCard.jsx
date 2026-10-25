import React, { useEffect, useState } from 'react';
import { FolderIcon, HeartIcon } from '../../icons';
import Thumb from '../../components/Thumb';
import { loadFolderCover } from '../../data/directory';

export function formatDate(mtimeMs) {
  if (!mtimeMs) return '—';
  const date = new Date(mtimeMs);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function Cover({ item, rootPath, coverMode = 'auto' }) {
  const [samples, setSamples] = useState(() => (item.coverSamples || []).slice(0, 4));

  // 容器文件夹自己没图时，按需往下一两层找封面（有预算、带缓存）。
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

/**
 * 网格卡片：文件夹与图片共用同一套文字层级。
 * 封面右上角有心形，点它只切收藏、不打开；右键菜单由外层接管。
 */
export default function GridCard({
  item,
  rootPath,
  width,
  coverHeight,
  selected,
  contain = false,
  favorited = false,
  showFilename = true,
  coverMode = 'auto',
  onClick,
  onToggleFavorite,
  onContextMenu
}) {
  const isFolder = item.kind === 'folder';
  const folderMeta = item.childCount > 0
    ? `${item.childCount} 个子文件夹 · ${item.imageCount} 张`
    : `${item.imageCount} 张${item.mtimeMs ? ` · ${formatDate(item.mtimeMs)}` : ''}`;
  const meta = isFolder ? folderMeta : `${Math.round(item.size / 1024)} KB · ${formatDate(item.mtimeMs)}`;
  return (
    <article
      data-key={item.key}
      className={`grid-card${selected ? ' selected' : ''}`}
      style={{ width }}
      onClick={() => onClick?.(item)}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(event, item);
      }}
    >
      <div className={`grid-card-cover${contain ? ' contain' : ''}`} style={{ height: coverHeight }}>
        {isFolder ? <Cover item={item} rootPath={rootPath} coverMode={coverMode} /> : null}
        {!isFolder ? (
          <Thumb rootPath={rootPath} relativePath={item.relativePath} />
        ) : null}
        <button
          className={`card-heart${favorited ? ' favorited' : ''}`}
          type="button"
          aria-label={favorited ? '取消收藏' : '收藏'}
          aria-pressed={favorited}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite?.(item);
          }}
        >
          <HeartIcon />
        </button>
      </div>
      {showFilename ? <div className="grid-card-name">{item.name}</div> : null}
      <div className="grid-card-meta">{meta}</div>
    </article>
  );
}
