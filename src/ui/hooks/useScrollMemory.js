import { createContext, useContext, useLayoutEffect, useRef } from 'react';

// 由 App 按标签和页面持有；只在本次运行中保留，不写用户数据库或 localStorage。
export const ScrollMemoryContext = createContext(null);

/** 在虚拟列表完成测量和数据加载后恢复锚点，同时同步它的可视行计算。 */
export default function useScrollMemory(ref, {
  slot,
  items,
  indexAtOffset,
  offsetForIndex,
  ready,
  hasMore = false,
  onLoadMore,
  onRestore
}) {
  const memory = useContext(ScrollMemoryContext);
  const pending = useRef(Boolean(memory?.[slot]));
  const latest = useRef(null);
  const requestedLength = useRef(-1);

  const remember = (el) => {
    if (!memory || !el || pending.current || items.length === 0) return;
    const index = Math.min(items.length - 1, Math.max(0, indexAtOffset(el.scrollTop)));
    memory[slot] = {
      top: el.scrollTop,
      anchor: items[index].key,
      index,
      offset: el.scrollTop - offsetForIndex(index),
      count: items.length
    };
  };
  latest.current = remember;

  useLayoutEffect(() => {
    const el = ref.current;
    const saved = memory?.[slot];
    if (!pending.current || !saved || !el || !ready || items.length === 0) return;
    // 照片 IPC 单次最多返回 1000 张；达到旧范围之前不能按短列表恢复。
    if (items.length < saved.count && hasMore && onLoadMore) {
      if (requestedLength.current !== items.length) {
        requestedLength.current = items.length;
        onLoadMore();
      }
      return;
    }
    const found = items.findIndex((item) => item.key === saved.anchor);
    // 锚点被删时保留附近的序号；内容变短时由真实滚动范围截断。
    const index = found >= 0 ? found : Math.min(saved.index, items.length - 1);
    const top = offsetForIndex(index) + saved.offset;
    el.scrollTop = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
    pending.current = false;
    onRestore(el.scrollTop);
  });

  useLayoutEffect(() => {
    const el = ref.current;
    // 即使最后一次滚动事件尚未送达，切走前也读取真实位置。
    return () => latest.current?.(el);
  }, [ref]);

  return remember;
}
