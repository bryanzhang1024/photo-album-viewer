import React, { useEffect, useState } from 'react';
import { FolderIcon } from '../icons';
import { loadThumbnail, loadThumbnailByPath } from '../data/thumbnails';

/** 异步缩略图：先占位，拿到 URL 后替换；失败保持占位。 */
export default function Thumb({ rootPath, relativePath, absolutePath = '', className = '' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    setSrc('');
    const loader = absolutePath
      ? loadThumbnailByPath(absolutePath)
      : loadThumbnail(rootPath, relativePath);
    loader
      .then((url) => {
        if (alive) setSrc(url || '');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [rootPath, relativePath, absolutePath]);

  if (!src) {
    return (
      <div className={`thumb thumb-empty ${className}`}>
        <FolderIcon />
      </div>
    );
  }
  return <img className={`thumb ${className}`} src={src} alt="" loading="lazy" draggable={false} />;
}
