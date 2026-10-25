import { invoke, CHANNELS } from './ipc';

const SETTINGS_KEY = 'photoViewerSettings';

export const DEFAULT_SETTINGS = {
  autoRotateVerticalImages: false,
  rotationDirection: 'right',
  zoomStep: 0.2,
  showFilename: true,
  defaultDualPageViewer: false,
  theme: 'auto',
  homeSortGrouping: 'mixed',
  folderCoverMode: 'auto',
  defaultViewMode: 'grid'
};

/** 设置与旧界面共用同一个 localStorage 键，保证来回切换不丢。 */
export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch (_error) {
    return { ...DEFAULT_SETTINGS };
  }
}

export const SETTINGS_STORAGE_KEY = SETTINGS_KEY;

export function saveSettings(next) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('pav:settings-changed'));
}

export function applyTheme(theme) {
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
  const resolved = theme === 'auto' ? (prefersLight ? 'light' : 'dark') : theme;
  document.documentElement.dataset.theme = resolved === 'light' ? 'light' : 'dark';
}

export function getCacheStats() {
  return invoke(CHANNELS.GET_CACHE_STATS);
}

export function clearThumbnailCache() {
  return invoke(CHANNELS.CLEAR_THUMBNAIL_CACHE);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
