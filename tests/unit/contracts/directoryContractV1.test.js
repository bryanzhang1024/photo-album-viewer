const { deserialize, serialize } = require('v8');

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

function createUnavailableSnapshot(status) {
  const snapshot = createDirectorySnapshotV1({
    status,
    completeness: { entries: 'partial', directMedia: 'partial', children: 'partial' },
    facts: { directMediaCount: 0, childDirectoryCount: 0 },
    directMedia: [],
    children: [],
    approximate: {
      coverSamples: [],
      hasDescendantMedia: 'unknown',
      observedAt: 1783728000000,
      truncated: true
    }
  });
  return snapshot;
}

function setChildUnavailable(child, status) {
  child.status = status;
  child.completeness = { directMedia: 'partial', children: 'partial' };
  child.facts = { directMediaCount: 0, childDirectoryCount: 0 };
  child.approximate = {
    coverSamples: [],
    hasDescendantMedia: 'unknown',
    observedAt: 1783728000000,
    truncated: true
  };
}

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

  test.each([
    ['function', () => ({ value: () => true })],
    ['symbol value', () => ({ value: Symbol('not-cloneable') })],
    ['bigint', () => ({ value: 1n })],
    ['undefined', () => ({ value: undefined })],
    ['non-finite number', () => ({ value: Number.POSITIVE_INFINITY })],
    ['non-plain object', () => ({ value: new Date(0) })],
    ['accessor', () => {
      const details = {};
      Object.defineProperty(details, 'value', { enumerable: true, get: () => 'side effect' });
      return details;
    }],
    ['cycle', () => {
      const details = {};
      details.self = details;
      return details;
    }],
    ['sparse array', () => ({ value: new Array(1) })],
    ['array-owned field', () => {
      const value = [];
      value.extra = true;
      return { value };
    }],
    ['symbol-owned field', () => {
      const details = {};
      details[Symbol('extra')] = true;
      return details;
    }]
  ])('rejects non-pure error details containing %s', (_label, createDetails) => {
    const envelope = createDirectoryErrorEnvelopeV1('INVALID_REQUEST', '请求无效', {
      retryable: false,
      details: createDetails()
    });
    expect(validateDirectoryEnvelopeV1(envelope).valid).toBe(false);
  });

  test('accepts deterministic nested pure-data error details', () => {
    const details = {
      issues: [{ path: '$.ref', code: 'format', message: '引用无效' }],
      context: [null, true, false, 0, -1.5, 'portable']
    };
    const envelope = createDirectoryErrorEnvelopeV1('INVALID_REQUEST', '请求无效', {
      retryable: false,
      details
    });

    expect(validateDirectoryEnvelopeV1(envelope).valid).toBe(true);
    expect(deserialize(serialize(envelope))).toEqual(envelope);
  });

  test.each([
    null,
    true,
    'context',
    0,
    -1.5,
    [null, false, 2, 'nested'],
    { nested: { value: 'plain' } }
  ])('accepts a pure-data error details root %#', (details) => {
    const envelope = createDirectoryErrorEnvelopeV1('INVALID_REQUEST', '请求无效', {
      retryable: false,
      details
    });
    expect(validateDirectoryEnvelopeV1(envelope).valid).toBe(true);
  });

  test.each(['missing', 'unreadable', 'sourceOffline'])(
    'rejects a top-level %s success while allowing unavailable child summaries',
    (status) => {
      const unavailableRoot = createUnavailableSnapshot(status);
      expect(validateDirectorySnapshotV1(unavailableRoot).valid).toBe(true);
      expect(validateDirectoryEnvelopeV1(
        createDirectorySuccessEnvelopeV1(unavailableRoot)
      ).valid).toBe(false);

      const snapshotWithUnavailableChild = createDirectorySnapshotV1();
      setChildUnavailable(snapshotWithUnavailableChild.children[0], status);
      expect(validateDirectoryEnvelopeV1(
        createDirectorySuccessEnvelopeV1(snapshotWithUnavailableChild)
      ).valid).toBe(true);
      expect(validateDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('DIRECTORY_UNAVAILABLE', '目录不可用', {
          retryable: false
        })
      ).valid).toBe(true);
    }
  );

  test('enforces unavailable status semantics on child summaries', () => {
    const unavailableComplete = createDirectorySnapshotV1();
    unavailableComplete.children[0].status = 'unreadable';

    const unavailableNoEvidence = createDirectorySnapshotV1();
    setChildUnavailable(unavailableNoEvidence.children[0], 'missing');
    unavailableNoEvidence.children[0].approximate.hasDescendantMedia = 'no';

    const unavailableNotTruncated = createDirectorySnapshotV1();
    setChildUnavailable(unavailableNotTruncated.children[0], 'sourceOffline');
    unavailableNotTruncated.children[0].approximate.truncated = false;

    expect(validateDirectorySnapshotV1(unavailableComplete).valid).toBe(false);
    expect(validateDirectorySnapshotV1(unavailableNoEvidence).valid).toBe(false);
    expect(validateDirectorySnapshotV1(unavailableNotTruncated).valid).toBe(false);
  });

  test('enforces evidence, complete-leaf, and partial-observation semantics', () => {
    const positiveEvidenceSaysNo = createDirectorySnapshotV1();
    positiveEvidenceSaysNo.children[0].approximate.hasDescendantMedia = 'no';

    const emptyLeafSaysYes = createDirectorySnapshotV1();
    emptyLeafSaysYes.children[0].facts = { directMediaCount: 0, childDirectoryCount: 0 };
    emptyLeafSaysYes.children[0].approximate = {
      coverSamples: [],
      hasDescendantMedia: 'yes',
      observedAt: 1783728000000,
      truncated: false
    };

    const emptyLeafIsTruncated = createDirectorySnapshotV1();
    emptyLeafIsTruncated.children[0].facts = { directMediaCount: 0, childDirectoryCount: 0 };
    emptyLeafIsTruncated.children[0].approximate = {
      coverSamples: [],
      hasDescendantMedia: 'no',
      observedAt: 1783728000000,
      truncated: true
    };

    const partialRootNotTruncated = createDirectorySnapshotV1({
      completeness: { entries: 'partial', directMedia: 'partial', children: 'partial' },
      approximate: {
        coverSamples: ['cover.jpg'],
        hasDescendantMedia: 'yes',
        observedAt: 1783728000000,
        truncated: false
      }
    });

    const validEmptyLeaf = createDirectorySnapshotV1();
    validEmptyLeaf.children[0].facts = { directMediaCount: 0, childDirectoryCount: 0 };
    validEmptyLeaf.children[0].approximate = {
      coverSamples: [],
      hasDescendantMedia: 'no',
      observedAt: 1783728000000,
      truncated: false
    };

    expect(validateDirectorySnapshotV1(positiveEvidenceSaysNo).valid).toBe(false);
    expect(validateDirectorySnapshotV1(emptyLeafSaysYes).valid).toBe(false);
    expect(validateDirectorySnapshotV1(emptyLeafIsTruncated).valid).toBe(false);
    expect(validateDirectorySnapshotV1(partialRootNotTruncated).valid).toBe(false);
    expect(validateDirectorySnapshotV1(validEmptyLeaf).valid).toBe(true);
  });

  test.each([
    ['array-owned legacy field', (snapshot) => {
      snapshot.directMedia.type = 'album';
    }],
    ['array-owned enumerable field', (snapshot) => {
      snapshot.children.extra = true;
    }],
    ['array-owned symbol field', (snapshot) => {
      snapshot.directMedia[Symbol('extra')] = true;
    }],
    ['sparse directMedia', (snapshot) => {
      snapshot.directMedia = new Array(1);
    }],
    ['sparse children', (snapshot) => {
      snapshot.children = new Array(1);
    }],
    ['sparse root coverSamples', (snapshot) => {
      snapshot.approximate.coverSamples = new Array(1);
    }],
    ['sparse child coverSamples', (snapshot) => {
      snapshot.children[0].approximate.coverSamples = new Array(1);
    }]
  ])('rejects malformed contract arrays with %s', (_label, mutate) => {
    const snapshot = createDirectorySnapshotV1();
    mutate(snapshot);
    expect(validateDirectorySnapshotV1(snapshot).valid).toBe(false);
  });

  test('accepts a finite pre-epoch media mtime', () => {
    const snapshot = createDirectorySnapshotV1();
    snapshot.directMedia[0].mtimeMs = -1;
    expect(validateDirectorySnapshotV1(snapshot).valid).toBe(true);
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
