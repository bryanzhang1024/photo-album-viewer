// 统一的布局配置系统 - 简化设计
export const LAYOUT_CONFIG = {
  // 响应式断点
  breakpoints: {
    mobile: 600,
    tablet: 768,
    laptop: 1024,
    desktop: 1200,
    ultrawide: 1600
  },

  // 密度配置（替代紧凑/标准模式）
  densities: {
    compact: { multiplier: 0.8, label: '紧凑', baseWidth: 200 },
    standard: { multiplier: 1.0, label: '标准', baseWidth: 250 },
    comfortable: { multiplier: 1.2, label: '宽松', baseWidth: 300 }
  },

  // 统一的间距系统
  spacing: {
    xs: 8,
    sm: 16,
    md: 24,
    lg: 32
  },

  // 卡片基础配置
  card: {
    minWidth: 180,
    maxWidth: 400,
    borderRadius: 8,
    aspectRatio: 1.33 // 4:3
  },

  // 流体列数计算 - 无最大限制
  getFluidColumns: (containerWidth, density = 'standard', spacing = 24) => {
    const baseWidth = LAYOUT_CONFIG.densities[density].baseWidth;
    return Math.max(1, Math.floor((containerWidth + spacing) / (baseWidth + spacing)));
  },

  // 获取响应式间距
  getResponsiveSpacing: (isSmallScreen) => {
    return isSmallScreen ? LAYOUT_CONFIG.spacing.sm : LAYOUT_CONFIG.spacing.md;
  },

  // 设备类型检测
  getDeviceType: (width) => {
    const { breakpoints } = LAYOUT_CONFIG;
    if (width < breakpoints.mobile) return 'mobile';
    if (width < breakpoints.tablet) return 'tablet';
    if (width < breakpoints.laptop) return 'laptop';
    if (width < breakpoints.desktop) return 'desktop';
    return 'ultrawide';
  }
};

// 统一的响应式Hook
export const useResponsiveLayout = () => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight
  });
  
  const [userDensity, setUserDensity] = useState(() => {
    return localStorage.getItem('userDensity') || 'standard';
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const saveDensity = (density) => {
    setUserDensity(density);
    localStorage.setItem('userDensity', density);
  };

  return {
    ...dimensions,
    userDensity,
    setUserDensity: saveDensity,
    deviceType: LAYOUT_CONFIG.getDeviceType(dimensions.width),
    spacing: LAYOUT_CONFIG.getResponsiveSpacing(dimensions.width < 600)
  };
};