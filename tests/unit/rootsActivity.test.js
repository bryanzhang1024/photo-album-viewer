import {
  RECENT_WINDOW_MS,
  absolutePathOf,
  registeredRootPaths,
  buildSourceEntries,
  mergeFeed,
  countToday,
  formatWhen
} from '../../src/ui/features/roots/rootsActivity';

const NOW = new Date(2026, 9, 27, 10, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const SOURCE = { sourceId: 'src_a', label: 'A-库', rootPath: '/A' };
const CHILD_SOURCE = { sourceId: 'src_b', label: 'B-库', rootPath: '/A/b' };

function child(relativePath, { images = 3, mtimeMs = NOW - 1000, cover = '', subdirs = 0 } = {}) {
  return {
    name: relativePath.split('/').pop(),
    ref: { sourceId: 'src_a', relativePath },
    status: 'ok',
    facts: { directMediaCount: images, childDirectoryCount: subdirs },
    mtimeMs,
    approximate: { coverSamples: cover ? [cover] : [] }
  };
}

function snapshotOf(children) {
  return {
    locator: { sourceId: 'src_a', relativePath: '', absolutePath: '/A' },
    facts: { childDirectoryCount: children.length, directMediaCount: 0 },
    children,
    directMedia: [],
    approximate: { coverSamples: [] }
  };
}

describe('最近有变化的聚合规则', () => {
  test('只收有直接图片、且在 7 天内的子文件夹', () => {
    const snapshot = snapshotOf([
      child('今天', { images: 5, mtimeMs: NOW - 1000 }),
      child('六天前', { images: 5, mtimeMs: NOW - 6 * DAY }),
      child('八天前', { images: 5, mtimeMs: NOW - 8 * DAY }),
      child('只有子目录', { images: 0, mtimeMs: NOW - 1000, subdirs: 4 }),
      child('没有时间', { images: 5, mtimeMs: null })
    ]);

    const entries = buildSourceEntries(SOURCE, snapshot, { now: NOW });
    expect(entries.map((entry) => entry.name)).toEqual(['今天', '六天前']);
  });

  test('正好 7 天边界算在内（按滚动 7×24 小时）', () => {
    const snapshot = snapshotOf([child('边界', { mtimeMs: NOW - RECENT_WINDOW_MS })]);
    expect(buildSourceEntries(SOURCE, snapshot, { now: NOW })).toHaveLength(1);
  });

  test('子目录本身是另一个已注册来源时跳过，避免同一件事出现两次', () => {
    const snapshot = snapshotOf([
      child('b', { images: 2, mtimeMs: NOW - 1000 }),
      child('c', { images: 2, mtimeMs: NOW - 2000 })
    ]);
    const paths = registeredRootPaths([SOURCE, CHILD_SOURCE]);

    const entries = buildSourceEntries(SOURCE, snapshot, { now: NOW, registeredPaths: paths });
    expect(entries.map((entry) => entry.name)).toEqual(['c']);
  });

  test('条目带上来源、张数、封面与稳定 key', () => {
    const snapshot = snapshotOf([
      child('套图甲', { images: 29, mtimeMs: NOW - 1000, cover: '套图甲/001.jpg' })
    ]);
    const entries = buildSourceEntries(SOURCE, snapshot, { now: NOW });
    expect(entries[0]).toMatchObject({
      key: 'src_a:套图甲',
      sourceId: 'src_a',
      sourceLabel: 'A-库',
      relativePath: '套图甲',
      imageCount: 29,
      cover: '套图甲/001.jpg'
    });
  });

  test('跨来源按时间倒序合并，超过上限只留最新的', () => {
    const entriesBySource = {
      src_a: [{ name: 'a1', mtimeMs: NOW - 1000 }, { name: 'a2', mtimeMs: NOW - 3000 }],
      src_b: [{ name: 'b1', mtimeMs: NOW - 2000 }]
    };
    expect(mergeFeed(entriesBySource, 2).map((entry) => entry.name)).toEqual(['a1', 'b1']);
    expect(mergeFeed(entriesBySource, 10).map((entry) => entry.name)).toEqual(['a1', 'b1', 'a2']);
  });

  test('今天改过的计数只算本地时区的今天', () => {
    const entries = [
      { mtimeMs: NOW - 1000 },
      { mtimeMs: new Date(2026, 9, 26, 23, 59, 0).getTime() },
      { mtimeMs: new Date(2026, 9, 27, 0, 0, 1).getTime() }
    ];
    expect(countToday(entries, NOW)).toBe(2);
  });
});

describe('行尾时间的写法', () => {
  test('今天带时分，昨天只写昨天，更早写月-日', () => {
    expect(formatWhen(new Date(2026, 9, 27, 9, 12).getTime(), NOW)).toBe('今天 09:12');
    expect(formatWhen(new Date(2026, 9, 26, 22, 0).getTime(), NOW)).toBe('昨天');
    expect(formatWhen(new Date(2026, 9, 20, 8, 0).getTime(), NOW)).toBe('10-20');
  });

  test('时间缺失时返回空串', () => {
    expect(formatWhen(undefined, NOW)).toBe('');
  });
});

describe('绝对路径拼接', () => {
  test('去掉根目录尾斜杠，空相对路径就是根本身', () => {
    expect(absolutePathOf('/A/', '')).toBe('/A');
    expect(absolutePathOf('/A', 'b/c')).toBe('/A/b/c');
    expect(absolutePathOf('/A/', '/b')).toBe('/A/b');
  });
});
