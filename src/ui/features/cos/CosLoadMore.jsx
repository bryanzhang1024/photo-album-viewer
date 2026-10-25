import React from 'react';

/** 滚动到底自动加载下一页。 */
export default function CosLoadMore({ onLoadMore, hasMore, loading }) {
  const sentinel = React.useRef(null);
  React.useEffect(() => {
    if (!hasMore || loading || !sentinel.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) onLoadMore?.();
    }, { rootMargin: '400px' });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (!hasMore) return null;
  return <div className="cos-more" ref={sentinel}>{loading ? '加载中…' : '继续滚动加载'}</div>;
}
