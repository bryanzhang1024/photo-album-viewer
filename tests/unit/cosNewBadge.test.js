import {
  isRecentlyAdded,
  setCardItems,
  NEW_BADGE_WINDOW_MS
} from '../../src/ui/features/cos/cardItems';

const NOW = new Date('2026-10-30T14:30:00+08:00').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeSet(overrides = {}) {
  return {
    id: 's1',
    displayName: 'G44不会受伤｜紫乃',
    works: ['原创写真'],
    type: 'photo',
    imageCount: 43,
    coverMediaId: null,
    ...overrides
  };
}

describe('套图「新」角标判定（4.8.0）', () => {
  test('时间窗与「最近有变化」一致：7 天', () => {
    expect(NEW_BADGE_WINDOW_MS).toBe(7 * DAY);
  });

  test('1 小时前动过的算新', () => {
    expect(isRecentlyAdded(NOW - HOUR, NOW)).toBe(true);
  });

  test('窗口内最后一秒仍算新', () => {
    expect(isRecentlyAdded(NOW - NEW_BADGE_WINDOW_MS + 1000, NOW)).toBe(true);
  });

  test('正好 7 天前不算新', () => {
    expect(isRecentlyAdded(NOW - NEW_BADGE_WINDOW_MS, NOW)).toBe(false);
  });

  test('8 天前、1 年前都不算新', () => {
    expect(isRecentlyAdded(NOW - 8 * DAY, NOW)).toBe(false);
    expect(isRecentlyAdded(NOW - 365 * DAY, NOW)).toBe(false);
  });

  test('缺 lastModified、0、null、空串都不算新（旧索引没有这个字段）', () => {
    expect(isRecentlyAdded(undefined, NOW)).toBe(false);
    expect(isRecentlyAdded(null, NOW)).toBe(false);
    expect(isRecentlyAdded(0, NOW)).toBe(false);
    expect(isRecentlyAdded('', NOW)).toBe(false);
    expect(isRecentlyAdded('not-a-number', NOW)).toBe(false);
  });

  test('用户时钟比文件时间慢时（未来时间）仍算新，避免静默漏标', () => {
    expect(isRecentlyAdded(NOW + HOUR, NOW)).toBe(true);
  });

  test('套图卡只在最近动过的套上加 badge，名称与副行不受影响', () => {
    const fresh = makeSet({ id: 'fresh', lastModified: NOW - HOUR });
    const old = makeSet({ id: 'old', displayName: 'G44不会受伤｜真夜子', lastModified: NOW - 30 * DAY });
    const plain = makeSet({ id: 'plain' });

    const [freshCard, oldCard, plainCard] = setCardItems([fresh, old, plain], { now: NOW });

    expect(freshCard.badge).toBe('新');
    expect(oldCard.badge).toBeNull();
    expect(plainCard.badge).toBeNull();

    expect(freshCard.name).toBe('G44不会受伤｜紫乃');
    expect(freshCard.meta).toBe('原创写真 · 43 张');
    expect(freshCard.payload).toBe(fresh);
  });

  test('不传 now 时按当前时间判定（今天入库的会带标）', () => {
    const [card] = setCardItems([makeSet({ lastModified: Date.now() - HOUR })]);
    expect(card.badge).toBe('新');
  });
});
