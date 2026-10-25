import { invoke, CHANNELS } from './ipc';

const SETTINGS_KEY = 'photoViewerSettings';

export const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS = {
  autoRotateVerticalImages: false,
  rotationDirection: 'right',
  zoomStep: 0.2,
  showFilename: true,
  defaultDualPageViewer: false,
  theme: 'auto',
  homeSortGrouping: 'grouped',
  folderCoverMode: 'auto',
  defaultViewMode: 'grid'
};

/** 设置与旧界面共用同一个 localStorage 键，保证来回切换不丢。 */
export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS, settingsVersion: SETTINGS_VERSION };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (parsed?.settingsVersion !== SETTINGS_VERSION) {
      // 旧版没有版本号：'mixed' 是当时的默认值，不是用户明确选择，
      // 迁移成 4.1 的默认「文件夹置顶」，避免升级后还混排。
      if (parsed?.settingsVersion === undefined && merged.homeSortGrouping === 'mixed') {
        merged.homeSortGrouping = DEFAULT_SETTINGS.homeSortGrouping;
      }
      merged.settingsVersion = SETTINGS_VERSION;
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
      } catch (_error) {
        // 写不进去就只在本次运行生效
      }
    }
    return merged;
  } catch (_error) {
    return { ...DEFAULT_SETTINGS, settingsVersion: SETTINGS_VERSION };
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
