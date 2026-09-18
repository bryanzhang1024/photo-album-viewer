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
  const [, setRevision] = useState(0);
  const scopeKey = JSON.stringify(scope);
  if (locationRef.current !== locationIdentity) {
    locationRef.current = locationIdentity;
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
    setLoading(false);
    setRevision(value => value + 1);
  }, []);

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
  return {
    handleRandomBrowse,
    clearRandomState,
    randomBrowseLoading,
    randomBrowseDisabled: !available || randomBrowseLoading
      || (Array.isArray(knownTargets) && !knownTargets.some(item => item.candidateKey !== currentSetId))
  };
}
