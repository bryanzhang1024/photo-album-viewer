const {
  NAVIGATION_CONTRACT_VERSION,
  NAVIGATION_VIEW_MODES,
  SOURCE_ROOT_SCHEMA_VERSION,
  createNavigationErrorEnvelopeV1,
  createNavigationSuccessEnvelopeV1,
  normalizeSourceIdV1,
  sourceIdsEqualV1,
  validateLoadSourceRootsRequestV1,
  validateNavigationTargetV1,
  validateSaveSourceRootRequestV1,
  validateSourceRootV1,
  validateSourceRootsEnvelopeV1
} = require('../../../src/common/contracts/navigation-contract-v1');
const {
  createLoadSourceRootsRequestV1,
  createNavigationTargetV1,
  createSaveSourceRootRequestV1,
  createSourceRootV1
} = require('../../helpers/sourceRootFixtures');

describe('navigation-contract-v1', () => {
  test('exports frozen versioned navigation constants', () => {
    expect(NAVIGATION_CONTRACT_VERSION).toBe(1);
    expect(SOURCE_ROOT_SCHEMA_VERSION).toBe(1);
    expect(NAVIGATION_VIEW_MODES).toEqual(['browse', 'photoSet']);
    expect(Object.isFrozen(NAVIGATION_VIEW_MODES)).toBe(true);
  });

  test('accepts the canonical SourceRoot example', () => {
    const source = {
      schemaVersion: 1,
      sourceId: 'src_11111111-1111-4111-8111-111111111111',
      label: '家庭照片',
      rootPath: '//NAS/Photos',
      sourceGeneration: 1
    };

    expect(validateSourceRootV1(source)).toEqual({ valid: true, issues: [], value: source });
  });

  test('normalizes valid source ids for ASCII case-insensitive comparison', () => {
    const lowerSourceId = 'src_abcdef12-3456-4abc-8def-1234567890ab';
    const upperSourceId = lowerSourceId.toUpperCase();

    expect(normalizeSourceIdV1(upperSourceId)).toBe(lowerSourceId);
    expect(sourceIdsEqualV1(lowerSourceId, upperSourceId)).toBe(true);
    expect(sourceIdsEqualV1(lowerSourceId, 'not-a-source-id')).toBe(false);
    expect(sourceIdsEqualV1(lowerSourceId, null)).toBe(false);
  });

  test('accepts the canonical NavigationTarget example and a null initial media path', () => {
    const target = {
      sourceId: 'src_11111111-1111-4111-8111-111111111111',
      relativePath: '2026/旅行',
      viewMode: 'photoSet',
      initialMediaRelativePath: '2026/旅行/001.jpg'
    };

    expect(validateNavigationTargetV1(target).valid).toBe(true);
    expect(validateNavigationTargetV1(createNavigationTargetV1({
      viewMode: 'browse',
      initialMediaRelativePath: null
    })).valid).toBe(true);
    expect(validateNavigationTargetV1(createNavigationTargetV1({
      relativePath: '',
      initialMediaRelativePath: 'anywhere/in-the-source.jpg'
    })).valid).toBe(true);
  });

  test.each([
    ['wrong UUID version', { sourceId: 'src_11111111-1111-5111-8111-111111111111' }],
    ['wrong UUID variant', { sourceId: 'src_11111111-1111-4111-7111-111111111111' }],
    ['zero generation', { sourceGeneration: 0 }],
    ['empty label', { label: '' }],
    ['blank label', { label: '   ' }],
    ['overlong label', { label: '照'.repeat(201) }],
    ['relative root', { rootPath: 'Photos/Trip' }],
    ['unknown field', { legacyPath: '/Photos' }]
  ])('rejects a SourceRoot with %s', (_name, overrides) => {
    expect(validateSourceRootV1(createSourceRootV1(overrides)).valid).toBe(false);
  });

  test.each([
    ['legacy view mode', { viewMode: 'folder' }],
    ['absolute relativePath', { relativePath: '/2026/旅行' }],
    ['traversal relativePath', { relativePath: '2026/../旅行' }],
    ['backslash relativePath', { relativePath: '2026\\旅行' }],
    ['absolute initial media path', { initialMediaRelativePath: '/2026/旅行/001.jpg' }],
    ['traversal initial media path', { initialMediaRelativePath: '2026/../001.jpg' }],
    ['backslash initial media path', { initialMediaRelativePath: '2026\\001.jpg' }],
    ['empty initial media path', { initialMediaRelativePath: '' }],
    ['initial media equal to target directory', { initialMediaRelativePath: '2026/旅行' }],
    ['sibling initial media path', { initialMediaRelativePath: '2026/其他/001.jpg' }],
    ['prefix-sibling initial media path', { initialMediaRelativePath: '2026/旅行2/001.jpg' }],
    ['unknown field', { path: '/Photos/2026' }]
  ])('rejects a NavigationTarget with %s', (_name, overrides) => {
    expect(validateNavigationTargetV1(createNavigationTargetV1(overrides)).valid).toBe(false);
  });

  test('validates strict LOAD and SAVE requests', () => {
    expect(validateLoadSourceRootsRequestV1(createLoadSourceRootsRequestV1()).valid).toBe(true);
    expect(validateSaveSourceRootRequestV1(createSaveSourceRootRequestV1()).valid).toBe(true);
    expect(validateSaveSourceRootRequestV1(createSaveSourceRootRequestV1({
      sourceId: 'src_11111111-1111-4111-8111-111111111111',
      rootPath: 'C:\\Photos',
      label: '新位置'
    })).valid).toBe(true);

    expect(validateLoadSourceRootsRequestV1({ contractVersion: 2 }).valid).toBe(false);
    expect(validateLoadSourceRootsRequestV1({ contractVersion: 1, extra: true }).valid).toBe(false);
    expect(validateSaveSourceRootRequestV1(createSaveSourceRootRequestV1({
      sourceId: 'src_11111111-1111-3111-8111-111111111111'
    })).valid).toBe(false);
    expect(validateSaveSourceRootRequestV1(createSaveSourceRootRequestV1({ label: '' })).valid)
      .toBe(false);
    expect(validateSaveSourceRootRequestV1(createSaveSourceRootRequestV1({ extra: true })).valid)
      .toBe(false);
  });

  test('creates and validates list and save success envelopes', () => {
    const source = createSourceRootV1();
    const listEnvelope = createNavigationSuccessEnvelopeV1({ sources: [source] });
    const saveEnvelope = createNavigationSuccessEnvelopeV1({ source, created: false });

    expect(listEnvelope).toEqual({
      contractVersion: 1,
      ok: true,
      data: { sources: [source] }
    });
    expect(validateSourceRootsEnvelopeV1(listEnvelope).valid).toBe(true);
    expect(validateSourceRootsEnvelopeV1(saveEnvelope).valid).toBe(true);
  });

  test('rejects list envelopes whose source ids differ only by ASCII case', () => {
    const source = createSourceRootV1();
    const envelope = createNavigationSuccessEnvelopeV1({
      sources: [
        source,
        createSourceRootV1({
          sourceId: source.sourceId.toUpperCase(),
          label: '重复来源',
          rootPath: '/Other'
        })
      ]
    });

    expect(validateSourceRootsEnvelopeV1(envelope)).toEqual(expect.objectContaining({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: '$.data.sources[1].sourceId',
          code: 'invariant'
        })
      ])
    }));
  });

  test('creates and validates strict error envelopes', () => {
    const envelope = createNavigationErrorEnvelopeV1(
      'SOURCE_ROOT_OFFLINE',
      'Source root is unavailable',
      { retryable: true, details: { sourceId: 'src_11111111-1111-4111-8111-111111111111' } }
    );

    expect(envelope).toEqual({
      contractVersion: 1,
      ok: false,
      error: {
        code: 'SOURCE_ROOT_OFFLINE',
        message: 'Source root is unavailable',
        retryable: true,
        details: { sourceId: 'src_11111111-1111-4111-8111-111111111111' }
      }
    });
    expect(validateSourceRootsEnvelopeV1(envelope).valid).toBe(true);
    expect(validateSourceRootsEnvelopeV1({ ...envelope, data: { sources: [] } }).valid)
      .toBe(false);
    expect(validateSourceRootsEnvelopeV1({ ...envelope, legacy: true }).valid).toBe(false);
  });

  test('rejects malformed success data and nested unknown fields', () => {
    const source = createSourceRootV1();
    expect(validateSourceRootsEnvelopeV1({
      contractVersion: 1,
      ok: true,
      data: { sources: [source], extra: true }
    }).valid).toBe(false);
    expect(validateSourceRootsEnvelopeV1({
      contractVersion: 1,
      ok: true,
      data: { source, created: 'yes' }
    }).valid).toBe(false);
    expect(validateSourceRootsEnvelopeV1({
      contractVersion: 1,
      ok: false,
      error: { code: '', message: 'failed', retryable: false }
    }).valid).toBe(false);
  });

});
