import React from 'react';
import { CloseIcon, PlusIcon } from '../icons';

/**
 * Finder 式标签栏：页签 + 关闭按钮 + 新建。
 * S0 只有一个占位页签，交互在 S1 接入。
 */
export default function TabBar({ tabs = [], onSelect, onClose, onNew }) {
  return (
    <div className="tabbar" role="tablist" aria-label="标签页">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="tab"
          role="tab"
          aria-selected={tab.active ? 'true' : 'false'}
          onClick={() => onSelect?.(tab.id)}
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
