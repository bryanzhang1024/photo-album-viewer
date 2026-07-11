import {
  createChildBrowserLocation,
  getBrowserLocationIdentity,
  getParentBrowserLocation,
  getSourceRootBreadcrumbs,
  isBrowserLocation,
  materializeBrowserLocation
} from '../../src/renderer/domain/browserLocation';

const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';
const SECOND_SOURCE_ID = 'src_22222222-2222-4222-8222-222222222222';

const createSource = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: SOURCE_ID,
  label: '家庭照片',
  rootPath: '/Volumes/Photos',
  sourceGeneration: 1,
  ...overrides
});

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

describe('BrowserLocation domain', () => {
  test('materializes a canonical directory location from its registered source root', () => {
    const location = createDirectoryLocation();
    const sourceRoot = createSource();

    expect(materializeBrowserLocation(location, [sourceRoot])).toEqual({
      location,
      sourceRoot,
      absolutePath: '/Volumes/Photos/2026/旅行',
      rootPath: '/Volumes/Photos',
      legacyViewMode: 'album',
      absoluteInitialImage: '/Volumes/Photos/2026/旅行/001.jpg'
    });
  });

  test('materializes a mixed-case canonical source id from the lowercase registry source', () => {
    const sourceRoot = createSource();
    const location = createDirectoryLocation({ sourceId: SOURCE_ID.toUpperCase() });

    expect(materializeBrowserLocation(location, [sourceRoot])).toEqual(expect.objectContaining({
      location,
      sourceRoot,
      absolutePath: '/Volumes/Photos/2026/旅行'
    }));
  });

  test('uses one canonical identity for source id case variants', () => {
    expect(getBrowserLocationIdentity(createDirectoryLocation()))
      .toBe(getBrowserLocationIdentity(createDirectoryLocation({
        sourceId: SOURCE_ID.toUpperCase()
      })));
  });

  test('relinks the same canonical target under a changed root without changing its identity', () => {
    const location = createDirectoryLocation();
    const oldSource = createSource({ rootPath: '/Volumes/OldPhotos' });
    const relinkedSource = createSource({
      rootPath: '/Volumes/NewPhotos',
      sourceGeneration: 2
    });

    const before = materializeBrowserLocation(location, [oldSource]);
    const after = materializeBrowserLocation(location, [relinkedSource]);

    expect(before.absolutePath).toBe('/Volumes/OldPhotos/2026/旅行');
    expect(after.absolutePath).toBe('/Volumes/NewPhotos/2026/旅行');
    expect(getBrowserLocationIdentity(before.location))
      .toBe(getBrowserLocationIdentity(after.location));
  });

  test('keeps source identity distinct even when two targets materialize to the same absolute path', () => {
    const first = createDirectoryLocation();
    const second = createDirectoryLocation({ sourceId: SECOND_SOURCE_ID });
    const sources = [
      createSource(),
      createSource({ sourceId: SECOND_SOURCE_ID, label: '备份照片' })
    ];

    expect(materializeBrowserLocation(first, sources).absolutePath)
      .toBe(materializeBrowserLocation(second, sources).absolutePath);
    expect(getBrowserLocationIdentity(first)).not.toBe(getBrowserLocationIdentity(second));
    expect(getBrowserLocationIdentity(first)).toBe(
      JSON.stringify([
        'directory',
        SOURCE_ID,
        '2026/旅行',
        'photoSet',
        '2026/旅行/001.jpg'
      ])
    );
  });

  test('keeps the exact strict-valid colon targets in distinct canonical identities', () => {
    const locationA = createDirectoryLocation({
      relativePath: 'aa',
      viewMode: 'browse',
      initialMediaRelativePath: 'aa/xx:photoSet:aa:browse:aa/xx/y'
    });
    const locationB = createDirectoryLocation({
      relativePath: 'aa:browse:aa/xx',
      viewMode: 'photoSet',
      initialMediaRelativePath: 'aa:browse:aa/xx/y'
    });

    expect(isBrowserLocation(locationA)).toBe(true);
    expect(isBrowserLocation(locationB)).toBe(true);
    expect(getBrowserLocationIdentity(locationA))
      .not.toBe(getBrowserLocationIdentity(locationB));
  });

  test('encodes legacy and app locations as fixed tuples', () => {
    const legacyA = {
      kind: 'legacyAbsolute',
      legacyAbsolutePath: '/aa',
      viewMode: 'folder',
      legacyInitialMediaPath: '/aa/xx:album:/aa/y'
    };
    const legacyB = {
      kind: 'legacyAbsolute',
      legacyAbsolutePath: '/aa:folder:/aa/xx',
      viewMode: 'album',
      legacyInitialMediaPath: '/aa/y'
    };

    expect(isBrowserLocation(legacyA)).toBe(true);
    expect(isBrowserLocation(legacyB)).toBe(true);
    expect(getBrowserLocationIdentity(legacyA))
      .not.toBe(getBrowserLocationIdentity(legacyB));
    expect(getBrowserLocationIdentity({ kind: 'landing' }))
      .toBe(JSON.stringify(['landing']));
    expect(getBrowserLocationIdentity({ kind: 'favorites' }))
      .toBe(JSON.stringify(['favorites']));
  });

  test('creates child navigation from portable segments while preserving sourceId', () => {
    const parent = createDirectoryLocation({
      relativePath: '2026',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });

    expect(createChildBrowserLocation(parent, '旅行')).toEqual({
      kind: 'directory',
      target: {
        sourceId: SOURCE_ID,
        relativePath: '2026/旅行',
        viewMode: 'browse',
        initialMediaRelativePath: null
      }
    });
  });

  test('moves a canonical directory to its parent and treats the source root as a no-op', () => {
    const child = createDirectoryLocation();
    const root = createDirectoryLocation({
      relativePath: '',
      viewMode: 'browse',
      initialMediaRelativePath: null
    });

    expect(getParentBrowserLocation(child)).toEqual({
      kind: 'directory',
      target: {
        sourceId: SOURCE_ID,
        relativePath: '2026',
        viewMode: 'browse',
        initialMediaRelativePath: null
      }
    });
    expect(getParentBrowserLocation(root)).toBe(root);
  });

  test.each([
    ['/Photos/2026/Trip', '/Photos/2026'],
    ['C:\\Photos\\2026\\Trip', 'C:/Photos/2026'],
    ['\\\\NAS\\Photos\\2026\\Trip', '//NAS/Photos/2026']
  ])('keeps OS root semantics when navigating a legacy path parent: %s', (path, parentPath) => {
    const location = {
      kind: 'legacyAbsolute',
      legacyAbsolutePath: path,
      viewMode: 'album',
      legacyInitialMediaPath: `${path}/cover.jpg`
    };

    expect(getParentBrowserLocation(location)).toEqual({
      kind: 'legacyAbsolute',
      legacyAbsolutePath: parentPath,
      viewMode: 'folder',
      legacyInitialMediaPath: null
    });
  });

  test.each([
    [
      createSource(),
      '2026/旅行',
      [
        { name: '家庭照片', path: '/Volumes/Photos' },
        { name: '2026', path: '/Volumes/Photos/2026' },
        { name: '旅行', path: '/Volumes/Photos/2026/旅行' }
      ]
    ],
    [
      createSource({ label: 'Windows 照片', rootPath: 'D:\\Pictures' }),
      '2026/Trip',
      [
        { name: 'Windows 照片', path: 'D:\\Pictures' },
        { name: '2026', path: 'D:/Pictures/2026' },
        { name: 'Trip', path: 'D:/Pictures/2026/Trip' }
      ]
    ],
    [
      createSource({ label: 'NAS 照片', rootPath: '\\\\NAS\\Photos' }),
      '2026/Trip',
      [
        { name: 'NAS 照片', path: '\\\\NAS\\Photos' },
        { name: '2026', path: '//NAS/Photos/2026' },
        { name: 'Trip', path: '//NAS/Photos/2026/Trip' }
      ]
    ]
  ])('builds SourceRoot-labelled breadcrumbs one portable segment at a time', (
    sourceRoot,
    relativePath,
    expected
  ) => {
    expect(getSourceRootBreadcrumbs(sourceRoot, relativePath)).toEqual(expected);
  });

  test('recognizes only the persisted BrowserLocation union and canonical target fields', () => {
    expect(isBrowserLocation({ kind: 'landing' })).toBe(true);
    expect(isBrowserLocation({ kind: 'favorites' })).toBe(true);
    expect(isBrowserLocation(createDirectoryLocation())).toBe(true);
    expect(isBrowserLocation({
      kind: 'legacyAbsolute',
      legacyAbsolutePath: '/Photos/Trip',
      viewMode: 'folder',
      legacyInitialMediaPath: null
    })).toBe(true);
    expect(isBrowserLocation({
      kind: 'legacyAbsolute',
      legacyAbsolutePath: '/Photos/Trip',
      viewMode: 'album',
      legacyInitialMediaPath: 'cover.jpg'
    })).toBe(true);

    expect(isBrowserLocation({ ...createDirectoryLocation(), rootPath: '/Volumes/Photos' }))
      .toBe(false);
    expect(isBrowserLocation({
      kind: 'directory',
      target: { ...createDirectoryLocation().target, title: 'Trip' }
    })).toBe(false);
    expect(isBrowserLocation({
      kind: 'legacyAbsolute',
      legacyAbsolutePath: 'relative/path',
      viewMode: 'folder',
      legacyInitialMediaPath: null
    })).toBe(false);
  });

  test.each([
    '2026/其他/cover.jpg',
    '2026/旅行2/cover.jpg'
  ])('rejects a canonical BrowserLocation whose media is outside its target: %s', (
    initialMediaRelativePath
  ) => {
    expect(isBrowserLocation(createDirectoryLocation({ initialMediaRelativePath }))).toBe(false);
  });
});
