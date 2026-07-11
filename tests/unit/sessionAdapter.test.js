import browserTabsSessionV1 from '../fixtures/legacy/browser-tabs-session-v1.json';
import browserTabsSessionV1Unc from '../fixtures/legacy/browser-tabs-session-v1-unc.json';
import browserTabsSessionV1Windows from '../fixtures/legacy/browser-tabs-session-v1-windows.json';
import {
  SESSION_V1_KEY,
  SESSION_V2_KEY,
  SNAPSHOT_V1_KEY,
  SNAPSHOT_V2_KEY,
  createTabsSessionPayload,
  loadTabsSession,
  saveTabsSession
} from '../../src/renderer/persistence/sessionAdapter';

const NOW = 1783785600000;
const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';
const NESTED_SOURCE_ID = 'src_22222222-2222-4222-8222-222222222222';
const WINDOWS_SOURCE_ID = 'src_33333333-3333-4333-8333-333333333333';
const UNC_SOURCE_ID = 'src_44444444-4444-4444-8444-444444444444';

const createSource = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: SOURCE_ID,
  label: '照片',
  rootPath: '/albums',
  sourceGeneration: 1,
  ...overrides
});

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: jest.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key))
  };
};

const createV2Payload = (overrides = {}) => ({
  schemaVersion: 2,
  tabs: [
    {
      id: 'tab-v2',
      location: {
        kind: 'directory',
        target: {
          sourceId: SOURCE_ID,
          relativePath: 'v2-trip',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }
      }
    }
  ],
  activeTabId: 'tab-v2',
  savedAt: NOW,
  ...overrides
});

