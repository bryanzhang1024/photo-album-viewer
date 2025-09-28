import { useState, useEffect } from 'react';

function useIsVisible(ref) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // 当元素进入或离开视口时，更新状态
        if (entry.isIntersecting) {
          setIsVisible(true);
          // 一旦可见，就不再需要观察，以节省资源
          observer.unobserve(ref.current);
        }
      },
      {
        // 当元素进入视口100px时，就开始加载
        rootMargin: '100px',
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, [ref]);

  return isVisible;
}

export default useIsVisible;
