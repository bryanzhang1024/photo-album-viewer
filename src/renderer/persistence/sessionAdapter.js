import { isBrowserLocation } from '../domain/browserLocation';

export const SESSION_V1_KEY = 'browser_tabs_session_v1';
export const SESSION_V2_KEY = 'browser_tabs_session_v2';
export const SNAPSHOT_V1_KEY = 'browser_tabs_snapshot_v1';
export const SNAPSHOT_V2_KEY = 'browser_tabs_snapshot_v2';
export const SESSION_V3_KEY = 'browser_tabs_session_v3';
export const SNAPSHOT_V3_KEY = 'browser_tabs_snapshot_v3';

export const LEGACY_NAVIGATION_STORAGE_KEYS = Object.freeze([
  SESSION_V1_KEY,
  SESSION_V2_KEY,
  SNAPSHOT_V1_KEY,
  SNAPSHOT_V2_KEY,
  'lastPath',
  'lastRootPath_default'
]);

const hasExactFields = (value, fields) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => (
    Object.prototype.hasOwnProperty.call(value, field)
  ));
};

const parseStoredJson = (storage, key) => {
  try {
    const raw = storage.getItem(key);
    return typeof raw === 'string' && raw.length > 0 ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
};

const toRuntimeV3Session = (payload) => {
  if (!hasExactFields(payload, [
    'schemaVersion',
    'tabs',
    'activeTabId',
    'savedAt'
  ]) || payload.schemaVersion !== 3 || !Array.isArray(payload.tabs)
      || payload.tabs.length === 0 || typeof payload.activeTabId !== 'string'
      || !Number.isSafeInteger(payload.savedAt) || payload.savedAt < 0) {
    return null;
  }

  const ids = new Set();
  for (const tab of payload.tabs) {
    if (!hasExactFields(tab, ['id', 'location'])
        || typeof tab.id !== 'string' || tab.id.length === 0
        || ids.has(tab.id) || !isBrowserLocation(tab.location)) {
      return null;
    }
    ids.add(tab.id);
  }

  if (!ids.has(payload.activeTabId)) return null;
  return { tabs: payload.tabs, activeTabId: payload.activeTabId };
};

export const clearLegacyNavigationStorage = (storage) => {
  const keys = new Set(LEGACY_NAVIGATION_STORAGE_KEYS);
  try {
    if (Number.isSafeInteger(storage.length) && typeof storage.key === 'function') {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (typeof key === 'string' && key.startsWith('lastRootPath_')) keys.add(key);
      }
    }
  } catch (error) {
    console.warn('枚举旧导航状态失败', error);
  }

  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn(`清理旧导航状态失败: ${key}`, error);
    }
  }
};

export const loadTabsSession = ({ storage, snapshot = false }) => {
  const key = snapshot ? SNAPSHOT_V3_KEY : SESSION_V3_KEY;
  return toRuntimeV3Session(parseStoredJson(storage, key));
};

const serializeBrowserLocation = (location) => {
  if (!isBrowserLocation(location)) {
    throw new TypeError('Invalid BrowserLocation');
  }

  if (location.kind === 'directory') {
    return {
      kind: 'directory',
      target: {
        sourceId: location.target.sourceId,
        relativePath: location.target.relativePath,
        viewMode: location.target.viewMode,
        initialMediaRelativePath: location.target.initialMediaRelativePath
      }
    };
  }

  return { kind: location.kind };
};

export const createTabsSessionPayload = (tabs, activeTabId, now = Date.now()) => {
  const payload = {
    schemaVersion: 3,
    tabs: tabs.map((tab) => ({
      id: tab.id,
      location: serializeBrowserLocation(tab.location)
    })),
    activeTabId,
    savedAt: now
  };

  if (!toRuntimeV3Session(payload)) {
    throw new TypeError('Invalid tabs session payload');
  }
  return payload;
};

export const saveTabsSession = ({
  storage,
  tabs,
  activeTabId,
  snapshot = false,
  now = Date.now()
}) => {
  const payload = createTabsSessionPayload(tabs, activeTabId, now);
  storage.setItem(snapshot ? SNAPSHOT_V3_KEY : SESSION_V3_KEY, JSON.stringify(payload));
  return payload;
};
