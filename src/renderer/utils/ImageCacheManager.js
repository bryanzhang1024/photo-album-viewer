/**
 * 统一的图片缓存管理器
 *
 * 设计原则:
 * - 每个缓存类型一张 Map，利用 Map 的插入序实现 O(1) 的 LRU
 * - 双重上限：全局内存预算 + 每类型条目数
 * - 过期按类型 TTL 惰性判断，另有 cleanup 主动清理
 *
 * 为什么必须同时有条目数上限：缩略图缓存里存的是 URL 字符串，estimateSize
 * 估出约 100 字节，100MB 的字节预算几乎永远不会触达淘汰，于是队列随浏览
 * 无限增长。旧实现每次 get/set 还对整个数组做 filter，单次成本随条目数
 * 线性上升（实测 5 万条目时 0.69ms/次），而 ImageCard 每次渲染要查 4–5 次。
 * 这就是「越用越慢」的来源。
 */
class ImageCacheManager {
    constructor() {
        // type -> Map<key, item>，Map 的插入序即 LRU 序（队首最旧）
        this.maps = new Map();
        this.insertSeq = 0;

        this.maxMemoryBytes = 100 * 1024 * 1024; // 全局上限 100MB
        this.currentMemoryBytes = 0;
        this.diskCacheDir = null; // 磁盘缓存目录，由主进程设置

        // maxEntries 是硬上限，防止「字节预算永不触达」导致的无界增长
        this.cacheConfig = {
            thumbnail: { ttl: 24 * 60 * 60 * 1000, maxEntries: 20000 }, // 24小时
            preview: { ttl: 2 * 60 * 60 * 1000, maxEntries: 500 },      // 2小时
            navigation: { ttl: 60 * 60 * 1000, maxEntries: 500 },       // 1小时
            directory: { ttl: 5 * 60 * 1000, maxEntries: 500 },         // 5分钟
            album: { ttl: 15 * 60 * 1000, maxEntries: 300 },            // 15分钟
            albums: { ttl: 30 * 60 * 1000, maxEntries: 200 }            // 30分钟
        };

        for (const type of Object.keys(this.cacheConfig)) {
            this.maps.set(type, new Map());
        }

        this.requestMetrics = {
            totalGets: 0,
            totalHits: 0,
            totalMisses: 0,
            byType: {}
        };
    }

    getTypeMetrics(type) {
        if (!this.requestMetrics.byType[type]) {
            this.requestMetrics.byType[type] = {
                gets: 0,
                hits: 0,
                misses: 0
            };
        }
        return this.requestMetrics.byType[type];
    }

    recordGet(type, isHit) {
        this.requestMetrics.totalGets += 1;
        const typeMetrics = this.getTypeMetrics(type);
        typeMetrics.gets += 1;

        if (isHit) {
            this.requestMetrics.totalHits += 1;
            typeMetrics.hits += 1;
        } else {
            this.requestMetrics.totalMisses += 1;
            typeMetrics.misses += 1;
        }
    }

    /**
     * 估算数据大小(字节)
     * 简单但有效的估算方法
     */
    estimateSize(data) {
        if (!data) return 0;
        if (typeof data === 'string') {
            // 字符串: 每个字符约2字节(UTF-16)
            return data.length * 2;
        }
        if (typeof data === 'object') {
            // 对象: JSON字符串长度作为估算
            try {
                return JSON.stringify(data).length * 2;
            } catch (e) {
                return 1024; // 默认1KB
            }
        }
        return 100; // 其他类型默认100字节
    }

