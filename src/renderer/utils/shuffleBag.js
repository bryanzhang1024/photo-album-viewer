/**
 * Fisher-Yates shuffle — returns a new array, does not mutate input.
 */
export function shuffleArray(items, randomFn = Math.random) {
  const bag = items.slice();
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/**
 * Build candidate pool, optionally excluding items by key.
 */
export function buildShufflePool(items, excludeKey, getKey) {
  if (!items.length) {
    return [];
  }

  if (excludeKey == null) {
    return items.slice();
  }

  const excludeSet = new Set(Array.isArray(excludeKey) ? excludeKey : [excludeKey]);
  return items.filter((item) => !excludeSet.has(getKey ? getKey(item) : item));
}

/**
 * Draw the next item from a shuffle bag. Refills automatically when empty.
 */
export function drawFromBag(state, pool, randomFn = Math.random) {
  if (!pool.length) {
    return { item: null, state: { queue: [] } };
  }

  let { queue } = state;
  if (!queue.length) {
    queue = shuffleArray(pool, randomFn);
  }

  const [item, ...rest] = queue;
  return { item, state: { queue: rest } };
}
