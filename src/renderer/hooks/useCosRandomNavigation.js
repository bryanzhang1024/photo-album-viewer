import { useCallback, useEffect, useRef, useState } from 'react';
import CHANNELS from '../../common/ipc-channels';
import { drawRandomNavigationTarget, touchRandomScope } from '../utils/randomNavigation';

// Scope queues belong to this Cos browser and survive list/album route changes.
export default function useCosRandomNavigation({
  scope, locationIdentity, currentSetId, available, ipcRenderer, onOpen, onError
}) {
  const scopesRef = useRef(new Map());
  const ownerRef = useRef(null);
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const locationRef = useRef(locationIdentity);
  const [randomBrowseLoading, setLoading] = useState(false);
  const [adjacentBrowseLoading, setAdjacentLoading] = useState(false);
  const orderedScopesRef = useRef(new Map());
  const [orderedState, setOrderedState] = useState({ key: null, ids: [] });
  const [, setRevision] = useState(0);
  const scopeKey = JSON.stringify(scope);
  const scopeRef = useRef(scopeKey);
  if (locationRef.current !== locationIdentity || scopeRef.current !== scopeKey) {
    locationRef.current = locationIdentity;
    scopeRef.current = scopeKey;
    epochRef.current += 1;
  }
  const availableRef = useRef(available);
  availableRef.current = available;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; epochRef.current += 1; };
  }, []);

  const clearRandomState = useCallback(() => {
    epochRef.current += 1;
    ownerRef.current = null;
    scopesRef.current.clear();
    orderedScopesRef.current.clear();
    setOrderedState({ key: null, ids: [] });
    setAdjacentLoading(false);
    setLoading(false);
    setRevision(value => value + 1);
  }, []);

  const loadOrderedIds = useCallback(async () => {
    let entry = orderedScopesRef.current.get(scopeKey);
    if (!entry) {
      entry = { promise: ipcRenderer.invoke(CHANNELS.COS_LIST_SET_IDS, scope)
        .then(ids => [...new Set(Array.isArray(ids) ? ids : [])]) };
      orderedScopesRef.current.set(scopeKey, entry);
    }
    return entry.promise;
  }, [scopeKey, scope, ipcRenderer]);

  useEffect(() => {
    if (!available || !currentSetId) return undefined;
    let active = true;
    loadOrderedIds().then(ids => { if (active) setOrderedState({ key: scopeKey, ids }); })
      .catch(reason => { if (active) onError(reason?.message || '无法读取换套范围'); });
    return () => { active = false; };
  }, [available, currentSetId, loadOrderedIds, scopeKey, onError]);

  const handleAdjacentBrowse = useCallback(async direction => {
    if (!available || !currentSetId || ownerRef.current || !['prev', 'next'].includes(direction)) return false;
    const owner = {};
    ownerRef.current = owner;
    const epoch = epochRef.current;
    const stillCurrent = () => mountedRef.current && availableRef.current
      && epochRef.current === epoch && ownerRef.current === owner;
    setAdjacentLoading(true);
    try {
      const ids = await loadOrderedIds();
      const currentIndex = ids.indexOf(currentSetId);
      if (!stillCurrent() || currentIndex < 0) return false;
      const step = direction === 'prev' ? -1 : 1;
      for (let index = currentIndex + step; index >= 0 && index < ids.length; index += step) {
        const id = ids[index];
        const [setItem, albumPath] = await Promise.all([
          ipcRenderer.invoke(CHANNELS.COS_GET_SET, id),
          ipcRenderer.invoke(CHANNELS.COS_GET_SET_ALBUM_PATH, id)
        ]);
        if (!stillCurrent()) return false;
        if (!setItem || !albumPath || setItem.status === 'offline' || setItem.imageCount === 0) continue;
        onOpen(setItem, albumPath);
        return true;
      }
      onError(direction === 'prev' ? '当前范围没有可打开的上一套' : '当前范围没有可打开的下一套');
      return false;
    } catch (reason) {
      if (stillCurrent()) onError(reason?.message || '切换套图失败');
      return false;
    } finally {
      if (ownerRef.current === owner) {
        ownerRef.current = null;
        if (mountedRef.current) setAdjacentLoading(false);
      }
    }
  }, [available, currentSetId, loadOrderedIds, ipcRenderer, onOpen, onError]);

  const handleRandomBrowse = useCallback(async () => {
    if (!available || ownerRef.current) return false;
    const owner = {};
    ownerRef.current = owner;
    const epoch = epochRef.current;
    const stillCurrent = () => mountedRef.current && availableRef.current
      && epochRef.current === epoch && ownerRef.current === owner;
    const store = entry => {
      scopesRef.current = touchRandomScope(scopesRef.current, scopeKey, entry);
      setRevision(value => value + 1);
    };
    setLoading(true);
    try {
      let entry = scopesRef.current.get(scopeKey);
      if (!entry) {
        const ids = await ipcRenderer.invoke(CHANNELS.COS_LIST_RANDOM_SET_IDS, scope);
        if (!stillCurrent()) return false;
        entry = {
          targets: [...new Set(ids || [])].map(id => ({
            candidateKey: id, target: { setId: id, viewMode: 'cosSet' }
          })),
          bagState: null
        };
        store(entry);
      }
      while (stillCurrent()) {
        const draw = drawRandomNavigationTarget(entry.bagState, entry.targets, {
          currentCandidateKey: currentSetId
        });
        entry = { ...entry, bagState: draw.state };
        store(entry);
        if (!draw.target) {
          onError(draw.reason === 'noOtherCandidate'
            ? '当前范围没有其他可打开的套图' : '当前范围没有可打开的套图');
          return false;
        }
        const id = draw.target.target.setId;
        const [setItem, albumPath] = await Promise.all([
          ipcRenderer.invoke(CHANNELS.COS_GET_SET, id),
          ipcRenderer.invoke(CHANNELS.COS_GET_SET_ALBUM_PATH, id)
        ]);
        if (!stillCurrent()) return false;
        if (!setItem || !albumPath) {
          entry = { ...entry, targets: entry.targets.filter(item => item.candidateKey !== id) };
          store(entry);
          continue;
        }
        onOpen(setItem, albumPath);
        return true;
      }
      return false;
    } catch (reason) {
      if (stillCurrent()) onError(reason?.message || '随机套图失败');
      return false;
    } finally {
      if (ownerRef.current === owner) {
        ownerRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [available, scopeKey, scope, currentSetId, ipcRenderer, onOpen, onError]);

  const knownTargets = scopesRef.current.get(scopeKey)?.targets;
  const orderedIds = orderedState.key === scopeKey ? orderedState.ids : [];
  const currentIndex = orderedIds.indexOf(currentSetId);
  const navigationBusy = randomBrowseLoading || adjacentBrowseLoading || !available;
  return {
    handleRandomBrowse,
    clearRandomState,
    randomBrowseLoading,
    randomBrowseDisabled: navigationBusy
      || (Array.isArray(knownTargets) && !knownTargets.some(item => item.candidateKey !== currentSetId)),
    handleAdjacentBrowse,
    adjacentBrowseLoading,
    setNavigation: { currentIndex, total: orderedIds.length,
      prev: !navigationBusy && currentIndex > 0 ? { name: '当前范围上一套' } : null,
      next: !navigationBusy && currentIndex >= 0 && currentIndex < orderedIds.length - 1 ? { name: '当前范围下一套' } : null,
      onPrev: () => handleAdjacentBrowse('prev'), onNext: () => handleAdjacentBrowse('next'),
      noun: '套图' }
  };
}
