import React, { useLayoutEffect, useRef, useState } from 'react';

const PAD_X = 22;
const PAD_TOP = 16;

/**
 * 窗口化网格：只渲染可视行，3,055 张平铺也不卡。
 * 卡片宽度按容器宽度与最小宽度算列数，行高 = 封面(3:4) + 文字区。
 */
export default function VirtualGrid({ items, minItemWidth = 168, gapX = 14, gapY = 16, textHeight = 62, renderItem }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [scrollTop, setScrollTop] = useState(0);

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
  const itemWidth = columns > 0 ? (innerWidth - gapX * (columns - 1)) / columns : minItemWidth;
  const coverHeight = (itemWidth * 4) / 3;
  const rowHeight = coverHeight + textHeight + gapY;
  const rows = Math.ceil(items.length / columns);
  const totalHeight = rows * rowHeight + PAD_TOP;

  const firstRow = Math.max(0, Math.floor((scrollTop - PAD_TOP) / rowHeight) - 2);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + size.h) / rowHeight) + 2);

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
      className="folder-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="folder-scroll-inner" style={{ height: totalHeight, paddingLeft: PAD_X, paddingRight: PAD_X }}>
        {visible}
      </div>
    </div>
  );
}
