import {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  isPortableRelativePath,
  normalizeAbsolutePath,
  resolvePortableRelativePath
} from '../../common/path-codec';
import { toCanonicalViewMode } from '../../common/contracts/navigation-contract-v1';
import { isBrowserLocation } from '../domain/browserLocation';

export const SESSION_V1_KEY = 'browser_tabs_session_v1';
export const SESSION_V2_KEY = 'browser_tabs_session_v2';
export const SNAPSHOT_V1_KEY = 'browser_tabs_snapshot_v1';
export const SNAPSHOT_V2_KEY = 'browser_tabs_snapshot_v2';

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

const toRuntimeV2Session = (payload) => {
  if (!hasExactFields(payload, [
    'schemaVersion',
    'tabs',
    'activeTabId',
    'savedAt'
  ]) || payload.schemaVersion !== 2 || !Array.isArray(payload.tabs)
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

const normalizeLegacyViewMode = (viewMode) => (viewMode === 'album' ? 'album' : 'folder');

const getCanonicalInitialMediaPath = (initialImage, sourceRoot, directoryRelativePath) => {
  if (typeof initialImage !== 'string' || initialImage.length === 0) return null;

  const absoluteRelativePath = getPortableRelativePath(sourceRoot.rootPath, initialImage);
  if (absoluteRelativePath !== null) return absoluteRelativePath;

  if (!isPortableRelativePath(initialImage)) return null;
  return directoryRelativePath
    ? `${directoryRelativePath}/${initialImage}`
    : initialImage;
};

const getLegacyInitialMediaPath = (initialImage, targetPath) => {
  if (typeof initialImage !== 'string' || initialImage.length === 0) return null;

  try {
    return normalizeAbsolutePath(initialImage).absolutePath;
  } catch (_error) {
    if (!isPortableRelativePath(initialImage)) return null;
    return resolvePortableRelativePath(targetPath, initialImage);
  }
};

const migrateV1Tab = (tab, sources) => {
  if (tab === null || typeof tab !== 'object' || Array.isArray(tab)
      || typeof tab.id !== 'string' || tab.id.length === 0) {
    return null;
  }

  if (tab.viewMode === 'favorites') {
    return { id: tab.id, location: { kind: 'favorites' } };
  }

  if (typeof tab.targetPath !== 'string' || tab.targetPath.length === 0) {
    return { id: tab.id, location: { kind: 'landing' } };
  }

  let targetPath;
  try {
    targetPath = normalizeAbsolutePath(tab.targetPath).absolutePath;
  } catch (_error) {
    return null;
  }

  const viewMode = normalizeLegacyViewMode(tab.viewMode);
  const match = findUniqueLongestSourceRoot(sources, targetPath);
  if (match.status === 'resolved') {
    return {
      id: tab.id,
      location: {
        kind: 'directory',
        target: {
          sourceId: match.source.sourceId,
          relativePath: match.relativePath,
          viewMode: toCanonicalViewMode(viewMode),
          initialMediaRelativePath: getCanonicalInitialMediaPath(
            tab.initialImage,
            match.source,
            match.relativePath
          )
        }
      }
    };
  }

  return {
    id: tab.id,
    location: {
      kind: 'legacyAbsolute',
      legacyAbsolutePath: targetPath,
      viewMode,
      legacyInitialMediaPath: getLegacyInitialMediaPath(tab.initialImage, targetPath)
    }
  };
};

const migrateV1Session = (payload, sources) => {
  if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.tabs)) {
    return null;
  }

  const tabs = payload.tabs
    .map((tab) => migrateV1Tab(tab, sources))
    .filter(Boolean);
  if (tabs.length === 0) return null;

  const hasRequestedActiveTab = typeof payload.activeTabId === 'string'
    && tabs.some((tab) => tab.id === payload.activeTabId);
  return {
    tabs,
    activeTabId: hasRequestedActiveTab ? payload.activeTabId : tabs[0].id
  };
};

export const loadTabsSession = ({ storage, sources, snapshot = false }) => {
  const v2Key = snapshot ? SNAPSHOT_V2_KEY : SESSION_V2_KEY;
  const v1Key = snapshot ? SNAPSHOT_V1_KEY : SESSION_V1_KEY;
  const v2Session = toRuntimeV2Session(parseStoredJson(storage, v2Key));
  if (v2Session) return v2Session;

  return migrateV1Session(parseStoredJson(storage, v1Key), sources);
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

  if (location.kind === 'legacyAbsolute') {
    return {
      kind: 'legacyAbsolute',
      legacyAbsolutePath: location.legacyAbsolutePath,
      viewMode: location.viewMode,
      legacyInitialMediaPath: location.legacyInitialMediaPath
    };
  }

  return { kind: location.kind };
};

export const createTabsSessionPayload = (tabs, activeTabId, now = Date.now()) => ({
  schemaVersion: 2,
  tabs: tabs.map((tab) => ({
    id: tab.id,
    location: serializeBrowserLocation(tab.location)
  })),
  activeTabId,
  savedAt: now
});

export const saveTabsSession = ({
  storage,
  tabs,
  activeTabId,
  snapshot = false,
  now = Date.now()
}) => {
  const payload = createTabsSessionPayload(tabs, activeTabId, now);
  storage.setItem(snapshot ? SNAPSHOT_V2_KEY : SESSION_V2_KEY, JSON.stringify(payload));
  return payload;
};
