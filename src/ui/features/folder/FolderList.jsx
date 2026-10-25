import React, { useLayoutEffect, useRef, useState } from 'react';
import {
  FolderIcon, VideoIcon, ArchiveIcon, DocumentIcon, AudioIcon, InstallerIcon, FileIcon
} from '../../icons';
import Thumb from '../../components/Thumb';
import { formatDate } from './GridCard';
import { fileKindLabel, formatFileSize } from '../../data/files';

const ROW_HEIGHT = 34;
const PAD_TOP = 34;
const SECTION_HEAD = 28;

const FILE_ICONS = {
  video: VideoIcon,
  archive: ArchiveIcon,
  document: DocumentIcon,
  audio: AudioIcon,
  installer: InstallerIcon
};

/** 窗口化列表：文件夹 / 图片行 + 其他文件段。 */
export default function FolderList({
  items,
  otherFiles = [],
  rootPath,
  selectedKey,
  onSelect,
  onOpen,
  onOpenFile,
  isPhotoLayer = false,
  sort = { field: 'name', direction: 'asc' },
  onSort
}) {
  const ref = useRef(null);
  const [size, setSize] = useState({ h: 0 });
  const [scrollTop, setScrollTop] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filesTop = PAD_TOP + items.length * ROW_HEIGHT + (otherFiles.length > 0 ? SECTION_HEAD : 0);
  const total = filesTop + otherFiles.length * ROW_HEIGHT + 8;
  const first = Math.max(0, Math.floor((scrollTop - PAD_TOP) / ROW_HEIGHT) - 5);
  const last = Math.min(items.length + otherFiles.length, Math.ceil((scrollTop + size.h) / ROW_HEIGHT) + 5);

  const visible = [];
  for (let row = first; row < last; row += 1) {
    if (row < items.length) {
      const item = items[row];
      const isFolder = item.kind === 'folder';
      visible.push(
        <div
          key={item.key}
          className={`row folder-row${selectedKey === item.key ? ' selected' : ''}`}
          style={{ top: PAD_TOP + row * ROW_HEIGHT }}
          onClick={() => onSelect?.(item)}
          onDoubleClick={() => onOpen?.(item)}
        >
          <div className="c-name">
            {isFolder ? <FolderIcon /> : <Thumb rootPath={rootPath} relativePath={item.relativePath} className="row-thumb" />}
            <span>{item.name}</span>
          </div>
          <div className="c-num">{isFolder && item.imageCount > 0 ? item.imageCount.toLocaleString('zh-CN') : '—'}</div>
          <div className="c-num">{isFolder && item.childCount > 0 ? item.childCount.toLocaleString('zh-CN') : '—'}</div>
          <div className="c-date">{formatDate(item.mtimeMs)}</div>
        </div>
      );
      continue;
    }

    const file = otherFiles[row - items.length];
    if (!file) continue;
    const Icon = FILE_ICONS[file.kind] || FileIcon;
    const key = `file:${file.name}`;
    visible.push(
      <div
        key={key}
        className={`row folder-row file${selectedKey === key ? ' selected' : ''}`}
        style={{ top: filesTop + (row - items.length) * ROW_HEIGHT }}
        onClick={() => onSelect?.({ kind: 'file', key, ...file })}
        onDoubleClick={() => onOpenFile?.(file)}
      >
        <div className="c-name"><Icon /><span>{file.name}</span></div>
        <div className="c-kind-cell">{fileKindLabel(file)}</div>
        <div className="c-num">{formatFileSize(file.size)}</div>
        <div className="c-date">{formatDate(file.mtimeMs)}</div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="folder-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="list-head folder-list-head" role="row">
        {[
          { label: '名称', field: 'name' },
          { label: isPhotoLayer ? '大小 / 类型' : '图片 / 类型', field: isPhotoLayer ? 'size' : 'imageCount' },
          { label: isPhotoLayer ? '—' : '子文件夹 / 大小', field: isPhotoLayer ? null : 'childCount' },
          { label: '修改日期', field: 'mtimeMs' }
        ].map((column) => {
          const active = sort?.field === column.field;
          const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
          if (!column.field || !onSort) {
            return <div key={column.label} role="columnheader">{column.label}</div>;
          }
          return (
            <button
              key={column.label}
              className={`list-head-cell${active ? ' active' : ''}`}
              type="button"
              role="columnheader"
              aria-sort={ariaSort}
              onClick={() => onSort(column.field)}
            >
              {column.label}
              {active ? <span className="list-head-arrow">{sort.direction === 'asc' ? '↑' : '↓'}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="folder-scroll-inner" style={{ height: total }}>
        {otherFiles.length > 0 ? (
          <div className="file-section-head" style={{ top: PAD_TOP + items.length * ROW_HEIGHT - 4 }}>
            其他文件 · {otherFiles.length}
          </div>
        ) : null}
        {visible}
      </div>
    </div>
  );
}
