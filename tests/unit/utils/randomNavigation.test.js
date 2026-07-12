import {
  RANDOM_SCOPE_LIMIT,
  buildRandomNavigationTargets,
  createRandomCandidateSignature,
  directoryRefKey,
  drawRandomNavigationTarget,
  getRandomNavigationContext,
  getRandomViewMode,
  touchRandomScope
} from '../../../src/renderer/utils/randomNavigation';

const SOURCE_ID = 'src_AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';

function ref(relativePath, sourceId = SOURCE_ID) {
  return { sourceId, relativePath };
}

function child(relativePath, {
  status = 'ready',
  directMediaCount = 0,
  childDirectoryCount = 0,
  directMediaCompleteness = status === 'ready' ? 'complete' : 'partial',
  childrenCompleteness = status === 'ready' ? 'complete' : 'partial'
} = {}) {
  return {
    ref: ref(relativePath),
    name: relativePath,
    status,
    completeness: {
      directMedia: directMediaCompleteness,
      children: childrenCompleteness
    },
    facts: { directMediaCount, childDirectoryCount },
    approximate: {
      coverSamples: [],
      hasDescendantMedia: 'unknown',
      observedAt: 1783728000000,
      truncated: status !== 'ready'
    }
  };
}

function snapshot(overrides = {}) {
  return {
    contractVersion: 1,
    ref: ref(''),
    locator: { absolutePath: '/photos' },
    name: 'photos',
    status: 'ready',
    observedAt: 1783728000000,
    revision: 'revision-1',
    completeness: { entries: 'complete', directMedia: 'complete', children: 'complete' },
    facts: { directMediaCount: 0, childDirectoryCount: 0 },
    directMedia: [],
    children: [],
    approximate: {
      coverSamples: [],
      hasDescendantMedia: 'unknown',
      observedAt: 1783728000000,
      truncated: false
    },
    ...overrides
  };
}

function directoryLocation(relativePath, viewMode) {
  return {
    kind: 'directory',
    target: {
      sourceId: SOURCE_ID,
      relativePath,
      viewMode,
      initialMediaRelativePath: null
    }
  };
}

describe('randomNavigation candidate projection', () => {
  test('uses canonical directory ref keys', () => {
    expect(RANDOM_SCOPE_LIMIT).toBe(8);
    expect(directoryRefKey(ref('Albums/Trip'))).toBe(
      '["src_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","Albums/Trip"]'
    );
  });

  test('projects eligible canonical children in stable candidate-key order', () => {
    const targets = buildRandomNavigationTargets(snapshot({
      children: [
        child('hybrid', { directMediaCount: 2, childDirectoryCount: 1 }),
        child('folder', { directMediaCount: 0, childDirectoryCount: 2 }),
        child('photo', { directMediaCount: 3, childDirectoryCount: 0 }),
        child('empty', { directMediaCount: 0, childDirectoryCount: 0 }),
        child('missing', { status: 'missing' }),
        child('unreadable', { status: 'unreadable' }),
        child('unknown', {
          directMediaCompleteness: 'partial',
          childrenCompleteness: 'partial'
        })
      ],
      directMedia: [{ relativePath: 'root.jpg' }]
    }));

    expect(targets.map(({ candidateKey, target }) => [candidateKey, target.viewMode])).toEqual([
      [directoryRefKey(ref('folder')), 'browse'],
      [directoryRefKey(ref('hybrid')), 'photoSet'],
      [directoryRefKey(ref('photo')), 'photoSet']
    ]);
    expect(targets).toEqual([
      {
        kind: 'directoryNavigation',
        candidateKey: directoryRefKey(ref('folder')),
        target: {
          sourceId: SOURCE_ID,
          relativePath: 'folder',
          viewMode: 'browse',
          initialMediaRelativePath: null
        }
      },
      {
        kind: 'directoryNavigation',
        candidateKey: directoryRefKey(ref('hybrid')),
        target: {
          sourceId: SOURCE_ID,
          relativePath: 'hybrid',
          viewMode: 'photoSet',
          initialMediaRelativePath: null
        }
      },
      {
        kind: 'directoryNavigation',
        candidateKey: directoryRefKey(ref('photo')),
        target: {
          sourceId: SOURCE_ID,
          relativePath: 'photo',
          viewMode: 'photoSet',
          initialMediaRelativePath: null
        }
      }
    ]);
    expect(new Set(targets.map((item) => item.candidateKey)).size).toBe(3);
  });

  test('derives a view only from ready canonical facts and completeness', () => {
    expect(getRandomViewMode(child('hybrid', {
      directMediaCount: 1,
      childDirectoryCount: 1
    }))).toBe('photoSet');
    expect(getRandomViewMode(child('folder', { childDirectoryCount: 1 }))).toBe('browse');
    expect(getRandomViewMode(child('empty'))).toBeNull();
    expect(getRandomViewMode(child('offline', { status: 'sourceOffline' }))).toBeNull();
    expect(getRandomViewMode(child('unknown', {
      directMediaCompleteness: 'partial',
      childrenCompleteness: 'partial'
    }))).toBeNull();
  });
});

