import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke, CHANNELS } from '../data/ipc';

const isEditable = target => Boolean(target?.isContentEditable
  || target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));

/** 只管理照片多选；键盘导航和查看器仍由原入口负责。items 是当前有序的 {key,path}。 */
export default function useImageMultiSelection({ items, scopeKey, enabled = true }) {
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [message, setMessage] = useState('');
  const anchor = useRef(null);
  const copyGeneration = useRef(0);
  const selectableKeys = useMemo(() => new Set(items.map(item => item.key)), [items]);
  const selectedPaths = useMemo(() => [...new Set(items.filter(item => selectedKeys.has(item.key)).map(item => item.path))], [items, selectedKeys]);

  const clear = useCallback(() => {
    setSelectedKeys(new Set());
    anchor.current = null;
    copyGeneration.current++;
    setMessage('');
  }, []);
  useEffect(() => { clear(); }, [scopeKey, clear]);
  useEffect(() => {
    setSelectedKeys(prev => {
      if ([...prev].every(key => selectableKeys.has(key))) return prev;
      return new Set([...prev].filter(key => selectableKeys.has(key)));
    });
    if (!selectableKeys.has(anchor.current)) anchor.current = null;
  }, [selectableKeys]);

  const handleClick = useCallback((key, event) => {
    if (!enabled || !selectableKeys.has(key) || !(event.metaKey || event.shiftKey)) return false;
    event.preventDefault();
    copyGeneration.current++;
    setMessage('');
    if (event.shiftKey) {
      const to = items.findIndex(item => item.key === key);
      const from = items.findIndex(item => item.key === anchor.current);
      setSelectedKeys(new Set(items.slice(from < 0 ? to : Math.min(from, to), Math.max(from, to) + 1).map(item => item.key)));
      if (from < 0) anchor.current = key;
    } else {
      setSelectedKeys(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      anchor.current = key;
    }
    return true;
  }, [enabled, items, selectableKeys]);

  const setBoxSelection = useCallback(keys => {
    const valid = keys.filter(key => selectableKeys.has(key));
    setSelectedKeys(new Set(valid));
    anchor.current = valid[0] ?? null;
    copyGeneration.current++;
    setMessage('');
  }, [selectableKeys]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onCopy = event => {
      if (!selectedPaths.length || isEditable(document.activeElement) || isEditable(event.target)
        || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      const generation = ++copyGeneration.current;
      setMessage('正在复制…');
      invoke(CHANNELS.COPY_IMAGES_TO_CLIPBOARD, selectedPaths)
        .then(result => {
          if (!result?.success) throw new Error(result?.error || '未能写入系统剪贴板');
          if (generation === copyGeneration.current) setMessage(`已复制 ${result.count} 张原图`);
        })
        .catch(error => {
          if (generation === copyGeneration.current) setMessage(`复制失败：${error?.message || '请重试'}`);
        });
    };
    // 原生菜单命令与系统默认 copy 事件使用同一条处理路径，避免键盘/菜单各写一次。
    window.addEventListener('pav:copy-selection', onCopy);
    window.addEventListener('copy', onCopy);
    return () => {
      window.removeEventListener('pav:copy-selection', onCopy);
      window.removeEventListener('copy', onCopy);
      copyGeneration.current++;
    };
  }, [enabled, selectedPaths, clear]);

  return { selectedKeys, selectableKeys, selectedPaths, message, handleClick, setBoxSelection, clear };
}
