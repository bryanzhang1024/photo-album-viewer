import React, { useLayoutEffect, useRef, useState } from 'react';
import { FolderIcon } from '../../icons';
import Thumb from '../../components/Thumb';
import { formatDate } from './GridCard';

const ROW_HEIGHT = 34;
const PAD_TOP = 34;

/** 窗口化列表：文件夹层四列，图片行显示大小与日期。 */
export default function FolderList({ items, rootPath, selectedKey, onSelect, onOpen }) {
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

  const total = items.length * ROW_HEIGHT + PAD_TOP + 8;
  const first = Math.max(0, Math.floor((scrollTop - PAD_TOP) / ROW_HEIGHT) - 5);
  const last = Math.min(items.length, Math.ceil((scrollTop + size.h) / ROW_HEIGHT) + 5);

  return (
    <div
      ref={ref}
      className="folder-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="list-head folder-list-head">
        <div>名称</div>
        <div>图片</div>
        <div>子文件夹</div>
        <div>修改日期</div>
      </div>
      <div className="folder-scroll-inner" style={{ height: total }}>
        {items.slice(first, last).map((item, index) => {
          const row = first + index;
          const isFolder = item.kind === 'folder';
          return (
            <div
              key={item.key}
              className={`row folder-row${selectedKey === item.key ? ' selected' : ''}`}
              style={{ top: PAD_TOP + row * ROW_HEIGHT }}
              onClick={() => onSelect?.(item)}
              onDoubleClick={() => onOpen?.(item)}
            >
              <div className="c-name">
                {isFolder ? (
                  <FolderIcon />
                ) : (
                  <Thumb rootPath={rootPath} relativePath={item.relativePath} className="row-thumb" />
                )}
                <span>{item.name}</span>
              </div>
              <div className="c-num">{isFolder && item.imageCount > 0 ? item.imageCount.toLocaleString('zh-CN') : '—'}</div>
              <div className="c-num">{isFolder && item.childCount > 0 ? item.childCount.toLocaleString('zh-CN') : '—'}</div>
              <div className="c-date">{formatDate(item.mtimeMs)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
