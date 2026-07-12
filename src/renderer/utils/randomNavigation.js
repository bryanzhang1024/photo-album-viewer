import { splitPortableRelativePath } from '../../common/path-codec';
import { deriveDirectoryCapabilitiesV1 } from '../../common/contracts/directory-contract-v1';
import { shuffleArray } from './shuffleBag';

export const RANDOM_SCOPE_LIMIT = 8;

export function directoryRefKey(ref) {
  return JSON.stringify([ref.sourceId.toLowerCase(), ref.relativePath]);
}

export function getRandomViewMode(record) {
  if (record?.status !== 'ready') return null;
  const caps = deriveDirectoryCapabilitiesV1(record);
  if (caps.canViewDirectMedia === true) return 'photoSet';
  if (caps.canBrowseChildren === true) return 'browse';
  return null;
}

export function getRandomNavigationContext(location) {
  if (location?.kind !== 'directory') return null;
  const { target } = location;
  const segments = splitPortableRelativePath(target.relativePath);
  const scopeRelativePath = target.viewMode === 'photoSet'
    ? segments.slice(0, -1).join('/')
    : target.relativePath;
  const scopeRef = { sourceId: target.sourceId, relativePath: scopeRelativePath };
  return {
    scopeRef,
    scopeKey: directoryRefKey(scopeRef),
    currentCandidateKey: target.viewMode === 'photoSet'
      ? directoryRefKey({ sourceId: target.sourceId, relativePath: target.relativePath })
      : null
  };
}

export function buildRandomNavigationTargets(snapshot) {
  const unique = new Map();
  for (const child of snapshot?.children || []) {
    const viewMode = getRandomViewMode(child);
    if (!viewMode) continue;
    const candidateKey = directoryRefKey(child.ref);
    unique.set(candidateKey, {
      kind: 'directoryNavigation',
      candidateKey,
      target: {
        sourceId: child.ref.sourceId,
        relativePath: child.ref.relativePath,
        viewMode,
        initialMediaRelativePath: null
      }
    });
  }
  return [...unique.values()].sort((left, right) => (
    left.candidateKey.localeCompare(right.candidateKey)
  ));
}

export function createRandomCandidateSignature(targets) {
  return JSON.stringify(targets.map((item) => (
    `${item.candidateKey}|${item.target.viewMode}`
  )).sort());
}

function shuffleRound(candidateKeys, randomFn, lastReturnedKey) {
  const remainingKeys = shuffleArray(candidateKeys, randomFn);
  if (remainingKeys.length > 1 && remainingKeys[0] === lastReturnedKey) {
    [remainingKeys[0], remainingKeys[1]] = [remainingKeys[1], remainingKeys[0]];
  }
  return remainingKeys;
}

export function drawRandomNavigationTarget(state, targets, options = {}) {
  const signature = createRandomCandidateSignature(targets);
  const targetsByKey = new Map(targets.map((item) => [item.candidateKey, item]));
  const candidateKeys = [...targetsByKey.keys()];
  const { currentCandidateKey = null, randomFn = Math.random } = options;

  if (candidateKeys.length === 0) {
    return {
      target: null,
      state: { signature, remainingKeys: [], lastReturnedKey: null },
      reason: 'emptyPool'
    };
  }

  const signatureMatches = state?.signature === signature;
  const lastReturnedKey = signatureMatches ? state.lastReturnedKey : null;
  const eligibleKeys = candidateKeys.filter((key) => key !== currentCandidateKey);
  if (eligibleKeys.length === 0) {
    return {
      target: null,
      state: { signature, remainingKeys: [], lastReturnedKey },
      reason: 'noOtherCandidate'
    };
  }

  let remainingKeys = signatureMatches
    ? state.remainingKeys.filter((key) => (
      targetsByKey.has(key) && key !== currentCandidateKey
    ))
    : shuffleRound(candidateKeys, randomFn, lastReturnedKey)
      .filter((key) => key !== currentCandidateKey);

  if (remainingKeys.length === 0) {
    remainingKeys = shuffleRound(eligibleKeys, randomFn, lastReturnedKey);
  }

  const [nextKey, ...rest] = remainingKeys;
  return {
    target: targetsByKey.get(nextKey),
    state: {
      signature,
      remainingKeys: rest,
      lastReturnedKey: nextKey
    },
    reason: 'drawn'
  };
}

export function touchRandomScope(
  scopes,
  scopeKey,
  entry,
  limit = RANDOM_SCOPE_LIMIT
) {
  const nextScopes = new Map(scopes);
  nextScopes.delete(scopeKey);
  nextScopes.set(scopeKey, entry);
  while (nextScopes.size > limit) {
    nextScopes.delete(nextScopes.keys().next().value);
  }
  return nextScopes;
}
