import React, { useEffect, useRef } from 'react';

/**
 * 通用浮层菜单。anchor 是触发元素，用来定位；点击外部或 Esc 关闭。
 * items: [{ key, label, onSelect, danger, disabled }]
 */
export default function Menu({ open, anchor, items = [], onClose, label = '菜单' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) onClose?.();
    };
    const handleKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handlePointer, true);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer, true);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  const rect = anchor?.getBoundingClientRect?.();
  const width = 220;
  const estimatedHeight = Math.max(48, items.length * 34 + 12);
  const left = rect
    ? Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
    : 16;
  const top = rect
    ? Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - estimatedHeight - 8))
    : 16;

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={{ left, top, width }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          className={`menu-item${item.danger ? ' danger' : ''}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose?.();
            item.onSelect?.();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
