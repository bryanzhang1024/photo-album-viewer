import { useEffect, useState } from 'react';

/**
 * 网格键盘导航：与文件夹页一致——↑↓←→ 移动选中、Home/End 首尾、Enter 打开、Esc 清选中。
 * 网格点击仍然直接打开；选中态只服务键盘，不改变鼠标习惯。
 */
export default function useGridSelection({ items = [], onOpen, escapeAction, enabled = true }) {
  const [selectedKey, setSelectedKey] = useState('');

  // 数据刷新/翻页后，选中项还在就保留，不在了就清掉
  useEffect(() => {
    if (!selectedKey) return;
    if (!items.some((item) => item.key === selectedKey)) setSelectedKey('');
  }, [items, selectedKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    const isEditableTarget = (target) => {
      if (!target) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };
    const move = (step) => {
      if (items.length === 0) return;
      const current = items.findIndex((item) => item.key === selectedKey);
      const next = current < 0
        ? (step > 0 ? 0 : items.length - 1)
        : Math.min(items.length - 1, Math.max(0, current + step));
      setSelectedKey(items[next].key);
    };
    const jump = (toEnd) => {
      if (items.length === 0) return;
      setSelectedKey(items[toEnd ? items.length - 1 : 0].key);
    };
    const onKey = (event) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        if (selectedKey) {
          event.preventDefault();
          setSelectedKey('');
        } else {
          escapeAction?.();
        }
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        jump(false);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        jump(true);
        return;
      }
      if (event.key === 'Enter' && selectedKey) {
        const item = items.find((entry) => entry.key === selectedKey);
        if (item) {
          event.preventDefault();
          onOpen?.(item);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedKey, onOpen, escapeAction, enabled]);

  // 键盘移动后把选中卡滚进可视区
  useEffect(() => {
    if (!selectedKey) return;
    const selector = `[data-key="${String(selectedKey).replace(/["\\]/g, '\\$&')}"]`;
    document.querySelector(selector)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedKey]);

  return [selectedKey, setSelectedKey];
}
