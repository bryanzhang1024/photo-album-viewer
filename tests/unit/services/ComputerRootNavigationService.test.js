/** @jest-environment node */

const {
  createNavigationTargetForSource,
  createVirtualComputerRootResponse,
  ensureComputerRootSource
} = require('../../../src/main/services/ComputerRootNavigationService');

const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

const createSource = (overrides = {}) => ({
  schemaVersion: 1,
  sourceId: SOURCE_ID,
  label: '电脑',
  rootPath: '/',
  sourceGeneration: 1,
  ...overrides
});

describe('ComputerRootNavigationService', () => {
  test('creates the macOS computer root when it is missing', async () => {
    const source = createSource();
    const sourceRootService = {
      listSourceRoots: jest.fn().mockResolvedValue([]),
      saveSourceRoot: jest.fn().mockResolvedValue({ source, created: true })
    };

    await expect(ensureComputerRootSource(sourceRootService, 'darwin')).resolves.toBe(source);
    expect(sourceRootService.saveSourceRoot).toHaveBeenCalledWith({
      sourceId: null,
      rootPath: '/',
      label: '电脑'
    });
  });

  test('keeps the sourceId and updates an existing root label', async () => {
    const existing = createSource({ label: '/' });
    const updated = createSource();
    const sourceRootService = {
      listSourceRoots: jest.fn().mockResolvedValue([existing]),
      saveSourceRoot: jest.fn().mockResolvedValue({ source: updated, created: false })
    };

    await expect(ensureComputerRootSource(sourceRootService, 'darwin')).resolves.toBe(updated);
    expect(sourceRootService.saveSourceRoot).toHaveBeenCalledWith({
      sourceId: SOURCE_ID,
      rootPath: '/',
      label: '电脑'
    });
  });

  test('does not create a computer root outside macOS', async () => {
    const sourceRootService = {
      listSourceRoots: jest.fn(),
      saveSourceRoot: jest.fn()
    };

    await expect(ensureComputerRootSource(sourceRootService, 'linux')).resolves.toBeNull();
    expect(sourceRootService.listSourceRoots).not.toHaveBeenCalled();
    expect(sourceRootService.saveSourceRoot).not.toHaveBeenCalled();
  });

  test('creates a launch target with spaces, Chinese text and an initial image', () => {
    expect(createNavigationTargetForSource(createSource(), {
      absolutePath: '/Volumes/1TB/Collection/600-Cos Weibo/旅行',
      viewMode: 'photoSet',
      initialMediaAbsolutePath: '/Volumes/1TB/Collection/600-Cos Weibo/旅行/001 张.jpg'
    })).toEqual({
      sourceId: SOURCE_ID,
      relativePath: 'Volumes/1TB/Collection/600-Cos Weibo/旅行',
      viewMode: 'photoSet',
      initialMediaRelativePath: 'Volumes/1TB/Collection/600-Cos Weibo/旅行/001 张.jpg'
    });
  });

  test('returns a synthetic root response containing only Volumes on macOS', () => {
    const response = createVirtualComputerRootResponse('/', 'darwin', () => 1234);

    expect(response).toMatchObject({
      success: true,
      currentPath: '/',
      parentPath: '/',
      directImages: [],
      nodes: [{
        path: '/Volumes',
        name: 'Volumes',
        type: 'folder',
        canBrowseChildren: true,
        canViewAsPhotoSet: false
      }],
      metadata: {
        totalNodes: 1,
        folderCount: 1,
        albumCount: 0,
        directImageCount: 0,
        scanTime: 0
      }
    });
    expect(response.nodes[0].lastModified).toEqual(new Date(1234));
    expect(createVirtualComputerRootResponse('/Volumes', 'darwin')).toBeNull();
    expect(createVirtualComputerRootResponse('/', 'linux')).toBeNull();
  });
});
