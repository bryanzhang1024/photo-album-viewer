import imageCache, { ImageCacheManager } from '../../../src/renderer/utils/ImageCacheManager';

describe('ImageCacheManager', () => {
  let cache;

  beforeEach(() => {
    cache = new ImageCacheManager();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('基本读写', () => {
    test('set 后 get 返回同一份数据', () => {
      cache.set('thumbnail', '/photos/a.jpg', 'thumbnail-protocol://a.webp');
      expect(cache.get('thumbnail', '/photos/a.jpg')).toBe('thumbnail-protocol://a.webp');
    });

    test('未命中返回 null 并计入统计', () => {
      expect(cache.get('thumbnail', '/photos/missing.jpg')).toBeNull();
      const stats = cache.getStats();
      expect(stats.requests.totalGets).toBe(1);
      expect(stats.requests.totalMisses).toBe(1);
    });

    test('未知类型不会抛错', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      expect(() => cache.set('nope', 'x', 'y')).not.toThrow();
      expect(cache.get('nope', 'x')).toBeNull();
      warn.mockRestore();
    });

    test('options 参与缓存键，不同 options 互不覆盖', () => {
      cache.set('thumbnail', '/photos/a.jpg', 'small', { width: 100 });
      cache.set('thumbnail', '/photos/a.jpg', 'large', { width: 600 });
      expect(cache.get('thumbnail', '/photos/a.jpg', { width: 100 })).toBe('small');
      expect(cache.get('thumbnail', '/photos/a.jpg', { width: 600 })).toBe('large');
    });
  });

  describe('条目数上限（旧的字节预算对 URL 字符串几乎永不生效）', () => {
    test('超过 maxEntries 后按 LRU 淘汰，数量不再增长', () => {
      cache.cacheConfig.thumbnail.maxEntries = 3;

      for (let i = 0; i < 5; i += 1) {
        cache.set('thumbnail', `/photos/${i}.jpg`, `url-${i}`);
      }

      const stats = cache.getStats();
      expect(stats.types.thumbnail.count).toBe(3);
      expect(stats.types.thumbnail.maxEntries).toBe(3);

      // 保留的是最近写入的三个
      expect(cache.get('thumbnail', '/photos/0.jpg')).toBeNull();
      expect(cache.get('thumbnail', '/photos/1.jpg')).toBeNull();
      expect(cache.get('thumbnail', '/photos/4.jpg')).toBe('url-4');
    });

    test('get 会刷新最近使用，被淘汰的是最久未用的那个', () => {
      cache.cacheConfig.thumbnail.maxEntries = 3;

      cache.set('thumbnail', 'a', 'url-a');
      cache.set('thumbnail', 'b', 'url-b');
      cache.set('thumbnail', 'c', 'url-c');

      // 访问 a，使其成为最近使用
      expect(cache.get('thumbnail', 'a')).toBe('url-a');

      // 再插入一个，应淘汰 b（最久未用），而不是 a
      cache.set('thumbnail', 'd', 'url-d');

      expect(cache.get('thumbnail', 'b')).toBeNull();
      expect(cache.get('thumbnail', 'a')).toBe('url-a');
      expect(cache.get('thumbnail', 'c')).toBe('url-c');
      expect(cache.get('thumbnail', 'd')).toBe('url-d');
    });

    test('大量写入后上限依然被遵守（取代旧的无界队列）', () => {
      cache.cacheConfig.thumbnail.maxEntries = 2000;

      for (let i = 0; i < 6000; i += 1) {
        cache.set('thumbnail', `/photos/${i}.jpg`, `url-${i}`);
      }

      const stats = cache.getStats();
      expect(stats.types.thumbnail.count).toBe(2000);
      expect(stats.totalEntries).toBe(2000);
      // 最新的仍在
      expect(cache.get('thumbnail', '/photos/5999.jpg')).toBe('url-5999');
      // 最旧的已被淘汰
      expect(cache.get('thumbnail', '/photos/0.jpg')).toBeNull();
    });

    test('覆盖同一键不会让计数虚增', () => {
      cache.cacheConfig.thumbnail.maxEntries = 2;

      cache.set('thumbnail', 'a', 'v1');
      cache.set('thumbnail', 'a', 'v2');
      cache.set('thumbnail', 'a', 'v3');

      const stats = cache.getStats();
      expect(stats.types.thumbnail.count).toBe(1);
      expect(cache.get('thumbnail', 'a')).toBe('v3');
    });
  });

  describe('类型隔离与全局预算', () => {
    test('thumbnail 写满不会挤掉 navigation', () => {
      cache.cacheConfig.thumbnail.maxEntries = 2;

      cache.set('navigation', '/photos', { success: true });
      for (let i = 0; i < 10; i += 1) {
        cache.set('thumbnail', `/photos/${i}.jpg`, `url-${i}`);
      }

      expect(cache.getStats().types.thumbnail.count).toBe(2);
      expect(cache.get('navigation', '/photos')).toEqual({ success: true });
    });

    test('全局字节预算仍然生效', () => {
      cache.maxMemoryBytes = 2000;
      // 每个字符串约 2 字节/字符，40 字符约 80 字节
      for (let i = 0; i < 100; i += 1) {
        cache.set('navigation', `path-${i}`, 'x'.repeat(40));
      }

      const stats = cache.getStats();
      expect(stats.totalBytes).toBeLessThanOrEqual(2000);
      expect(stats.totalEntries).toBeLessThan(100);
    });
  });

  describe('过期与清理', () => {
    // 注意：options 参与缓存键，所以不能把 ttl 当 options 传（那样 get 会因键不同而必然未命中）。
    // 生产代码也从不传 options.ttl，这里改用 cacheConfig 控制，与实际用法一致。
    test('TTL 过期后 get 返回 null 并移除条目', () => {
      cache.cacheConfig.thumbnail.ttl = -1000;
      cache.set('thumbnail', 'a', 'url-a');

      expect(cache.get('thumbnail', 'a')).toBeNull();
      expect(cache.getStats().types.thumbnail.count).toBe(0);
    });

    test('cleanup 清理所有类型的过期条目', () => {
      cache.cacheConfig.thumbnail.ttl = -1000;
      cache.cacheConfig.navigation.ttl = -1000;
      cache.set('thumbnail', 'a', 'url-a');
      cache.set('navigation', 'b', {});

      cache.cacheConfig.thumbnail.ttl = 60000;
      cache.cacheConfig.navigation.ttl = 60000;
      cache.set('thumbnail', 'c', 'url-c');

      cache.cleanup();

      const stats = cache.getStats();
      expect(stats.types.thumbnail.count).toBe(1);
      expect(stats.types.navigation.count).toBe(0);
      expect(cache.get('thumbnail', 'c')).toBe('url-c');
    });
  });

  describe('删除与清空', () => {
    test('deleteEntry 只删指定坐标', () => {
      cache.set('thumbnail', 'a', 'url-a');
      cache.set('thumbnail', 'b', 'url-b');

      cache.deleteEntry('thumbnail', 'a');

      expect(cache.get('thumbnail', 'a')).toBeNull();
      expect(cache.get('thumbnail', 'b')).toBe('url-b');
    });

    test('clearType 只清指定类型', () => {
      cache.set('thumbnail', 'a', 'url-a');
      cache.set('navigation', 'b', {});

      cache.clearType('thumbnail');

      expect(cache.getStats().types.thumbnail.count).toBe(0);
      expect(cache.getStats().types.navigation.count).toBe(1);
    });

    test('clearAll 清空所有类型与字节计数', () => {
      cache.set('thumbnail', 'a', 'url-a');
      cache.set('navigation', 'b', {});

      cache.clearAll();

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(stats.requests.totalGets).toBe(0);
    });
  });

  describe('统计形状（SettingsPage 依赖的字段）', () => {
    test('getStats 暴露 SettingsPage 读取的字段', () => {
      cache.set('thumbnail', 'a', 'url-a');
      cache.get('thumbnail', 'a');
      cache.get('thumbnail', 'missing');

      const stats = cache.getStats();
      expect(stats).toEqual(
        expect.objectContaining({
          totalBytes: expect.any(Number),
          maxBytes: expect.any(Number),
          usage: expect.stringMatching(/%$/),
          totalEntries: expect.any(Number)
        })
      );
      expect(stats.requests).toEqual(
        expect.objectContaining({
          totalGets: 2,
          totalHits: 1,
          totalMisses: 1,
          hitRate: '50.00%'
        })
      );
      expect(stats.types.thumbnail).toEqual(
        expect.objectContaining({ count: 1, bytes: expect.any(Number), maxEntries: expect.any(Number) })
      );
    });
  });

  describe('预加载', () => {
    test('已有条目时跳过预加载', async () => {
      const invoke = jest.fn();
      window.electronAPI = { ...(window.electronAPI || {}), invoke };

      cache.set('navigation', '/photos', { success: true });
      await cache.prefetch('navigation', '/photos');

      expect(invoke).not.toHaveBeenCalled();
    });

    test('条目数已达上限时跳过预加载而不是淘汰已有条目', async () => {
      cache.cacheConfig.navigation.maxEntries = 1;
      const invoke = jest.fn().mockResolvedValue({ success: true });
      window.electronAPI = { ...(window.electronAPI || {}), invoke };

      cache.set('navigation', '/existing', { success: true });
      await cache.prefetch('navigation', '/new');

      expect(cache.getStats().types.navigation.count).toBe(1);
      expect(cache.get('navigation', '/existing')).toEqual({ success: true });
    });
  });

  describe('单例', () => {
    test('默认导出是可直接使用的单例', () => {
      imageCache.clearAll();
      imageCache.set('thumbnail', 'singleton', 'url');
      expect(imageCache.get('thumbnail', 'singleton')).toBe('url');
      imageCache.clearAll();
    });
  });
});
