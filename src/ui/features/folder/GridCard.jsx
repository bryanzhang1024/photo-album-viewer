import React from 'react';
import { FolderIcon } from '../../icons';
import Thumb from '../../components/Thumb';

export function formatDate(mtimeMs) {
  if (!mtimeMs) return '—';
  const date = new Date(mtimeMs);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function Cover({ item, rootPath }) {
  const samples = (item.coverSamples || []).slice(0, 4);
  if (item.childCount > 0 && samples.length >= 3) {
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

/** 网格卡片：文件夹与图片共用同一套文字层级。 */
export default function GridCard({ item, rootPath, width, coverHeight, selected, onClick }) {
  const isFolder = item.kind === 'folder';
  const meta = isFolder
    ? (item.childCount > 0 ? `${item.childCount} 个子文件夹 · ${item.imageCount} 张` : `${item.imageCount} 张`)
    : `${Math.round(item.size / 1024)} KB · ${formatDate(item.mtimeMs)}`;
  return (
    <article
      className={`grid-card${selected ? ' selected' : ''}`}
      style={{ width }}
      onClick={() => onClick?.(item)}
    >
      <div className="grid-card-cover" style={{ height: coverHeight }}>
        {isFolder ? <Cover item={item} rootPath={rootPath} /> : null}
        {!isFolder ? (
          <Thumb rootPath={rootPath} relativePath={item.relativePath} />
        ) : null}
      </div>
      <div className="grid-card-name">{item.name}</div>
      <div className="grid-card-meta">{meta}</div>
    </article>
  );
}