describe('browser tabs session adapter', () => {
  test('prefers a valid v2 session without reading the v1 key', () => {
    const v2Payload = createV2Payload();
    const storage = createStorage({
      [SESSION_V2_KEY]: JSON.stringify(v2Payload),
      [SESSION_V1_KEY]: JSON.stringify(browserTabsSessionV1)
    });

    expect(loadTabsSession({ storage, sources: [createSource()] })).toEqual({
      tabs: v2Payload.tabs,
      activeTabId: 'tab-v2'
    });
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(storage.getItem).toHaveBeenCalledWith(SESSION_V2_KEY);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test('migrates v1 folder/album tabs and resolves a bare cover below the current directory', () => {
    const storage = createStorage({
      [SESSION_V1_KEY]: JSON.stringify(browserTabsSessionV1)
    });

    expect(loadTabsSession({ storage, sources: [createSource()] })).toEqual({
      tabs: [
        {
          id: 'tab-folder',
          location: {
            kind: 'directory',
            target: {
              sourceId: SOURCE_ID,
              relativePath: 'trip',
              viewMode: 'browse',
              initialMediaRelativePath: null
            }
          }
        },
        {
          id: 'tab-album',
          location: {
            kind: 'directory',
            target: {
              sourceId: SOURCE_ID,
              relativePath: 'wedding',
              viewMode: 'photoSet',
              initialMediaRelativePath: 'wedding/cover.jpg'
            }
          }
        }
      ],
      activeTabId: 'tab-folder'
    });
  });

  test.each([
    ['/albums/trip/cover.jpg', 'trip/cover.jpg'],
    ['/albums/trip/nested/cover.jpg', 'trip/nested/cover.jpg'],
    ['/albums/other/cover.jpg', null],
    ['/albums/trip-archive/cover.jpg', null]
  ])('keeps absolute v1 media within the current directory boundary: %s', (
    initialImage,
    expectedMediaPath
  ) => {
    const session = {
      tabs: [{
        id: 'tab-trip',
        targetPath: '/albums/trip',
        viewMode: 'album',
        initialImage
      }],
      activeTabId: 'tab-trip'
    };
    const storage = createStorage({ [SESSION_V1_KEY]: JSON.stringify(session) });

    const loaded = loadTabsSession({ storage, sources: [createSource()] });

    expect(loaded.tabs[0].location.target).toEqual({
      sourceId: SOURCE_ID,
      relativePath: 'trip',
      viewMode: 'photoSet',
      initialMediaRelativePath: expectedMediaPath
    });
  });

  test('uses the unique longest nested root without probing the child path', () => {
    const nestedSession = {
      tabs: [{
        id: 'tab-family',
        targetPath: '/Photos/Family/Trip',
        viewMode: 'folder',
        initialImage: null
      }],
      activeTabId: 'tab-family'
    };
    const storage = createStorage({ [SESSION_V1_KEY]: JSON.stringify(nestedSession) });
    const sources = [
      createSource({ rootPath: '/Photos' }),
      createSource({
        sourceId: NESTED_SOURCE_ID,
        label: '家庭照片',
        rootPath: '/Photos/Family'
      })
    ];

    expect(loadTabsSession({ storage, sources })).toEqual({
      tabs: [{
        id: 'tab-family',
        location: {
          kind: 'directory',
          target: {
            sourceId: NESTED_SOURCE_ID,
            relativePath: 'Trip',
            viewMode: 'browse',
            initialMediaRelativePath: null
          }
        }
      }],
      activeTabId: 'tab-family'
    });
  });

  test('keeps no-match and ambiguous v1 paths as explicit legacyAbsolute locations', () => {
    const legacySession = {
      tabs: [
        {
          id: 'tab-no-match',
          targetPath: '/Other/Trip',
          viewMode: 'album',
          initialImage: 'cover.jpg'
        },
        {
          id: 'tab-ambiguous',
          targetPath: 'C:/Photos/Trip',
          viewMode: 'folder',
          initialImage: null
        }
      ],
      activeTabId: 'tab-no-match'
    };
    const storage = createStorage({ [SESSION_V1_KEY]: JSON.stringify(legacySession) });
    const sources = [
      createSource({ rootPath: '/Albums' }),
      createSource({ rootPath: 'C:/Photos' }),
      createSource({ sourceId: NESTED_SOURCE_ID, rootPath: 'c:\\photos' })
    ];

    expect(loadTabsSession({ storage, sources })).toEqual({
      tabs: [
        {
          id: 'tab-no-match',
          location: {
            kind: 'legacyAbsolute',
            legacyAbsolutePath: '/Other/Trip',
            viewMode: 'album',
            legacyInitialMediaPath: '/Other/Trip/cover.jpg'
          }
        },
        {
          id: 'tab-ambiguous',
          location: {
            kind: 'legacyAbsolute',
            legacyAbsolutePath: 'C:/Photos/Trip',
            viewMode: 'folder',
            legacyInitialMediaPath: null
          }
        }
      ],
      activeTabId: 'tab-no-match'
    });
  });

  test('migrates Windows and UNC fixtures with portable source-relative media paths', () => {
    const windowsStorage = createStorage({
      [SESSION_V1_KEY]: JSON.stringify(browserTabsSessionV1Windows)
    });
    const uncStorage = createStorage({
      [SESSION_V1_KEY]: JSON.stringify(browserTabsSessionV1Unc)
    });

    expect(loadTabsSession({
      storage: windowsStorage,
      sources: [createSource({
        sourceId: WINDOWS_SOURCE_ID,
        label: 'Windows 照片',
        rootPath: 'C:\\Photos'
      })]
    })).toEqual({
      tabs: [
        {
          id: 'tab-win-folder',
          location: {
            kind: 'directory',
            target: {
              sourceId: WINDOWS_SOURCE_ID,
              relativePath: 'Trips/2026',
              viewMode: 'browse',
              initialMediaRelativePath: null
            }
          }
        },
        {
          id: 'tab-win-album',
          location: {
            kind: 'directory',
            target: {
              sourceId: WINDOWS_SOURCE_ID,
              relativePath: 'Albums/Wedding',
              viewMode: 'photoSet',
              initialMediaRelativePath: 'Albums/Wedding/cover.jpg'
            }
          }
        }
      ],
      activeTabId: 'tab-win-album'
    });

    expect(loadTabsSession({
      storage: uncStorage,
      sources: [createSource({
        sourceId: UNC_SOURCE_ID,
        label: 'NAS 照片',
        rootPath: '\\\\NAS\\Photos'
      })]
    })).toEqual({
      tabs: [{
        id: 'tab-unc-album',
        location: {
          kind: 'directory',
          target: {
            sourceId: UNC_SOURCE_ID,
            relativePath: 'Family/Trip',
            viewMode: 'photoSet',
            initialMediaRelativePath: 'Family/Trip/cover.jpg'
          }
        }
      }],
      activeTabId: 'tab-unc-album'
    });
  });

  test.each([
    [false, SESSION_V2_KEY, SESSION_V1_KEY],
    [true, SNAPSHOT_V2_KEY, SNAPSHOT_V1_KEY]
  ])('falls back from invalid v2 without mutating the original v1 raw string (snapshot=%s)', (
    snapshot,
    v2Key,
    v1Key
  ) => {
    const v1Raw = `  ${JSON.stringify(browserTabsSessionV1, null, 2)}\n`;
    const invalidV2Raw = JSON.stringify(createV2Payload({
      tabs: [{
        id: 'bad-tab',
        location: {
          kind: 'directory',
          target: {
            sourceId: SOURCE_ID,
            relativePath: '/absolute-is-invalid',
            viewMode: 'browse',
            initialMediaRelativePath: null
          }
        }
      }],
      activeTabId: 'bad-tab'
    }));
    const storage = createStorage({ [v2Key]: invalidV2Raw, [v1Key]: v1Raw });

    const loaded = loadTabsSession({ storage, sources: [createSource()], snapshot });

    expect(loaded.tabs).toHaveLength(2);
    expect(storage.values.get(v1Key)).toBe(v1Raw);
    expect(storage.setItem).not.toHaveBeenCalledWith(v1Key, expect.anything());
    expect(storage.removeItem).not.toHaveBeenCalledWith(v1Key);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test('serializes only v2 BrowserLocation data and omits transient/absolute tab fields', () => {
    const tabs = [{
      id: 'tab-canonical',
      title: '旅行',
      rootPath: '/Volumes/Photos',
      absolutePath: '/Volumes/Photos/2026/旅行',
      targetPath: '/Volumes/Photos/2026/旅行',
      location: {
        kind: 'directory',
        target: {
          sourceId: SOURCE_ID,
          relativePath: '2026/旅行',
          viewMode: 'photoSet',
          initialMediaRelativePath: '2026/旅行/001.jpg'
        }
      }
    }];

    const payload = createTabsSessionPayload(tabs, 'tab-canonical', NOW);

    expect(payload).toEqual({
      schemaVersion: 2,
      tabs: [{ id: 'tab-canonical', location: tabs[0].location }],
      activeTabId: 'tab-canonical',
      savedAt: NOW
    });
    expect(JSON.stringify(payload)).not.toMatch(/rootPath|title|absolutePath|targetPath|Volumes/);
  });

  test.each([
    [false, SESSION_V2_KEY],
    [true, SNAPSHOT_V2_KEY]
  ])('writes only the selected v2 key when saving (snapshot=%s)', (snapshot, expectedKey) => {
    const storage = createStorage({
      [SESSION_V1_KEY]: 'legacy-session-bytes',
      [SNAPSHOT_V1_KEY]: 'legacy-snapshot-bytes'
    });
    const tabs = createV2Payload().tabs;

    const payload = saveTabsSession({
      storage,
      tabs,
      activeTabId: 'tab-v2',
      snapshot,
      now: NOW
    });

    expect(payload).toEqual(createV2Payload());
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(expectedKey, JSON.stringify(payload));
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.values.get(SESSION_V1_KEY)).toBe('legacy-session-bytes');
    expect(storage.values.get(SNAPSHOT_V1_KEY)).toBe('legacy-snapshot-bytes');
  });

  test.each([
    ['empty tabs', { tabs: [] }],
    [
      'duplicate tab ids',
      {
        tabs: [
          createV2Payload().tabs[0],
          { ...createV2Payload().tabs[0] }
        ]
      }
    ],
    [
      'empty tab id',
      { tabs: [{ ...createV2Payload().tabs[0], id: '' }], activeTabId: '' }
    ],
    ['missing active tab', { activeTabId: 'tab-missing' }],
    ['negative savedAt', { now: -1 }],
    ['fractional savedAt', { now: 1.5 }],
    ['unsafe savedAt', { now: Number.MAX_SAFE_INTEGER + 1 }]
  ])('rejects %s without writing an unreadable v2 payload', (_name, overrides) => {
    const storage = createStorage();
    const options = {
      storage,
      tabs: createV2Payload().tabs,
      activeTabId: 'tab-v2',
      now: NOW,
      ...overrides
    };

    expect(() => createTabsSessionPayload(
      options.tabs,
      options.activeTabId,
      options.now
    )).toThrow(TypeError);
    expect(() => saveTabsSession(options)).toThrow(TypeError);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
