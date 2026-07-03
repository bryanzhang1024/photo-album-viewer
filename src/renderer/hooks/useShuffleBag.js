import { useRef, useCallback, useEffect, useMemo } from 'react';
import { buildShufflePool, drawFromBag } from '../utils/shuffleBag';

/**
 * Pocket-style random: shuffle once per scope, pop without replacement,
 * auto-refill when exhausted.
 */
export default function useShuffleBag(items, scopeKey, options = {}) {
  const { getKey, excludeKey } = options;
  const bagStateRef = useRef({ queue: [] });

  const poolSignature = useMemo(() => {
    const keys = items.map((item) => (getKey ? getKey(item) : item));
    const excludePart = excludeKey == null ? '' : String(excludeKey);
    return `${scopeKey}\0${excludePart}\0${keys.join('\0')}`;
  }, [items, scopeKey, getKey, excludeKey]);

  useEffect(() => {
    bagStateRef.current = { queue: [] };
  }, [poolSignature]);

  const resetBag = useCallback(() => {
    bagStateRef.current = { queue: [] };
  }, []);

  const drawNext = useCallback(() => {
    const pool = buildShufflePool(items, excludeKey, getKey);
    const { item, state } = drawFromBag(bagStateRef.current, pool);
    bagStateRef.current = state;
    return item ?? null;
  }, [items, excludeKey, getKey]);

  return { drawNext, resetBag };
}
