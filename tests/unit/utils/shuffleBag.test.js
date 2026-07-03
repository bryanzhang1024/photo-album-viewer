import {
  shuffleArray,
  buildShufflePool,
  drawFromBag
} from '../../../src/renderer/utils/shuffleBag';

describe('shuffleBag', () => {
  test('shuffleArray returns a permutation of the input', () => {
    const source = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray(source, () => 0);

    expect(shuffled.sort()).toEqual(source);
    expect(source).toEqual([1, 2, 3, 4, 5]);
  });

  test('buildShufflePool excludes items by key', () => {
    const items = [
      { path: '/a' },
      { path: '/b' },
      { path: '/c' }
    ];

    expect(buildShufflePool(items, '/b', (item) => item.path)).toEqual([
      { path: '/a' },
      { path: '/c' }
    ]);
  });

  test('drawFromBag pops without replacement then refills', () => {
    const pool = ['a', 'b', 'c'];
    let state = { queue: [] };

    const first = drawFromBag(state, pool, () => 0);
    state = first.state;
    const second = drawFromBag(state, pool, () => 0);
    state = second.state;
    const third = drawFromBag(state, pool, () => 0);
    state = third.state;

    expect(new Set([first.item, second.item, third.item])).toEqual(new Set(pool));

    const fourth = drawFromBag(state, pool, () => 0);
    expect(pool).toContain(fourth.item);
  });

  test('drawFromBag returns null for empty pool', () => {
    const result = drawFromBag({ queue: [] }, []);
    expect(result.item).toBeNull();
  });
});