describe('randomNavigation context', () => {
  test('scopes a browse location to that directory', () => {
    expect(getRandomNavigationContext(directoryLocation('S', 'browse'))).toEqual({
      scopeRef: ref('S'),
      scopeKey: directoryRefKey(ref('S')),
      currentCandidateKey: null
    });
  });

  test('scopes a photo set to its parent and tracks the current candidate', () => {
    expect(getRandomNavigationContext(directoryLocation('S/A', 'photoSet'))).toEqual({
      scopeRef: ref('S'),
      scopeKey: directoryRefKey(ref('S')),
      currentCandidateKey: directoryRefKey(ref('S/A'))
    });
  });

  test('clamps a root photo set to the source root', () => {
    expect(getRandomNavigationContext(directoryLocation('', 'photoSet'))).toEqual({
      scopeRef: ref(''),
      scopeKey: directoryRefKey(ref('')),
      currentCandidateKey: directoryRefKey(ref(''))
    });
  });

  test('returns null outside directory locations', () => {
    expect(getRandomNavigationContext({ kind: 'home' })).toBeNull();
    expect(getRandomNavigationContext(null)).toBeNull();
  });
});

describe('randomNavigation state machine', () => {
  function createTargets() {
    return buildRandomNavigationTargets(snapshot({
      children: [
        child('alpha', { directMediaCount: 1 }),
        child('beta', { childDirectoryCount: 1 }),
        child('gamma', { directMediaCount: 1 })
      ]
    }));
  }

  test('creates an order-independent signature from candidate identity and view mode', () => {
    const targets = createTargets();
    const signature = createRandomCandidateSignature(targets);

    expect(createRandomCandidateSignature([...targets].reverse())).toBe(signature);
    expect(createRandomCandidateSignature([...targets.slice(1), targets[0]])).toBe(signature);
    expect(createRandomCandidateSignature(targets.map((item, index) => ({
      ...item,
      displayOrder: targets.length - index
    })))).toBe(signature);

    const changedViewMode = targets.map((item, index) => (
      index === 0
        ? { ...item, target: { ...item.target, viewMode: 'browse' } }
        : item
    ));
    expect(createRandomCandidateSignature(changedViewMode)).not.toBe(signature);
  });

  test('draws every candidate once before replacement', () => {
    const targets = createTargets();
    let state = null;
    const seen = [];

    for (let index = 0; index < targets.length; index += 1) {
      const draw = drawRandomNavigationTarget(state, targets, { randomFn: () => 0 });
      state = draw.state;
      seen.push(draw.target.candidateKey);
      expect(draw.reason).toBe('drawn');
    }

    expect(new Set(seen).size).toBe(targets.length);
    expect(state).toEqual({
      signature: createRandomCandidateSignature(targets),
      remainingKeys: [],
      lastReturnedKey: seen.at(-1)
    });
  });

  test('skips the current candidate without discarding the rest of the round', () => {
    const targets = createTargets();
    const skipped = drawRandomNavigationTarget(null, targets, {
      currentCandidateKey: targets[0].candidateKey,
      randomFn: () => 0
    });

    expect(skipped.target?.candidateKey).not.toBe(targets[0].candidateKey);
    expect(skipped.reason).toBe('drawn');
    expect(skipped.state.remainingKeys).not.toContain(targets[0].candidateKey);
  });

  test('returns noOtherCandidate when the current directory is the only candidate', () => {
    const targets = createTargets();
    const onlyCurrent = drawRandomNavigationTarget(null, [targets[0]], {
      currentCandidateKey: targets[0].candidateKey,
      randomFn: () => 0
    });

    expect(onlyCurrent).toMatchObject({ target: null, reason: 'noOtherCandidate' });
    expect(onlyCurrent.state).toEqual({
      signature: createRandomCandidateSignature([targets[0]]),
      remainingKeys: [],
      lastReturnedKey: null
    });
  });

  test('returns emptyPool with canonical empty state when no candidates exist', () => {
    expect(drawRandomNavigationTarget({
      signature: 'stale',
      remainingKeys: ['stale-key'],
      lastReturnedKey: 'stale-key'
    }, [], { randomFn: () => 0 })).toEqual({
      target: null,
      state: {
        signature: createRandomCandidateSignature([]),
        remainingKeys: [],
        lastReturnedKey: null
      },
      reason: 'emptyPool'
    });
  });

  test('reconciles a stale signature before drawing', () => {
    const targets = createTargets();
    const draw = drawRandomNavigationTarget({
      signature: 'stale',
      remainingKeys: ['removed-candidate'],
      lastReturnedKey: 'removed-candidate'
    }, targets, { randomFn: () => 0 });

    expect(targets).toContain(draw.target);
    expect(draw.state.signature).toBe(createRandomCandidateSignature(targets));
    expect(draw.state.remainingKeys).not.toContain('removed-candidate');
  });

  test('does not immediately repeat the last returned key across a refill boundary', () => {
    const targets = createTargets();
    const signature = createRandomCandidateSignature(targets);
    const draw = drawRandomNavigationTarget({
      signature,
      remainingKeys: [],
      lastReturnedKey: targets[0].candidateKey
    }, targets, { randomFn: () => 0.999999 });

    expect(draw.target.candidateKey).not.toBe(targets[0].candidateKey);
    expect(draw.reason).toBe('drawn');
  });

  test('refills once when excluding the current key completes a round', () => {
    const targets = createTargets();
    const draw = drawRandomNavigationTarget({
      signature: createRandomCandidateSignature(targets),
      remainingKeys: [targets[0].candidateKey],
      lastReturnedKey: targets[2].candidateKey
    }, targets, {
      currentCandidateKey: targets[0].candidateKey,
      randomFn: () => 0
    });

    expect(draw.target.candidateKey).not.toBe(targets[0].candidateKey);
    expect(draw.state.remainingKeys).not.toContain(targets[0].candidateKey);
    expect(draw.reason).toBe('drawn');
  });
});

describe('randomNavigation scope LRU', () => {
  test('copies the map, refreshes touched keys, and evicts the least-recent scope', () => {
    const original = new Map([['first', { value: 1 }], ['second', { value: 2 }]]);
    const refreshed = touchRandomScope(original, 'first', { value: 3 }, 2);

    expect(refreshed).not.toBe(original);
    expect([...original.entries()]).toEqual([
      ['first', { value: 1 }],
      ['second', { value: 2 }]
    ]);
    expect([...refreshed.entries()]).toEqual([
      ['second', { value: 2 }],
      ['first', { value: 3 }]
    ]);

    let scopes = new Map();
    for (let index = 1; index <= RANDOM_SCOPE_LIMIT + 1; index += 1) {
      scopes = touchRandomScope(scopes, `scope-${index}`, { index }, RANDOM_SCOPE_LIMIT);
    }

    expect(scopes.size).toBe(RANDOM_SCOPE_LIMIT);
    expect(scopes.has('scope-1')).toBe(false);
    expect([...scopes.keys()]).toEqual([
      'scope-2',
      'scope-3',
      'scope-4',
      'scope-5',
      'scope-6',
      'scope-7',
      'scope-8',
      'scope-9'
    ]);
  });
});
