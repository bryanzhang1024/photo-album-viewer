import {
  listRecentLocations,
  recordLocation,
  forgetLocation,
  RECENT_LOCATIONS_MAX
} from '../../src/ui/data/recentLocations';

const KEY = 'pav.recent-locations.v1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('接着看：最近打开的位置', () => {
  test('没记录时返回空数组', () => {
    expect(listRecentLocations()).toEqual([]);
  });

  test('同一来源只留最近一条，按时间倒序', () => {
    recordLocation('src_a', 'b/c', 1000);
    recordLocation('src_b', '', 2000);
    recordLocation('src_a', 'd/e', 3000);

    expect(listRecentLocations()).toEqual([
      { sourceId: 'src_a', relativePath: 'd/e', at: 3000 },
      { sourceId: 'src_b', relativePath: '', at: 2000 }
    ]);
  });

  test('记录格式固定，坏 JSON 与坏条目都被忽略', () => {
    window.localStorage.setItem(KEY, '{ not json');
    expect(listRecentLocations()).toEqual([]);

    window.localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      entries: [
        { sourceId: 'src_a', relativePath: '', at: 5 },
        { sourceId: '', relativePath: 'x', at: 6 },
        { sourceId: 'src_b', relativePath: null, at: 7 },
        { sourceId: 'src_c', relativePath: 'y', at: 'later' }
      ]
    }));
    expect(listRecentLocations()).toEqual([{ sourceId: 'src_a', relativePath: '', at: 5 }]);
  });

  test('条数封顶，只保留最新的若干条', () => {
    for (let index = 0; index < RECENT_LOCATIONS_MAX + 5; index += 1) {
      recordLocation(`src_${index}`, `p${index}`, 1000 + index);
    }
    const entries = listRecentLocations();
    expect(entries).toHaveLength(RECENT_LOCATIONS_MAX);
    expect(entries[0].sourceId).toBe(`src_${RECENT_LOCATIONS_MAX + 4}`);
  });

  test('失效位置可以整条清掉', () => {
    recordLocation('src_a', 'gone', 10);
    recordLocation('src_b', 'kept', 20);

    forgetLocation('src_a');

    expect(listRecentLocations()).toEqual([{ sourceId: 'src_b', relativePath: 'kept', at: 20 }]);
  });

  test('参数非法时不写入', () => {
    expect(recordLocation('', 'x', 1)).toBe(false);
    expect(recordLocation('src_a', 'x', Number.NaN)).toBe(false);
    expect(listRecentLocations()).toEqual([]);
  });

  test('localStorage 不可用时静默返回空，不抛错', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied'); }
    });
    try {
      expect(listRecentLocations()).toEqual([]);
      expect(recordLocation('src_a', 'x', 1)).toBe(false);
    } finally {
      Object.defineProperty(window, 'localStorage', original);
    }
  });
});
