import React from 'react';
import { HeartIcon } from '../icons';
import './card.css';

/**
 * 共用卡片：文件夹页与 Cos 页共用同一套尺寸、文字层级、收藏与选中行为。
 *
 * - 虚拟网格传 width / coverHeight（行高由网格算）；流式网格不传，封面按 3:4 比例。
 * - name / meta 由调用方按来源给（目录名 + 张数日期，或 Cos 清理名 + 作品张数），
 *   版式在这里固定，文字规则由来源决定。
 * - cover 由调用方给（目录拼贴、Cos 单图、照片缩略图）。
 * - 不传 onToggleFavorite 时不渲染心形：Cos 页的收藏入口要到 S3 才接，先不摆假按钮。
 */
export default function GridCard({
  dataKey,
  width,
  coverHeight,
  selected = false,
  contain = false,
  favorited = false,
  name,
  meta,
  cover,
  showName = true,
  onClick,
  onToggleFavorite,
  onContextMenu
}) {
  return (
    <article
      data-key={dataKey}
      className={`grid-card${selected ? ' selected' : ''}`}
      style={width ? { width } : undefined}
      onClick={onClick}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        onContextMenu(event);
      }}
    >
      <div
        className={`grid-card-cover${contain ? ' contain' : ''}${coverHeight ? '' : ' grid-card-cover-ratio'}`}
        style={coverHeight ? { height: coverHeight } : undefined}
      >
        {cover}
        {onToggleFavorite ? (
          <button
            className={`card-heart${favorited ? ' favorited' : ''}`}
            type="button"
            aria-label={favorited ? '取消收藏' : '收藏'}
            aria-pressed={favorited}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite();
            }}
          >
            <HeartIcon />
          </button>
        ) : null}
      </div>
      {showName ? <div className="grid-card-name">{name}</div> : null}
      {meta ? <div className="grid-card-meta">{meta}</div> : null}
    </article>
  );
}
