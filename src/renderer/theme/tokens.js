/**
 * 设计 token：暗色为默认观感，浅色是同一套语义的另一组值。
 * 任何新增颜色都应从这里取，不再在组件里写死。
 */

const dark = {
  mode: 'dark',
  canvas: '#111113',
  background: '#1c1c1e',
  chrome: '#2a2a2c',
  sidebar: '#232325',
  panel: '#232325',
  separator: 'rgba(255, 255, 255, 0.085)',
  separatorStrong: 'rgba(255, 255, 255, 0.14)',
  text: '#e9e9ec',
  textDim: '#98989f',
  textDimmer: '#6f6f76',
  accent: '#0a84ff',
  accentText: '#ffffff',
  selection: 'rgba(255, 255, 255, 0.10)',
  hover: 'rgba(255, 255, 255, 0.055)',
  danger: '#ff6b6b',
  scrollbarTrack: '#2a2a2a',
  scrollbarThumb: '#555555',
  scrollbarThumbHover: '#777777'
};

const light = {
  mode: 'light',
  canvas: '#f4f4f6',
  background: '#ffffff',
  chrome: '#f0f0f2',
  sidebar: '#ececee',
  panel: '#ffffff',
  separator: 'rgba(0, 0, 0, 0.09)',
  separatorStrong: 'rgba(0, 0, 0, 0.16)',
  text: '#1d1d1f',
  textDim: '#6e6e73',
  textDimmer: '#8e8e93',
  accent: '#007aff',
  accentText: '#ffffff',
  selection: 'rgba(0, 0, 0, 0.07)',
  hover: 'rgba(0, 0, 0, 0.04)',
  danger: '#d70015',
  scrollbarTrack: '#f1f1f1',
  scrollbarThumb: '#c1c1c1',
  scrollbarThumbHover: '#a8a8a8'
};

export const paletteByMode = { dark, light };

export const spacing = {
  toolbarHeight: 46,
  tabBarHeight: 30,
  statusBarHeight: 24,
  sidebarWidth: 216,
  sidebarWidthWide: 240,
  contentPaddingX: 22,
  contentPaddingY: 16,
  cardGapX: 14,
  cardGapY: 16
};

export const radii = {
  window: 11,
  card: 7,
  control: 6,
  segmented: 7
};

export const typography = {
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"SF Pro Text"',
    '"PingFang SC"',
    '"Helvetica Neue"',
    'sans-serif'
  ].join(','),
  title: 22,
  titleCompact: 14.5,
  body: 12.5,
  caption: 11,
  cardTitle: 12
};

export const breakpoints = {
  xl: 1440,
  lg: 1100,
  md: 900,
  sm: 700
};

export const windowLimits = {
  minWidth: 720,
  minHeight: 480
};

export function getPalette(mode) {
  return mode === 'dark' ? dark : light;
}
