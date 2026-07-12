import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CHANNELS from '../../common/ipc-channels';
import { validateDirectoryEnvelopeV1 } from '../../common/contracts/directory-contract-v1';
import { sourceIdsEqualV1 } from '../../common/contracts/navigation-contract-v1';
import { getBrowserLocationIdentity } from '../domain/browserLocation';
import {
  buildRandomNavigationTargets,
  drawRandomNavigationTarget,
  getRandomNavigationContext,
  getRandomViewMode,
  touchRandomScope
} from '../utils/randomNavigation';

const RECOVERABLE_TARGET_ERRORS = new Set([
  'ENOENT',
  'ENOTDIR',
  'TARGET_VIEW_CHANGED'
]);

function getTabSourceIdentity(tab) {
  const sourceId = tab?.location?.kind === 'directory'
    ? tab.location.target.sourceId
    : null;
  return typeof sourceId === 'string' ? sourceId.toLowerCase() : null;
}

function drawUnrejectedTarget(state, targets, currentCandidateKey, rejectedKeys) {
  let pendingState = state;
  for (let index = 0; index < targets.length; index += 1) {
    const draw = drawRandomNavigationTarget(pendingState, targets, {
      currentCandidateKey
    });
    pendingState = draw.state;
    if (!draw.target || !rejectedKeys.has(draw.target.candidateKey)) {
      return { ...draw, state: pendingState };
    }
  }
  return { target: null, state: pendingState, reason: 'noOtherCandidate' };
}

async function loadDirectorySnapshot(ipcRenderer, source, ref) {
  const canonicalRef = {
    sourceId: source.sourceId,
    relativePath: ref.relativePath
  };
  const response = await ipcRenderer.invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, {
    contractVersion: 1,
    runtimeSource: { sourceId: source.sourceId, rootPath: source.rootPath },
    ref: canonicalRef
  });
  const validation = validateDirectoryEnvelopeV1(response);
  if (!validation.valid) {
    const error = new Error('目录扫描返回无效数据');
    error.code = 'INVALID_RESPONSE';
    throw error;
  }
  if (!response?.ok) {
    const error = new Error(response?.error?.message || '目录扫描失败');
    error.code = response?.error?.code || 'INVALID_RESPONSE';
    throw error;
  }
  return response.data;
}

