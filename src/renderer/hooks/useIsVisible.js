import { useState, useEffect } from 'react';

function useIsVisible(ref) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const isElement = (value) => (
      typeof Element !== 'undefined' && value instanceof Element
    );
    const target = ref.current;

    if (!isElement(target)) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // 当元素进入或离开视口时，更新状态
        if (entry.isIntersecting) {
          setIsVisible(true);
          // 一旦可见，就不再需要观察，以节省资源
          if (isElement(entry.target)) {
            observer.unobserve(entry.target);
          }
        }
      },
      {
        // 当元素进入视口100px时，就开始加载
        rootMargin: '100px',
      }
    );

    observer.observe(target);

    return () => {
      if (isElement(target)) {
        observer.unobserve(target);
      }
      observer.disconnect();
    };
  }, [ref]);

  return isVisible;
}

export default useIsVisible;
