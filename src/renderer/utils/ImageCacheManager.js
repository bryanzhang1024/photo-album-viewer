/**
 * 统一的图片缓存管理器
 * Linus-style: 简单、高效、无特殊情况
 *
 * 设计原则:
 * - 按内存大小限制，而非数量限制
 * - LRU淘汰策略
 * - 自动过期清理
 */
class ImageCacheManager {
    constructor() {
        this.memoryCache = new Map();
        this.maxMemoryBytes = 100 * 1024 * 1024; // 最大100MB内存
        this.currentMemoryBytes = 0; // 当前使用的内存字节数
        this.diskCacheDir = null; // 磁盘缓存目录，由主进程设置

        // 缓存类型配置
        this.cacheConfig = {
            thumbnail: { ttl: 24 * 60 * 60 * 1000 },      // 24小时
            preview: { ttl: 2 * 60 * 60 * 1000 },         // 2小时
            navigation: { ttl: 60 * 60 * 1000 },          // 1小时
            directory: { ttl: 5 * 60 * 1000 },            // 5分钟
            album: { ttl: 15 * 60 * 1000 },               // 15分钟
            albums: { ttl: 30 * 60 * 1000 }               // 30分钟
        };

        // LRU队列
        this.lruQueue = [];
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
     * 设置缓存项
     */
    set(type, identifier, data, options = {}) {
        const config = this.cacheConfig[type];
        if (!config) {
            console.warn(`Unknown cache type: ${type}`);
            return;
        }

        const key = this.generateCacheKey(type, identifier, options);
        const ttl = options.ttl || config.ttl;
        const dataSize = this.estimateSize(data);

        // 按内存大小淘汰，而非数量
        while (this.currentMemoryBytes + dataSize > this.maxMemoryBytes && this.lruQueue.length > 0) {
            this.evictLRU();
        }

        const cacheItem = {
            data,
            size: dataSize,
            expiry: Date.now() + ttl,
            type,
            accessTime: Date.now()
        };

        this.memoryCache.set(key, cacheItem);
        this.currentMemoryBytes += dataSize;
        this.updateLRU(key);

        // 如果是缩略图类型，同时保存到磁盘缓存
        if (type === 'thumbnail' && this.diskCacheDir) {
            this.saveToDiskCache(key, data, options);
        }
    }

    /**
     * 删除缓存项
     */
    delete(key) {
        const item = this.memoryCache.get(key);
        if (item) {
            this.currentMemoryBytes -= item.size || 0;
        }
        this.memoryCache.delete(key);
        this.lruQueue = this.lruQueue.filter(k => k !== key);
    }

    /**
     * 更新LRU队列
     */
    updateLRU(key) {
        this.lruQueue = this.lruQueue.filter(k => k !== key);
        this.lruQueue.unshift(key);
    }

    /**
     * LRU淘汰
     */
    evictLRU() {
        if (this.lruQueue.length === 0) return;

        const lruKey = this.lruQueue.pop();
        this.delete(lruKey);
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
     * 清理过期缓存
     */
    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.memoryCache.entries()) {
            if (now > item.expiry) {
                this.delete(key);
            }
        }
    }

    /**
     * 获取缓存统计
     */
    getStats() {
        const stats = {
            totalBytes: this.currentMemoryBytes,
            maxBytes: this.maxMemoryBytes,
            usage: ((this.currentMemoryBytes / this.maxMemoryBytes) * 100).toFixed(2) + '%',
            types: {}
        };

        for (const [key, item] of this.memoryCache.entries()) {
            if (!stats.types[item.type]) {
                stats.types[item.type] = { count: 0, bytes: 0 };
            }
            stats.types[item.type].count++;
            stats.types[item.type].bytes += item.size || 0;
        }

        return stats;
    }

    /**
     * 清空指定类型的缓存
     */
    clearType(type) {
        for (const [key, item] of this.memoryCache.entries()) {
            if (item.type === type) {
                this.delete(key);
            }
        }
    }

    /**
     * 清空所有缓存
     */
    clearAll() {
        this.memoryCache.clear();
        this.lruQueue = [];
        this.currentMemoryBytes = 0;
    }

    /**
     * 预加载缓存项 - 后台异步加载，不阻塞UI
     */
    async prefetch(type, identifier, options = {}) {
        const config = this.cacheConfig[type];
        if (!config) {
            console.warn(`Unknown cache type for prefetch: ${type}`);
            return;
        }

        // 如果已经有缓存，跳过预加载
        const existingKey = this.generateCacheKey(type, identifier, options);
        if (this.memoryCache.has(existingKey)) {
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

                    // 预加载不触发淘汰，如果空间不足就跳过
                    if (this.currentMemoryBytes + dataSize <= this.maxMemoryBytes) {
                        const cacheItem = {
                            data: response,
                            size: dataSize,
                            expiry: Date.now() + prefetchTTL,
                            type,
                            accessTime: Date.now(),
                            isPrefetch: true // 标记为预加载
                        };

                        this.memoryCache.set(existingKey, cacheItem);
                        this.currentMemoryBytes += dataSize;
                        // 不更新LRU队列，预加载项优先级较低
                        console.log(`预加载完成: ${type}/${identifier}`);
                    } else {
                        console.log(`预加载跳过(内存不足): ${type}/${identifier}`);
                    }
                }
            } catch (error) {
                console.warn(`预加载失败: ${type}/${identifier}`, error);
                // 静默失败，不影响用户体验
            }
        }
    }

    /**
     * 获取缓存项 - 优化预加载项的处理
     */
    get(type, identifier, options = {}) {
        const key = this.generateCacheKey(type, identifier, options);
        const item = this.memoryCache.get(key);

        if (!item) return null;

        // 检查是否过期
        if (Date.now() > item.expiry) {
            this.delete(key);
            return null;
        }

        // 如果是预加载项，提升其优先级
        if (item.isPrefetch) {
            item.isPrefetch = false;
            item.expiry = Date.now() + this.cacheConfig[type].ttl; // 恢复正常TTL
            this.updateLRU(key); // 加入LRU队列
        } else {
            this.updateLRU(key);
        }

        return item.data;
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

export default imageCache;