export function useRandomNavigationCoordinator({
  activeTab,
  activeTabId,
  activeSourceRoot,
  tabs,
  commitTabLocation,
  ipcRenderer,
  onError
}) {
  const randomStateByTabRef = useRef(new Map());
  const loadingOwnersByTabRef = useRef(new Map());
  const tabGenerationsRef = useRef(new Map());
  const globalEpochRef = useRef(0);
  const nextOperationTokenRef = useRef(0);
  const tabSourceIdsRef = useRef(new Map());
  const activeTabIdRef = useRef(activeTabId);
  const activeTabRef = useRef(activeTab);
  const [loadingTabIds, setLoadingTabIds] = useState(() => new Set());
  const [, setCacheRevision] = useState(0);

  activeTabIdRef.current = activeTabId;
  activeTabRef.current = activeTab;

  const activeContext = useMemo(
    () => getRandomNavigationContext(activeTab?.location),
    [activeTab]
  );
  const available = Boolean(
    activeTabId
    && activeContext
    && activeSourceRoot
    && ipcRenderer?.invoke
    && sourceIdsEqualV1(activeSourceRoot.sourceId, activeContext.scopeRef.sourceId)
  );
  const activeLocationIdentity = getBrowserLocationIdentity(activeTab?.location);
  const observedActiveIdentityRef = useRef({
    tabId: activeTabId,
    locationIdentity: activeLocationIdentity
  });

  const bumpTabGeneration = useCallback((tabId) => {
    if (!tabId) return 0;
    const nextGeneration = (tabGenerationsRef.current.get(tabId) || 0) + 1;
    tabGenerationsRef.current.set(tabId, nextGeneration);
    return nextGeneration;
  }, []);

  const claimLoadingOwner = useCallback((tabId, operationToken) => {
    loadingOwnersByTabRef.current.set(tabId, operationToken);
    setLoadingTabIds(new Set(loadingOwnersByTabRef.current.keys()));
  }, []);

  const releaseLoadingOwner = useCallback((tabId, operationToken = null) => {
    if (!loadingOwnersByTabRef.current.has(tabId)) return false;
    if (operationToken !== null
        && loadingOwnersByTabRef.current.get(tabId) !== operationToken) {
      return false;
    }
    loadingOwnersByTabRef.current.delete(tabId);
    setLoadingTabIds(new Set(loadingOwnersByTabRef.current.keys()));
    return true;
  }, []);

  useEffect(() => {
    const previous = observedActiveIdentityRef.current;
    if (previous.tabId === activeTabId
        && previous.locationIdentity === activeLocationIdentity) {
      return;
    }
    if (previous.tabId) bumpTabGeneration(previous.tabId);
    observedActiveIdentityRef.current = {
      tabId: activeTabId,
      locationIdentity: activeLocationIdentity
    };
  }, [activeLocationIdentity, activeTabId, bumpTabGeneration]);

  useEffect(() => {
    const previousSourceIds = tabSourceIdsRef.current;
    const nextSourceIds = new Map();
    const liveTabIds = new Set();
    const invalidatedTabIds = new Set();

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      liveTabIds.add(tab.id);
      const sourceIdentity = getTabSourceIdentity(tab);
      nextSourceIds.set(tab.id, sourceIdentity);
      if (previousSourceIds.has(tab.id)
          && previousSourceIds.get(tab.id) !== sourceIdentity) {
        invalidatedTabIds.add(tab.id);
      }
    }

    for (const tabId of previousSourceIds.keys()) {
      if (liveTabIds.has(tabId)) continue;
      invalidatedTabIds.add(tabId);
    }

    tabSourceIdsRef.current = nextSourceIds;
    let loadingChanged = false;
    for (const tabId of invalidatedTabIds) {
      randomStateByTabRef.current.delete(tabId);
      bumpTabGeneration(tabId);
      loadingChanged = loadingOwnersByTabRef.current.delete(tabId) || loadingChanged;
    }
    if (loadingChanged) {
      setLoadingTabIds(new Set(loadingOwnersByTabRef.current.keys()));
    }
  }, [bumpTabGeneration, tabs]);

  useEffect(() => () => {
    globalEpochRef.current += 1;
  }, []);

  const storeScopeEntry = useCallback((tabId, scopeKey, entry) => {
    const scopes = randomStateByTabRef.current.get(tabId) || new Map();
    randomStateByTabRef.current.set(
      tabId,
      touchRandomScope(scopes, scopeKey, entry)
    );
  }, []);

  const readScopeEntry = useCallback((tabId, scopeKey) => {
    const scopes = randomStateByTabRef.current.get(tabId) || new Map();
    const entry = scopes.get(scopeKey) || { targets: null, bagState: null };
    randomStateByTabRef.current.set(
      tabId,
      touchRandomScope(scopes, scopeKey, entry)
    );
    return entry;
  }, []);

  const handleRandomBrowse = useCallback(async () => {
    if (!available || loadingOwnersByTabRef.current.has(activeTabId)) return false;

    const capturedTabId = activeTabId;
    const capturedLocationIdentity = getBrowserLocationIdentity(activeTab.location);
    const capturedTabGeneration = bumpTabGeneration(capturedTabId);
    const capturedGlobalEpoch = globalEpochRef.current;
    nextOperationTokenRef.current += 1;
    const operationToken = nextOperationTokenRef.current;
    const context = getRandomNavigationContext(activeTab.location);
    const source = activeSourceRoot;
    const operationStillMatches = () => (
      activeTabIdRef.current === capturedTabId
      && getBrowserLocationIdentity(activeTabRef.current?.location)
        === capturedLocationIdentity
      && tabGenerationsRef.current.get(capturedTabId) === capturedTabGeneration
      && globalEpochRef.current === capturedGlobalEpoch
    );
    claimLoadingOwner(capturedTabId, operationToken);

    try {
      let entry = readScopeEntry(capturedTabId, context.scopeKey);
      if (entry.targets === null) {
        const parentSnapshot = await loadDirectorySnapshot(
          ipcRenderer,
          source,
          context.scopeRef
        );
        if (!operationStillMatches()) return false;
        entry = {
          ...entry,
          targets: buildRandomNavigationTargets(parentSnapshot)
        };
        storeScopeEntry(capturedTabId, context.scopeKey, entry);
      }

      let targets = entry.targets;
      let pendingBagState = entry.bagState;
      const rejectedKeys = new Set();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const draw = drawUnrejectedTarget(
          pendingBagState,
          targets,
          context.currentCandidateKey,
          rejectedKeys
        );
        pendingBagState = draw.state;
        if (!draw.target) return false;

        try {
          const targetSnapshot = await loadDirectorySnapshot(
            ipcRenderer,
            source,
            draw.target.target
          );
          if (getRandomViewMode(targetSnapshot) !== draw.target.target.viewMode) {
            const error = new Error('目录内容已变化');
            error.code = 'TARGET_VIEW_CHANGED';
            throw error;
          }
        } catch (error) {
          if (!operationStillMatches()) return false;
          if (attempt > 0 || !RECOVERABLE_TARGET_ERRORS.has(error?.code)) {
            throw error;
          }

          rejectedKeys.add(draw.target.candidateKey);
          const parentSnapshot = await loadDirectorySnapshot(
            ipcRenderer,
            source,
            context.scopeRef
          );
          if (!operationStillMatches()) return false;
          targets = buildRandomNavigationTargets(parentSnapshot);
          storeScopeEntry(capturedTabId, context.scopeKey, {
            targets,
            bagState: entry.bagState
          });
          continue;
        }

        if (!operationStillMatches()) return false;
        storeScopeEntry(capturedTabId, context.scopeKey, {
          targets,
          bagState: pendingBagState
        });
        commitTabLocation({
          tabId: capturedTabId,
          browserLocation: {
            kind: 'directory',
            target: draw.target.target
          }
        });
        return true;
      }
      return false;
    } catch (error) {
      if (!operationStillMatches()) return false;
      onError?.(error.message || '目录扫描失败');
      return false;
    } finally {
      releaseLoadingOwner(capturedTabId, operationToken);
    }
  }, [
    activeSourceRoot,
    activeTab,
    activeTabId,
    available,
    bumpTabGeneration,
    claimLoadingOwner,
    commitTabLocation,
    ipcRenderer,
    onError,
    readScopeEntry,
    releaseLoadingOwner,
    storeScopeEntry
  ]);

  const invalidateActiveScope = useCallback(() => {
    if (!activeTabId || !activeContext) return;
    bumpTabGeneration(activeTabId);
    releaseLoadingOwner(activeTabId);
    const scopes = randomStateByTabRef.current.get(activeTabId);
    const entry = scopes?.get(activeContext.scopeKey);
    if (entry) {
      storeScopeEntry(activeTabId, activeContext.scopeKey, {
        ...entry,
        targets: null
      });
    }
    setCacheRevision((revision) => revision + 1);
  }, [
    activeContext,
    activeTabId,
    bumpTabGeneration,
    releaseLoadingOwner,
    storeScopeEntry
  ]);

  const clearAllRandomState = useCallback(() => {
    globalEpochRef.current += 1;
    randomStateByTabRef.current.clear();
    loadingOwnersByTabRef.current.clear();
    setLoadingTabIds(new Set());
    setCacheRevision((revision) => revision + 1);
  }, []);

  const randomBrowseLoading = loadingTabIds.has(activeTabId);
  const activeScopeEntry = activeContext
    ? randomStateByTabRef.current.get(activeTabId)?.get(activeContext.scopeKey)
    : null;
  const activeTargets = activeScopeEntry?.targets;
  const activeScopeHasKnownPool = Array.isArray(activeTargets);
  const activeScopeHasEligibleTarget = activeScopeHasKnownPool && activeTargets.some((item) => (
    item.candidateKey !== activeContext.currentCandidateKey
  ));

  return {
    available,
    randomBrowseLoading,
    randomBrowseDisabled: !available
      || randomBrowseLoading
      || (activeScopeHasKnownPool && !activeScopeHasEligibleTarget),
    handleRandomBrowse,
    invalidateActiveScope,
    clearAllRandomState
  };
}

export default useRandomNavigationCoordinator;
