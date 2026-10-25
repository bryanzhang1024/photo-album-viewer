import { useEffect, useState } from 'react';
import { getDirectoryLevel, toFolderItems } from '../../data/directory';

/** 读取一层目录快照并摊平成卡片列表。 */
export default function useFolderSnapshot(source, relativePath) {
  const [state, setState] = useState({ status: 'idle', snapshot: null, items: [], error: '' });

  useEffect(() => {
    const sourceId = source?.sourceId;
    if (!sourceId) return undefined;
    let alive = true;
    setState({ status: 'loading', snapshot: null, items: [], error: '' });
    getDirectoryLevel(source, relativePath)
      .then((snapshot) => {
        if (alive) {
          setState({ status: 'ready', snapshot, items: toFolderItems(snapshot), error: '' });
        }
      })
      .catch((error) => {
        if (alive) {
          setState({ status: 'error', snapshot: null, items: [], error: error?.message || '目录扫描失败' });
        }
      });
    return () => {
      alive = false;
    };
  }, [source, relativePath]);

  return state;
}
