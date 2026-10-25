import React, { useEffect, useState } from 'react';
import { CollectionsIcon } from '../icons';
import { loadMediaThumbnail } from '../data/cos';

/** Cos 封面缩略图：先占位，拿到 URL 后替换。 */
export default function CosThumb({ mediaId, className = '' }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    setSrc('');
    loadMediaThumbnail(mediaId)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mediaId]);

  if (!src) {
    return (
      <div className={`thumb thumb-empty ${className}`}>
        <CollectionsIcon />
      </div>
    );
  }
  return (
    <img
      className={`thumb ${className}`}
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  );
}
