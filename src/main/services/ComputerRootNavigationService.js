const {
  createNavigationTargetFromAbsolutePath
} = require('../../common/navigation-target');

const COMPUTER_ROOT_LABEL = '电脑';
const COMPUTER_ROOT_PATH = '/';

async function ensureComputerRootSource(sourceRootService, platform = process.platform) {
  if (platform !== 'darwin') return null;

  const sources = await sourceRootService.listSourceRoots();
  const existing = sources.find((source) => source.rootPath === COMPUTER_ROOT_PATH) || null;
  if (existing?.label === COMPUTER_ROOT_LABEL) return existing;

  const result = await sourceRootService.saveSourceRoot({
    sourceId: existing?.sourceId || null,
    rootPath: COMPUTER_ROOT_PATH,
    label: COMPUTER_ROOT_LABEL
  });
  return result.source;
}

function createNavigationTargetForSource(source, {
  absolutePath,
  viewMode = 'browse',
  initialMediaAbsolutePath = null
}) {
  return createNavigationTargetFromAbsolutePath(source, {
    absolutePath,
    viewMode,
    initialMediaAbsolutePath
  });
}

function createVirtualComputerRootResponse(targetPath, platform = process.platform, now = Date.now) {
  if (platform !== 'darwin' || targetPath !== COMPUTER_ROOT_PATH) return null;
  const lastModified = new Date(now());

  return {
    success: true,
    nodes: [{
      path: '/Volumes',
      name: 'Volumes',
      type: 'folder',
      contentKind: 'container',
      canViewAsPhotoSet: false,
      canOpenAlbum: false,
      canBrowseChildren: true,
      hasImages: false,
      imageCount: 0,
      directImageCount: 0,
      childFolders: 0,
      samples: [],
      lastModified,
      previewSamples: [],
      hasSubAlbums: false,
      quickStats: { hasMore: false, sampleSize: 0 }
    }],
    directImages: [],
    currentPath: COMPUTER_ROOT_PATH,
    parentPath: COMPUTER_ROOT_PATH,
    breadcrumbs: [],
    error: null,
    metadata: {
      totalNodes: 1,
      folderCount: 1,
      albumCount: 0,
      directImageCount: 0,
      scanTime: 0
    }
  };
}

module.exports = {
  COMPUTER_ROOT_LABEL,
  COMPUTER_ROOT_PATH,
  createNavigationTargetForSource,
  createVirtualComputerRootResponse,
  ensureComputerRootSource
};
