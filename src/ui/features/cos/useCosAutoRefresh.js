import { useEffect } from 'react';
import { CHANNELS } from '../../data/ipc';

/**
 * Cos 页的"文件变化自动刷新"：Cos 索引在后台重建完成、或用户按 ⌘R 时重新取数。
 * 文件夹页监听的是当前目录，Cos 页监听的是索引，两者目的相同：看到的不是旧数据。
 */
export default function useCosAutoRefresh(reload) {
  useEffect(() => {
    const onRefresh = () => reload?.();
    window.addEventListener('pav:refresh', onRefresh);
    const api = window.electronAPI;
    let off = null;
    if (typeof api?.on === 'function') {
      off = api.on(CHANNELS.COS_INDEX_PROGRESS, (payload) => {
        if (payload?.done) reload?.();
      });
    }
    return () => {
      window.removeEventListener('pav:refresh', onRefresh);
      if (typeof off === 'function') off();
      else api?.removeListener?.(CHANNELS.COS_INDEX_PROGRESS);
    };
  }, [reload]);
}
