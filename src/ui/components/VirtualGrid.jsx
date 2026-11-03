import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useScrollMemory from '../hooks/useScrollMemory';
import './card.css';

const PAD_X = 22;
const PAD_TOP = 16;
// 离底部还有这么多像素就请求下一页，避免滚到底才开始等
const LOAD_MORE_AHEAD = 600;

/**
 * 共用窗口化网格：只渲染可视行。
 *
 * items 由调用方给（目录快照或 Cos 分页结果）；分页来源传 hasMore / loadingMore /
 * onLoadMore，滚到接近底部时自动请求下一页，因此 Cos 页不再需要单独的加载提示条。
 */
export default function VirtualGrid({
  items,
  minItemWidth = 148,
  gapX = 14,
  gapY = 16,
  textHeight = 62,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  selection = null,
  renderItem
}) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const loadRequested = useRef(false);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const [selectionBox, setSelectionBox] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const innerWidth = Math.max(0, size.w - PAD_X * 2);
  const columns = Math.max(2, Math.floor((innerWidth + gapX) / (minItemWidth + gapX)));
  const itemWidth = columns > 0 ? Math.max(0, (innerWidth - gapX * (columns - 1)) / columns) : minItemWidth;
  const coverHeight = (itemWidth * 4) / 3;
  const rowHeight = coverHeight + textHeight + gapY;
  const rows = Math.ceil(items.length / columns);
  const totalHeight = rows * rowHeight + PAD_TOP;

  const rememberScroll = useScrollMemory(ref, {
    slot: 'grid', items,
    indexAtOffset: (top) => Math.floor(Math.max(0, top - PAD_TOP) / rowHeight) * columns,
    offsetForIndex: (index) => PAD_TOP + Math.floor(index / columns) * rowHeight,
    ready: size.w > 0 && size.h > 0 && !loadingMore,
    hasMore, onLoadMore,
    onRestore: setScrollTop
  });

  const endDrag = () => {
    drag.current = null;
    setSelectionBox(null);
  };
  useEffect(() => {
    window.addEventListener('blur', endDrag);
    return () => window.removeEventListener('blur', endDrag);
  }, []);

  const moveSelectionBox = event => {
    const active = drag.current;
    if (!active || !selection) return;
    const el = ref.current;
    const bounds = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(el.clientWidth, event.clientX - bounds.left));
    const y = Math.max(0, Math.min(el.clientHeight, event.clientY - bounds.top));
    if (!active.moved && Math.hypot(x - active.x, y - active.y) < 4) return;
    active.moved = true;
    suppressClick.current = true;
    const box = { left: Math.min(active.x, x), top: Math.min(active.y, y) + el.scrollTop,
      width: Math.abs(x - active.x), height: Math.abs(y - active.y) };
    setSelectionBox(box);
    const keys = [];
    const startRow = Math.max(0, Math.floor((box.top - PAD_TOP) / rowHeight));
    const endRow = Math.min(rows - 1, Math.floor((box.top + box.height - PAD_TOP) / rowHeight));
    for (let row = startRow; row <= endRow; row++) {
      for (let column = 0; column < columns; column++) {
        const item = items[row * columns + column];
        if (!item || !selection.selectableKeys.has(item.key)) continue;
        const left = PAD_X + column * (itemWidth + gapX);
        const top = PAD_TOP + row * rowHeight;
        if (left < box.left + box.width && left + itemWidth > box.left
          && top < box.top + box.height && top + rowHeight - gapY > box.top) keys.push(item.key);
      }
    }
    selection.setBoxSelection(keys);
  };

  const firstRow = Math.max(0, Math.floor((scrollTop - PAD_TOP) / rowHeight) - 2);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + size.h) / rowHeight) + 2);

  const maybeLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loadRequested.current) return;
    if (typeof onLoadMore !== 'function') return;
    const el = ref.current;
    if (!el || el.clientHeight === 0) return; // 还没测量（jsdom / 首帧）时不做自动加载
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_AHEAD) {
      loadRequested.current = true;
      onLoadMore();
    }
  }, [hasMore, loadingMore, onLoadMore]);

  // 每次有数据进来或加载结束，允许下一次请求，避免一次滚动里重复触发
  useEffect(() => {
    loadRequested.current = false;
  }, [items.length, loadingMore]);

  // 首屏内容不足一屏时也要能继续加载
  useEffect(() => {
    maybeLoadMore();
  }, [items.length, size.w, size.h, maybeLoadMore]);

  const visible = [];
  for (let row = firstRow; row < lastRow; row += 1) {
    const start = row * columns;
    const slice = items.slice(start, start + columns);
    visible.push(
      <div
        key={row}
        className="vg-row"
        style={{
          top: PAD_TOP + row * rowHeight,
          gridTemplateColumns: `repeat(${columns}, ${itemWidth}px)`,
          columnGap: gapX
        }}
      >
        {slice.map((item, index) => renderItem(item, itemWidth, coverHeight, start + index))}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={`folder-scroll${selection ? ' image-selection-grid' : ''}`}
      tabIndex={0}
      aria-label="文件网格"
      onPointerDown={event => {
        if (!selection || event.button !== 0) return;
        suppressClick.current = false;
        if (event.target.closest?.('.grid-card')) return;
        event.preventDefault();
        const el = event.currentTarget;
        el.focus({ preventScroll: true });
        const bounds = el.getBoundingClientRect();
        drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top, moved: false };
        el.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={moveSelectionBox}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={event => {
        if (!selection) return;
        if (suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (!event.target.closest?.('.grid-card')) selection.clear();
      }}
      onScroll={(event) => {
        if (drag.current) endDrag();
        setScrollTop(event.currentTarget.scrollTop);
        rememberScroll(event.currentTarget);
        maybeLoadMore();
      }}
    >
      <div className="folder-scroll-inner" style={{ height: totalHeight, paddingLeft: PAD_X, paddingRight: PAD_X }}>
        {visible}
      </div>
      {selectionBox ? <div className="grid-selection-box" aria-hidden="true" style={selectionBox} /> : null}
    </div>
  );
}
