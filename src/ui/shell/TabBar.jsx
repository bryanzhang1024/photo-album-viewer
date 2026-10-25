import React, { useState } from 'react';
import { CloseIcon, PlusIcon } from '../icons';

/**
 * Finder 式标签栏：页签 + 关闭按钮 + 新建。
 * S0 只有一个占位页签，交互在 S1 接入。
 */
export default function TabBar({ tabs = [], onSelect, onClose, onNew, onContextMenu, onReorder }) {
  const [draggingId, setDraggingId] = useState(null);
  return (
    <div className="tabbar" role="tablist" aria-label="标签页">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${draggingId === tab.id ? ' dragging' : ''}`}
          role="tab"
          aria-selected={tab.active ? 'true' : 'false'}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', tab.id);
            setDraggingId(tab.id);
          }}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(event) => {
            if (draggingId && draggingId !== tab.id) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sourceId = draggingId || event.dataTransfer.getData('text/plain');
            if (sourceId && sourceId !== tab.id) onReorder?.(sourceId, tab.id);
            setDraggingId(null);
          }}
          onClick={() => onSelect?.(tab.id)}
          onContextMenu={(event) => {
            if (!onContextMenu) return;
            event.preventDefault();
            onContextMenu(event, tab.id);
          }}
        >
          <span>{tab.title}</span>
          <button
            className="tab-close"
            type="button"
            aria-label={`关闭 ${tab.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose?.(tab.id);
            }}
          >
            <CloseIcon />
          </button>
        </div>
      ))}
      <button className="tab-add" type="button" aria-label="新建标签页" onClick={onNew}>
        <PlusIcon />
      </button>
    </div>
  );
}
