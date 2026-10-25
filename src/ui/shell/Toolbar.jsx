import React from 'react';
import { SidebarIcon, ChevronLeftIcon, ChevronRightIcon } from '../icons';

/**
 * 窗口工具栏：侧栏开关、前进后退、居中标题。
 * macOS 上左侧给红绿灯留出拖拽区；工具栏本身是窗口拖拽区。
 */
export default function Toolbar({ title, sidebarCollapsed, onToggleSidebar, onBack, onForward, canGoBack = false, canGoForward = false, right = null }) {
  const isMac = window.electronAPI?.platform === 'darwin';
  return (
    <header
      className="toolbar"
      aria-label="窗口工具栏"
      style={isMac ? undefined : { paddingLeft: 8 }}
    >
      <button
        className="icon-button"
        type="button"
        aria-label={sidebarCollapsed ? '显示侧栏' : '隐藏侧栏'}
        aria-pressed={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>
      <button className="icon-button" type="button" aria-label="后退" disabled={!canGoBack} onClick={onBack}>
        <ChevronLeftIcon />
      </button>
      <button className="icon-button" type="button" aria-label="前进" disabled={!canGoForward} onClick={onForward}>
        <ChevronRightIcon />
      </button>
      <span className="toolbar-title">{title}</span>
      {right ? <div className="toolbar-right">{right}</div> : null}
    </header>
  );
}
