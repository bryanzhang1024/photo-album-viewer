const SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';

function createRuntimeSourceV1(overrides = {}) {
  return { sourceId: SOURCE_ID, rootPath: '/photos', ...overrides };
}

function createDirectoryRefV1(overrides = {}) {
  return { sourceId: SOURCE_ID, relativePath: '', ...overrides };
}

function createDirectoryLevelRequestV1(overrides = {}) {
  return {
    contractVersion: 1,
    runtimeSource: createRuntimeSourceV1(overrides.runtimeSource),
    ref: createDirectoryRefV1(overrides.ref),
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== 'runtimeSource' && key !== 'ref')
    )
  };
}

function createDirectorySnapshotV1(overrides = {}) {
  return {
    contractVersion: 1,
    ref: createDirectoryRefV1(),
    locator: { absolutePath: '/photos' },
    name: 'photos',
    status: 'ready',
    observedAt: 1783728000000,
    revision: 'snap_fixture_1',
    completeness: { entries: 'complete', directMedia: 'complete', children: 'complete' },
    facts: { directMediaCount: 1, childDirectoryCount: 1 },
    directMedia: [
      { relativePath: 'cover.jpg', name: 'cover.jpg', size: 1234, mtimeMs: 1783728000000 }
    ],
    children: [
      {
        ref: createDirectoryRefV1({ relativePath: 'album' }),
        name: 'album',
        status: 'ready',
        completeness: { directMedia: 'complete', children: 'complete' },
        facts: { directMediaCount: 1, childDirectoryCount: 0 },
        approximate: {
          coverSamples: ['album/1.jpg'],
          hasDescendantMedia: 'yes',
          observedAt: 1783728000000,
          truncated: false
        }
      }
    ],
    approximate: {
      coverSamples: ['cover.jpg'],
      hasDescendantMedia: 'yes',
      observedAt: 1783728000000,
      truncated: true
    },
    ...overrides
  };
}

module.exports = {
  SOURCE_ID,
  createDirectoryLevelRequestV1,
  createDirectoryRefV1,
  createDirectorySnapshotV1,
  createRuntimeSourceV1
};
