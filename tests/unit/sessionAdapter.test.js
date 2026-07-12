import {
  LEGACY_NAVIGATION_STORAGE_KEYS,
  SESSION_V1_KEY,
  SESSION_V2_KEY,
  SESSION_V3_KEY,
  SNAPSHOT_V1_KEY,
  SNAPSHOT_V2_KEY,
  SNAPSHOT_V3_KEY,
  clearLegacyNavigationStorage,
  createTabsSessionPayload,
  loadTabsSession,
  saveTabsSession
} from '../../src/renderer/persistence/sessionAdapter';

const NOW = 1783785600000;
const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

const createDirectoryLocation = (overrides = {}) => ({
  kind: 'directory',
  target: {
    sourceId: SOURCE_ID,
    relativePath: '2026/旅行',
    viewMode: 'photoSet',
    initialMediaRelativePath: '2026/旅行/001.jpg',
    ...overrides
  }
});

const createPayload = (overrides = {}) => ({
  schemaVersion: 3,
  tabs: [{ id: 'tab-v3', location: createDirectoryLocation() }],
  activeTabId: 'tab-v3',
  savedAt: NOW,
  ...overrides
});

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get length() { return values.size; },
    key: jest.fn((index) => [...values.keys()][index] ?? null),
    getItem: jest.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key))
  };
};

describe('browser tabs session v3 adapter', () => {
  test('loads only the v3 session key and ignores legacy session bytes', () => {
    const payload = createPayload();
    const storage = createStorage({
      [SESSION_V1_KEY]: '{"legacy":1}',
      [SESSION_V2_KEY]: '{"schemaVersion":2}',
      [SESSION_V3_KEY]: JSON.stringify(payload)
    });

    expect(loadTabsSession({ storage })).toEqual({
      tabs: payload.tabs,
      activeTabId: payload.activeTabId
    });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(SESSION_V3_KEY);
  });

  test('does not migrate a legacy-only session', () => {
    const storage = createStorage({
      [SESSION_V1_KEY]: '{"tabs":[]}',
      [SESSION_V2_KEY]: JSON.stringify({ schemaVersion: 2, tabs: [] })
    });

    expect(loadTabsSession({ storage })).toBeNull();
    expect(storage.getItem).toHaveBeenCalledWith(SESSION_V3_KEY);
  });

  test('clears only legacy navigation keys and preserves unrelated application state', () => {
    const initial = {
      [SESSION_V1_KEY]: 'v1-session',
      [SESSION_V2_KEY]: 'v2-session',
      [SNAPSHOT_V1_KEY]: 'v1-snapshot',
      [SNAPSHOT_V2_KEY]: 'v2-snapshot',
      lastRootPath_encoded_window: '/Old/Window',
      favorites: 'keep-favorites',
      theme: 'dark',
      [SESSION_V3_KEY]: 'keep-v3'
    };
    const storage = createStorage(initial);

    clearLegacyNavigationStorage(storage);

    expect(storage.removeItem.mock.calls.map(([key]) => key)).toEqual([
      ...LEGACY_NAVIGATION_STORAGE_KEYS,
      'lastRootPath_encoded_window'
    ]);
    expect(storage.values.has('lastRootPath_encoded_window')).toBe(false);
    expect(storage.values.get('favorites')).toBe('keep-favorites');
    expect(storage.values.get('theme')).toBe('dark');
    expect(storage.values.get(SESSION_V3_KEY)).toBe('keep-v3');
  });

  test('continues cleanup when one legacy key removal fails', () => {
    const storage = createStorage();
    storage.removeItem.mockImplementation((key) => {
      if (key === SESSION_V1_KEY) throw new Error('storage unavailable');
      storage.values.delete(key);
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    clearLegacyNavigationStorage(storage);

    expect(storage.removeItem).toHaveBeenCalledTimes(LEGACY_NAVIGATION_STORAGE_KEYS.length);
    expect(warn).toHaveBeenCalledWith(
      `清理旧导航状态失败: ${SESSION_V1_KEY}`,
      expect.any(Error)
    );
    warn.mockRestore();
  });

  test('serializes only schema v3 canonical data', () => {
    const tabs = [{
      id: 'tab-v3',
      title: '旅行',
      targetPath: '/Volumes/Photos/2026/旅行',
      location: createDirectoryLocation()
    }];

    expect(createTabsSessionPayload(tabs, 'tab-v3', NOW)).toEqual(createPayload());
  });

  test.each([
    { kind: 'legacyAbsolute', legacyAbsolutePath: '/Photos', viewMode: 'folder', legacyInitialMediaPath: null },
    { kind: 'directory', target: { ...createDirectoryLocation().target, relativePath: '../escape' } }
  ])('rejects non-canonical persisted locations', (location) => {
    expect(() => createTabsSessionPayload(
      [{ id: 'bad-tab', location }],
      'bad-tab',
      NOW
    )).toThrow(TypeError);
  });

  test.each([
    ['wrong schema', { schemaVersion: 2 }],
    ['empty tabs', { tabs: [] }],
    ['missing active tab', { activeTabId: 'missing' }],
    ['duplicate tab ids', { tabs: [
      createPayload().tabs[0],
      createPayload().tabs[0]
    ] }]
  ])('rejects invalid v3 payload: %s', (_name, overrides) => {
    const storage = createStorage({
      [SESSION_V3_KEY]: JSON.stringify(createPayload(overrides))
    });

    expect(loadTabsSession({ storage })).toBeNull();
  });

  test.each([
    [false, SESSION_V3_KEY],
    [true, SNAPSHOT_V3_KEY]
  ])('writes only the selected v3 key when saving (snapshot=%s)', (snapshot, key) => {
    const storage = createStorage();
    const tabs = createPayload().tabs;

    const payload = saveTabsSession({
      storage,
      tabs,
      activeTabId: 'tab-v3',
      snapshot,
      now: NOW
    });

    expect(payload).toEqual(createPayload());
    expect(storage.setItem).toHaveBeenCalledWith(key, JSON.stringify(payload));
  });
});
