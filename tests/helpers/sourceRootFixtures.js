const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';
const SECOND_SOURCE_ID = 'src_22222222-2222-4222-8222-222222222222';

function createSourceRootV1(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceId: SOURCE_ID,
    label: '家庭照片',
    rootPath: '/Photos',
    sourceGeneration: 1,
    ...overrides
  };
}

function createNavigationTargetV1(overrides = {}) {
  return {
    sourceId: SOURCE_ID,
    relativePath: '2026/旅行',
    viewMode: 'photoSet',
    initialMediaRelativePath: '2026/旅行/001.jpg',
    ...overrides
  };
}

function createLoadSourceRootsRequestV1(overrides = {}) {
  return { contractVersion: 1, ...overrides };
}

function createSaveSourceRootRequestV1(overrides = {}) {
  return {
    contractVersion: 1,
    sourceId: null,
    rootPath: '/Photos',
    label: null,
    ...overrides
  };
}

function createSourceRootRegistryV1(overrides = {}) {
  return {
    schemaVersion: 1,
    sources: [createSourceRootV1()],
    ...overrides
  };
}

module.exports = {
  SECOND_SOURCE_ID,
  SOURCE_ID,
  createLoadSourceRootsRequestV1,
  createNavigationTargetV1,
  createSaveSourceRootRequestV1,
  createSourceRootRegistryV1,
  createSourceRootV1
};
