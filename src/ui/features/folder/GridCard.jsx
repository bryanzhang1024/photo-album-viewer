import React from 'react';
import SharedGridCard from '../../components/GridCard';
import FolderCover from './FolderCover';
import Thumb from '../../components/Thumb';
import { folderMeta, imageMeta } from '../../components/cardModel';

/**
 * 文件夹页的卡片适配层：把目录快照的 item 映射到共用卡片模型。
 * 尺寸、文字层级、收藏/选中行为都在 components/GridCard，这里只管目录数据。
 */
export default function GridCard({
  item,
  rootPath,
  width,
  coverHeight,
  selected = false,
  contain = false,
  favorited = false,
  showFilename = true,
  coverMode = 'auto',
  onClick,
  onToggleFavorite,
  onContextMenu
}) {
  const isFolder = item.kind === 'folder';
  return (
    <SharedGridCard
      dataKey={item.key}
      width={width}
      coverHeight={coverHeight}
      selected={selected}
      contain={contain}
      favorited={favorited}
      showName={showFilename}
      name={item.name}
      meta={isFolder ? folderMeta(item) : imageMeta(item)}
      cover={isFolder
        ? <FolderCover item={item} rootPath={rootPath} coverMode={coverMode} />
        : <Thumb rootPath={rootPath} relativePath={item.relativePath} />}
      onClick={(event) => onClick?.(item, event)}
      onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(item) : undefined}
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, item) : undefined}
    />
  );
}
