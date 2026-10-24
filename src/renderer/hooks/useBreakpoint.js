import { useEffect, useState } from 'react';
import { breakpoints } from '../theme/tokens';

/**
 * 当前窗口宽度与断点档位。
 * 档位与设计稿一致：xl ≥1440、lg 1100–1439、md 900–1099、sm 700–899、xs <700（最小窗口）。
 */
export function useBreakpoint() {
  const [width, setWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth : breakpoints.xl
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  let bucket = 'xs';
  if (width >= breakpoints.xl) bucket = 'xl';
  else if (width >= breakpoints.lg) bucket = 'lg';
  else if (width >= breakpoints.md) bucket = 'md';
  else if (width >= breakpoints.sm) bucket = 'sm';

  return {
    width,
    bucket,
    isNarrow: width < breakpoints.md,
    isCompact: width < breakpoints.lg
  };
}
