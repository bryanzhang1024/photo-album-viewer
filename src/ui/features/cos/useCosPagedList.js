import { useCallback, useEffect, useRef, useState } from 'react';

const PAGE_SIZE = 60;

/** Cos 列表分页：换条件重载，滚到底继续加载；reload 用于 ⌘R 与索引更新后重取。 */
export default function useCosPagedList(fetcher, options) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const key = JSON.stringify(options);

  useEffect(() => {
    let alive = true;
    setItems([]);
    setTotal(0);
    setLoading(true);
    setError('');
    fetcher({ ...optionsRef.current, offset: 0, limit: PAGE_SIZE })
      .then((result) => {
        if (!alive) return;
        setItems(result.items || []);
        setTotal(result.total || 0);
      })
      .catch((reason) => {
        if (alive) setError(reason?.message || '加载失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, key, tick]);

  const loadMore = useCallback(() => {
    setLoading((current) => {
      if (current) return current;
      return current;
    });
    if (loading || items.length >= total) return;
    setLoading(true);
    fetcher({ ...optionsRef.current, offset: items.length, limit: PAGE_SIZE })
      .then((result) => {
        setItems((prev) => [...prev, ...(result.items || [])]);
        setTotal(result.total || 0);
      })
      .catch((reason) => setError(reason?.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [fetcher, items.length, total, loading]);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  return { items, total, loading, error, loadMore, reload, hasMore: items.length < total };
}
