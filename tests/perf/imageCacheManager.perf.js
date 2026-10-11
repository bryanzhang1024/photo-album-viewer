/**
 * 性能测量：旧数组 LRU vs 新 Map 插入序 LRU
 *
 * 运行: npm run bench:cache
 *
 * 旧实现每次 get/set 都对整个 lruQueue 做 filter，成本随条目数线性上升。
 * 这里把旧算法原样复刻在本地，与真实的 ImageCacheManager 在同一进程同一
 * 时间窗口内对比，避免跨运行的环境差异。
 */

import { ImageCacheManager } from '../../src/renderer/utils/ImageCacheManager';

/** 旧实现（3.8.6 之前）的 LRU 部分，原样复刻用于对照 */
class LegacyLruCache {
  constructor() {
    this.memoryCache = new Map();
    this.lruQueue = [];
  }

  set(key, data) {
    this.memoryCache.set(key, { data, size: 100, expiry: Number.POSITIVE_INFINITY });
    this.updateLRU(key);
  }

  get(key) {
    const item = this.memoryCache.get(key);
    if (!item) return null;
    this.updateLRU(key);
    return item.data;
  }

  updateLRU(key) {
    this.lruQueue = this.lruQueue.filter((k) => k !== key);
    this.lruQueue.unshift(key);
  }
}

const ENTRIES = [1000, 5000, 20000, 50000];
const GET_ITERATIONS = 200;
const RENDER_SIMULATION = { cards: 200, getsPerCard: 5 };

function time(fn, iterations) {
  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn(i);
  }
  return performance.now() - startedAt;
}

function buildLegacy(size) {
  const cache = new LegacyLruCache();
  for (let i = 0; i < size; i += 1) {
    cache.set(`k${i}`, `url-${i}`);
  }
  return cache;
}

function buildCurrent(size) {
  const cache = new ImageCacheManager();
  cache.cacheConfig.thumbnail.maxEntries = size + 1;
  cache.maxMemoryBytes = Number.MAX_SAFE_INTEGER; // 只比 LRU 结构成本，不让字节淘汰介入
  for (let i = 0; i < size; i += 1) {
    cache.set('thumbnail', `k${i}`, `url-${i}`);
  }
  return cache;
}

describe('ImageCacheManager LRU 性能', () => {
  test('单次 get 成本对条目数的增长', () => {
    console.log('\n  条目数    旧数组 LRU      新 Map LRU     倍数');
    const rows = [];

    for (const size of ENTRIES) {
      const legacy = buildLegacy(size);
      const current = buildCurrent(size);
      const probeKey = `k${Math.floor(size / 2)}`;

      // 预热，避免首轮 JIT 影响
      for (let i = 0; i < 20; i += 1) {
        legacy.get(probeKey);
        current.get('thumbnail', probeKey);
      }

      const legacyMs = time(() => legacy.get(probeKey), GET_ITERATIONS) / GET_ITERATIONS;
      const currentMs = time(() => current.get('thumbnail', probeKey), GET_ITERATIONS) / GET_ITERATIONS;
      const ratio = legacyMs / currentMs;

      rows.push({ size, legacyMs, currentMs, ratio });
      console.log(
        `  ${String(size).padStart(6)}    ${legacyMs.toFixed(4)}ms     ${currentMs.toFixed(4)}ms    ${ratio.toFixed(1)}x`
      );
    }

    const largest = rows[rows.length - 1];
    // 旧实现成本随条目数线性上升；新实现应基本持平
    const legacyGrowth = rows[rows.length - 1].legacyMs / rows[0].legacyMs;
    const currentGrowth = rows[rows.length - 1].currentMs / rows[0].currentMs;
    console.log(
      `\n  从 ${ENTRIES[0]} 到 ${ENTRIES[ENTRIES.length - 1]} 条目的单次成本增长：` +
        `旧 ${legacyGrowth.toFixed(1)}x，新 ${currentGrowth.toFixed(1)}x`
    );
    console.log(`  5 万条目下单次 get：旧 ${largest.legacyMs.toFixed(3)}ms → 新 ${largest.currentMs.toFixed(4)}ms`);

    // 断言保持宽松，只验证「不再随条目数线性增长」这一结构性结论
    expect(largest.ratio).toBeGreaterThan(5);
    expect(currentGrowth).toBeLessThan(3);
  });

  test('模拟一次 200 张图块渲染的总查找成本', () => {
    const size = 20000;
    const legacy = buildLegacy(size);
    const current = buildCurrent(size);

    const legacyTotal = time(
      (i) => legacy.get(`k${i % size}`),
      RENDER_SIMULATION.cards * RENDER_SIMULATION.getsPerCard
    );
    const currentTotal = time(
      (i) => current.get('thumbnail', `k${i % size}`),
      RENDER_SIMULATION.cards * RENDER_SIMULATION.getsPerCard
    );

    console.log(
      `\n  ${RENDER_SIMULATION.cards} 张图块 × 每张 ${RENDER_SIMULATION.getsPerCard} 次查找 ` +
        `（缓存 ${size} 条目）：旧 ${legacyTotal.toFixed(1)}ms，新 ${currentTotal.toFixed(1)}ms`
    );

    expect(legacyTotal / currentTotal).toBeGreaterThan(5);
  });
});
