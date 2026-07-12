import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CHANNELS from '../../common/ipc-channels';
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
  const loadingTabIdsRef = useRef(new Set());
  const operationGenerationRef = useRef(0);
  const tabSourceIdsRef = useRef(new Map());
  const activeTabIdRef = useRef(activeTabId);
  const activeTabRef = useRef(activeTab);
  const [loadingTabIds, setLoadingTabIds] = useState(() => new Set());

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
  const activeOperationIdentity = `${activeTabId || ''}\n${
    getBrowserLocationIdentity(activeTab?.location)
  }`;
  const observedActiveIdentityRef = useRef(activeOperationIdentity);

  useEffect(() => {
    if (observedActiveIdentityRef.current === activeOperationIdentity) return;
    observedActiveIdentityRef.current = activeOperationIdentity;
    operationGenerationRef.current += 1;
  }, [activeOperationIdentity]);

  useEffect(() => {
    const previousSourceIds = tabSourceIdsRef.current;
    const nextSourceIds = new Map();
    const liveTabIds = new Set();
    let invalidated = false;

    for (const tab of Array.isArray(tabs) ? tabs : []) {
      liveTabIds.add(tab.id);
      const sourceIdentity = getTabSourceIdentity(tab);
      nextSourceIds.set(tab.id, sourceIdentity);
      if (previousSourceIds.has(tab.id)
          && previousSourceIds.get(tab.id) !== sourceIdentity) {
        randomStateByTabRef.current.delete(tab.id);
        invalidated = true;
      }
    }

    for (const tabId of previousSourceIds.keys()) {
      if (liveTabIds.has(tabId)) continue;
      randomStateByTabRef.current.delete(tabId);
      invalidated = true;
    }

    tabSourceIdsRef.current = nextSourceIds;
    if (invalidated) operationGenerationRef.current += 1;

    const nextLoadingTabIds = new Set(
      [...loadingTabIdsRef.current].filter((tabId) => liveTabIds.has(tabId))
    );
    if (nextLoadingTabIds.size !== loadingTabIdsRef.current.size) {
      loadingTabIdsRef.current = nextLoadingTabIds;
      setLoadingTabIds(nextLoadingTabIds);
    }
  }, [tabs]);

  useEffect(() => () => {
    operationGenerationRef.current += 1;
  }, []);

  const setTabLoading = useCallback((tabId, loading) => {
    const nextLoadingTabIds = new Set(loadingTabIdsRef.current);
    if (loading) nextLoadingTabIds.add(tabId);
    else nextLoadingTabIds.delete(tabId);
    loadingTabIdsRef.current = nextLoadingTabIds;
    setLoadingTabIds(nextLoadingTabIds);
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
    if (!available || loadingTabIdsRef.current.has(activeTabId)) return false;

    const capturedTabId = activeTabId;
    const capturedLocationIdentity = getBrowserLocationIdentity(activeTab.location);
    operationGenerationRef.current += 1;
    const capturedOperationGeneration = operationGenerationRef.current;
    const context = getRandomNavigationContext(activeTab.location);
    const source = activeSourceRoot;
    const operationStillMatches = () => (
      activeTabIdRef.current === capturedTabId
      && getBrowserLocationIdentity(activeTabRef.current?.location)
        === capturedLocationIdentity
      && operationGenerationRef.current === capturedOperationGeneration
    );
    setTabLoading(capturedTabId, true);

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
      setTabLoading(capturedTabId, false);
    }
  }, [
    activeSourceRoot,
    activeTab,
    activeTabId,
    available,
    commitTabLocation,
    ipcRenderer,
    onError,
    readScopeEntry,
    setTabLoading,
    storeScopeEntry
  ]);

  const invalidateActiveScope = useCallback(() => {
    operationGenerationRef.current += 1;
    if (!activeTabId || !activeContext) return;
    const scopes = randomStateByTabRef.current.get(activeTabId);
    const entry = scopes?.get(activeContext.scopeKey);
    if (!entry) return;
    storeScopeEntry(activeTabId, activeContext.scopeKey, {
      ...entry,
      targets: null
    });
  }, [activeContext, activeTabId, storeScopeEntry]);

  const clearAllRandomState = useCallback(() => {
    operationGenerationRef.current += 1;
    randomStateByTabRef.current.clear();
  }, []);

  const randomBrowseLoading = loadingTabIds.has(activeTabId);

  return {
    available,
    randomBrowseLoading,
    randomBrowseDisabled: !available || randomBrowseLoading,
    handleRandomBrowse,
    invalidateActiveScope,
    clearAllRandomState
  };
}

export default useRandomNavigationCoordinator;