    /**
     * 生成缓存键 - 简单的哈希
     */
    generateCacheKey(type, identifier, options = {}) {
        const keyData = `${type}:${identifier}:${JSON.stringify(options)}`;
        // 简单的哈希函数，避免引入整个crypto库
        let hash = 0;
        for (let i = 0; i < keyData.length; i++) {
            const char = keyData.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return `img_${Math.abs(hash)}`;
    }

    /**
     * 把条目移到所属 Map 的队尾（最近使用）。
     * O(1)：Map 保序，删除再插入即完成重新排序。
     */
    touch(map, key, item) {
        map.delete(key);
        item.accessTime = Date.now();
        item.seq = ++this.insertSeq;
        map.set(key, item);
    }

    /**
     * 设置缓存项
     */
    set(type, identifier, data, options = {}) {
        const config = this.cacheConfig[type];
        const map = this.maps.get(type);
        if (!config || !map) {
            console.warn(`Unknown cache type: ${type}`);
            return;
        }

        const key = this.generateCacheKey(type, identifier, options);
        const ttl = options.ttl || config.ttl;
        const dataSize = this.estimateSize(data);

        // 覆盖已有条目：先摘掉再插入，保证位置在队尾且字节数不重复累加
        const existing = map.get(key);
        if (existing) {
            this.currentMemoryBytes -= existing.size || 0;
            map.delete(key);
        }

        const cacheItem = {
            data,
            size: dataSize,
            expiry: Date.now() + ttl,
            type,
            accessTime: Date.now(),
            seq: ++this.insertSeq
        };

        map.set(key, cacheItem);
        this.currentMemoryBytes += dataSize;

        this.enforceLimits(type);

        // 如果是缩略图类型，同时保存到磁盘缓存
        if (type === 'thumbnail' && this.diskCacheDir) {
            this.saveToDiskCache(key, data, options);
        }
    }

    /**
     * 双重上限：先按本类型条目数封顶，再按全局字节预算兜底。
     * 条目数优先，避免 thumbnail 把 navigation 这类重建代价高的条目挤掉。
     */
    enforceLimits(type) {
        const config = this.cacheConfig[type];
        const map = this.maps.get(type);
        if (!config || !map) {
            return;
        }

        while (map.size > config.maxEntries) {
            if (!this.evictOldestOf(type)) {
                break;
            }
        }

        while (this.currentMemoryBytes > this.maxMemoryBytes && this.totalEntryCount() > 0) {
            if (!this.evictGlobalOldest()) {
                break;
            }
        }
    }

    /** 淘汰某类型最旧的条目（Map 队首） */
    evictOldestOf(type) {
        const map = this.maps.get(type);
        if (!map || map.size === 0) {
            return false;
        }
        const oldestKey = map.keys().next().value;
        return this.removeFrom(type, oldestKey);
    }

    /** 跨类型淘汰全局最旧条目（类型数固定为 6，视作 O(1)） */
    evictGlobalOldest() {
        let oldestType = null;
        let oldestKey = null;
        let oldestSeq = Infinity;

        for (const [type, map] of this.maps) {
            const firstKey = map.keys().next().value;
            if (firstKey === undefined) {
                continue;
            }
            const item = map.get(firstKey);
            if (item && item.seq < oldestSeq) {
                oldestSeq = item.seq;
                oldestType = type;
                oldestKey = firstKey;
            }
        }

        if (oldestType === null) {
            return false;
        }
        return this.removeFrom(oldestType, oldestKey);
    }

    totalEntryCount() {
        let total = 0;
        for (const map of this.maps.values()) {
            total += map.size;
        }
        return total;
    }

    /** 从指定类型摘除条目并归还字节额度 */
    removeFrom(type, key) {
        const map = this.maps.get(type);
        if (!map) {
            return false;
        }
        const item = map.get(key);
        if (!item) {
            return false;
        }

        map.delete(key);
        this.currentMemoryBytes -= item.size || 0;
        if (this.currentMemoryBytes < 0) {
            this.currentMemoryBytes = 0;
        }
        return true;
    }

    /**
     * 保留旧的按键删除语义：在任意类型中查找并删除。
     * 新代码应优先用 deleteEntry(type, identifier)。
     */
    delete(key) {
        for (const type of this.maps.keys()) {
            if (this.removeFrom(type, key)) {
                return;
            }
        }
    }

    /**
     * 按公开缓存坐标删除缓存项。
     */
    deleteEntry(type, identifier, options = {}) {
        const key = this.generateCacheKey(type, identifier, options);
        return this.removeFrom(type, key);
    }

    /**
     * 获取缓存项
     */
    get(type, identifier, options = {}) {
        const map = this.maps.get(type);
        const key = this.generateCacheKey(type, identifier, options);

        if (!map) {
            this.recordGet(type, false);
            return null;
        }

        const item = map.get(key);
        if (!item) {
            this.recordGet(type, false);
            return null;
        }

        // 检查是否过期
        if (Date.now() > item.expiry) {
            this.removeFrom(type, key);
            this.recordGet(type, false);
            return null;
        }

        // 如果是预加载项，提升其优先级并恢复正常 TTL
        if (item.isPrefetch) {
            item.isPrefetch = false;
            item.expiry = Date.now() + this.cacheConfig[type].ttl;
        }

        this.touch(map, key, item);

        this.recordGet(type, true);
        return item.data;
    }

    /**
     * 清理过期缓存
     */
    cleanup() {
        const now = Date.now();
        for (const [type, map] of this.maps) {
            for (const [key, item] of Array.from(map.entries())) {
                if (now > item.expiry) {
                    this.removeFrom(type, key);
                }
            }
        }
    }

    /**
     * 获取缓存统计
     */
    getStats() {
        const hitRate = this.requestMetrics.totalGets > 0
            ? ((this.requestMetrics.totalHits / this.requestMetrics.totalGets) * 100).toFixed(2) + '%'
            : '0.00%';
        const requestByType = {};

        for (const [type, metrics] of Object.entries(this.requestMetrics.byType)) {
            requestByType[type] = {
                ...metrics,
                hitRate: metrics.gets > 0
                    ? ((metrics.hits / metrics.gets) * 100).toFixed(2) + '%'
                    : '0.00%'
            };
        }

        const stats = {
            totalBytes: this.currentMemoryBytes,
            maxBytes: this.maxMemoryBytes,
            usage: ((this.currentMemoryBytes / this.maxMemoryBytes) * 100).toFixed(2) + '%',
            totalEntries: this.totalEntryCount(),
            types: {},
            requests: {
                totalGets: this.requestMetrics.totalGets,
                totalHits: this.requestMetrics.totalHits,
                totalMisses: this.requestMetrics.totalMisses,
                hitRate,
                byType: requestByType
            }
        };

        for (const [type, map] of this.maps) {
            const config = this.cacheConfig[type];
            let bytes = 0;
            for (const item of map.values()) {
                bytes += item.size || 0;
            }
            stats.types[type] = {
                count: map.size,
                bytes,
                maxEntries: config ? config.maxEntries : null
            };
        }

        return stats;
    }

    /**
     * 清空指定类型的缓存
     */
    clearType(type) {
        const map = this.maps.get(type);
        if (!map) {
            return;
        }
        for (const key of Array.from(map.keys())) {
            this.removeFrom(type, key);
        }
    }

    /**
     * 清空所有缓存
     */
    clearAll() {
        for (const map of this.maps.values()) {
            map.clear();
        }
        this.currentMemoryBytes = 0;
        this.resetRequestMetrics();
    }

    resetRequestMetrics() {
        this.requestMetrics = {
            totalGets: 0,
            totalHits: 0,
            totalMisses: 0,
            byType: {}
        };
    }

    /**
     * 保存到磁盘缓存（主进程调用）
     */
    saveToDiskCache(key, data, options) {
        // 这里会通过IPC调用主进程保存到磁盘
        if (window.electronAPI) {
            window.electronAPI.saveToDiskCache({
                key,
                data,
                width: options.width,
                height: options.height,
                originalPath: options.originalPath
            });
        }
    }

    /**
     * 预加载缓存项 - 后台异步加载，不阻塞UI
     */
    async prefetch(type, identifier, options = {}) {
        const config = this.cacheConfig[type];
        const map = this.maps.get(type);
        if (!config || !map) {
            console.warn(`Unknown cache type for prefetch: ${type}`);
            return;
        }

        // 如果已经有缓存，跳过预加载
        const existingKey = this.generateCacheKey(type, identifier, options);
        if (map.has(existingKey)) {
            return;
        }

        // 预加载只针对navigation类型
        if (type === 'navigation' && window.electronAPI) {
            try {
                // 使用较低的优先级进行后台加载
                const response = await window.electronAPI.invoke('scan-navigation-level', identifier);
                if (response.success) {
                    // 使用较短的TTL进行预加载，避免占用过多缓存
                    const prefetchTTL = config.ttl * 0.5; // 预加载缓存时间减半
                    const dataSize = this.estimateSize(response);

                    // 预加载不触发淘汰，如果空间或条目数不足就跳过
                    if (this.currentMemoryBytes + dataSize <= this.maxMemoryBytes && map.size < config.maxEntries) {
                        const cacheItem = {
                            data: response,
                            size: dataSize,
                            expiry: Date.now() + prefetchTTL,
                            type,
                            accessTime: Date.now(),
                            seq: ++this.insertSeq,
                            isPrefetch: true // 标记为预加载
                        };

                        map.set(existingKey, cacheItem);
                        this.currentMemoryBytes += dataSize;
                        // 不移动 LRU 位置，预加载项优先级较低
                        console.log(`预加载完成: ${type}/${identifier}`);
                    } else {
                        console.log(`预加载跳过(空间不足): ${type}/${identifier}`);
                    }
                }
            } catch (error) {
                console.warn(`预加载失败: ${type}/${identifier}`, error);
                // 静默失败，不影响用户体验
            }
        }
    }
}

// 创建全局实例
const imageCache = new ImageCacheManager();

// 定期清理过期缓存
if (typeof window !== 'undefined') {
    setInterval(() => {
        imageCache.cleanup();
    }, 60000); // 每分钟清理一次
}

// 具名导出便于测试构造隔离实例；业务代码继续用默认导出的单例
export { ImageCacheManager };
export default imageCache;
