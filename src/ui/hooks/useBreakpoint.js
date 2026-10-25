import React, { useEffect, useState } from 'react';

/**
 * 按窗口宽度分档，与设计稿断点表一致（shell-spec-status 七）：
 * wide ≥1440 / regular 1100–1439 / medium 900–1099 / compact 700–899 / small <700。
 * 竖屏（高 > 宽）按宽度算。
 */
export function isNarrowBreakpoint(breakpoint) {
  return breakpoint === 'medium' || breakpoint === 'compact' || breakpoint === 'small';
}

export default function useBreakpoint() {
  const resolve = (width) => {
    if (width >= 1440) return 'wide';
    if (width >= 1100) return 'regular';
    if (width >= 900) return 'medium';
    if (width >= 700) return 'compact';
    return 'small';
  };
  const [breakpoint, setBreakpoint] = useState(() => resolve(window.innerWidth));

  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBreakpoint(resolve(window.innerWidth)));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return breakpoint;
}
