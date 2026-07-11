const {
  DIRECTORY_CONTRACT_VERSION,
  createDirectoryErrorEnvelopeV1,
  createDirectorySuccessEnvelopeV1,
  deriveDirectoryCapabilitiesV1,
  validateDirectoryEnvelopeV1,
  validateDirectoryLevelRequestV1,
  validateDirectoryRefV1,
  validateDirectorySnapshotV1,
  validateRuntimeSourceV1
} = require('../../../src/common/contracts/directory-contract-v1');
const {
  createDirectoryLevelRequestV1,
  createDirectoryRefV1,
  createDirectorySnapshotV1,
  createRuntimeSourceV1
} = require('../../helpers/directoryContractFixtures');

describe('directory-contract-v1', () => {
  test('accepts a canonical runtimeSource plus DirectoryRef request', () => {
    const request = createDirectoryLevelRequestV1();
    const result = validateDirectoryLevelRequestV1(request);
    expect(DIRECTORY_CONTRACT_VERSION).toBe(1);
    expect(result).toMatchObject({ valid: true, issues: [] });
    expect(result.value).toBe(request);
  });

  test('rejects unsupported version and mismatched source ids', () => {
    const wrongVersion = validateDirectoryLevelRequestV1(
      createDirectoryLevelRequestV1({ contractVersion: 2 })
    );
    const mismatch = validateDirectoryLevelRequestV1(
      createDirectoryLevelRequestV1({ ref: { sourceId: 'src_22222222-2222-4222-8222-222222222222' } })
    );
    expect(wrongVersion.valid).toBe(false);
    expect(wrongVersion.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.contractVersion', code: 'enum' })
    ]));
    expect(mismatch.valid).toBe(false);
    expect(mismatch.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.ref.sourceId', code: 'invariant' })
    ]));
  });

  test('validates runtime sources and portable directory refs independently', () => {
    expect(validateRuntimeSourceV1(createRuntimeSourceV1()).valid).toBe(true);
    expect(validateDirectoryRefV1(createDirectoryRefV1()).valid).toBe(true);

    const invalidSource = validateRuntimeSourceV1(
      createRuntimeSourceV1({ sourceId: 'photos', rootPath: 'relative/root' })
    );
    const invalidRef = validateDirectoryRefV1(
      createDirectoryRefV1({ relativePath: 'album/../outside' })
    );

    expect(invalidSource.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.sourceId', code: 'format' }),
      expect.objectContaining({ path: '$.rootPath', code: 'format' })
    ]));
    expect(invalidRef.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.relativePath', code: 'format' })
    ]));
  });

  test('derives tri-state capabilities and content kinds from facts', () => {
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 2, childDirectoryCount: 1 }
    })).toEqual({ canViewDirectMedia: true, canBrowseChildren: true, contentKind: 'hybrid' });
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 0 }
    })).toEqual({ canViewDirectMedia: false, canBrowseChildren: false, contentKind: 'empty' });
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'partial', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 1 }
    })).toEqual({ canViewDirectMedia: 'unknown', canBrowseChildren: true, contentKind: 'unknown' });
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 1, childDirectoryCount: 0 }
    })).toEqual({ canViewDirectMedia: true, canBrowseChildren: false, contentKind: 'photoSet' });
    expect(deriveDirectoryCapabilitiesV1({
      completeness: { directMedia: 'complete', children: 'complete' },
      facts: { directMediaCount: 0, childDirectoryCount: 1 }
    })).toEqual({ canViewDirectMedia: false, canBrowseChildren: true, contentKind: 'container' });
  });

  test('validates a complete snapshot and rejects recursive or legacy fields', () => {
    expect(validateDirectorySnapshotV1(createDirectorySnapshotV1()).valid).toBe(true);
    expect(validateDirectorySnapshotV1(createDirectorySnapshotV1({ type: 'album' })).valid).toBe(false);
    expect(validateDirectorySnapshotV1(
      createDirectorySnapshotV1({ contentKind: 'photoSet' })
    ).valid).toBe(false);
    const recursive = createDirectorySnapshotV1();
    recursive.children[0].children = [];
    expect(validateDirectorySnapshotV1(recursive).valid).toBe(false);
  });

  test('rejects snapshot entries outside the root or inconsistent with complete facts', () => {
    const invalidMedia = createDirectorySnapshotV1({
      directMedia: [
        { relativePath: 'nested/cover.jpg', name: 'cover.jpg', size: 1234, mtimeMs: 1783728000000 }
      ]
    });
    const invalidChild = createDirectorySnapshotV1();
    invalidChild.children[0].ref.sourceId = 'src_22222222-2222-4222-8222-222222222222';
    const invalidCount = createDirectorySnapshotV1({
      facts: { directMediaCount: 2, childDirectoryCount: 1 }
    });
    const nestedLegacy = createDirectorySnapshotV1();
    nestedLegacy.children[0].approximate.kind = 'album';

    expect(validateDirectorySnapshotV1(invalidMedia).valid).toBe(false);
    expect(validateDirectorySnapshotV1(invalidChild).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.children[0].ref.sourceId', code: 'invariant' })
    ]));
    expect(validateDirectorySnapshotV1(invalidCount).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.facts.directMediaCount', code: 'invariant' })
    ]));
    expect(validateDirectorySnapshotV1(nestedLegacy).valid).toBe(false);
  });

  test('keeps returned entry counts internally consistent when observations are partial', () => {
    const consistent = createDirectorySnapshotV1({
      completeness: { entries: 'partial', directMedia: 'partial', children: 'partial' }
    });
    const inconsistent = createDirectorySnapshotV1({
      completeness: { entries: 'partial', directMedia: 'partial', children: 'partial' },
      facts: { directMediaCount: 2, childDirectoryCount: 3 }
    });

    expect(validateDirectorySnapshotV1(consistent).valid).toBe(true);
    expect(validateDirectorySnapshotV1(inconsistent).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.facts.directMediaCount', code: 'invariant' }),
      expect.objectContaining({ path: '$.facts.childDirectoryCount', code: 'invariant' })
    ]));
  });

  test('validates success and failure envelopes with one shape each', () => {
    const success = createDirectorySuccessEnvelopeV1(createDirectorySnapshotV1());
    const details = { issues: [{ path: '$.ref', code: 'format', message: '引用无效' }] };
    const failure = createDirectoryErrorEnvelopeV1('ENOENT', '目录不存在', {
      retryable: false,
      details
    });
    expect(validateDirectoryEnvelopeV1(success).valid).toBe(true);
    expect(validateDirectoryEnvelopeV1(failure).valid).toBe(true);
    expect(failure.error.details).toBe(details);
    expect(success).not.toHaveProperty('error');
    expect(failure).not.toHaveProperty('data');
  });

  test('rejects envelopes that mix success data and failure errors', () => {
    const snapshot = createDirectorySnapshotV1();
    const mixed = {
      ...createDirectorySuccessEnvelopeV1(snapshot),
      error: { code: 'ENOENT', message: '目录不存在', retryable: false }
    };
    const wrongVersion = createDirectoryErrorEnvelopeV1('ENOENT', '目录不存在', {
      retryable: false
    });
    wrongVersion.contractVersion = 2;

    expect(validateDirectoryEnvelopeV1(mixed).valid).toBe(false);
    expect(validateDirectoryEnvelopeV1(wrongVersion).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '$.contractVersion', code: 'enum' })
    ]));
  });
});
