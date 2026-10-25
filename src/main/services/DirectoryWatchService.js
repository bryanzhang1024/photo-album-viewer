const fs = require('fs');

/**
 * 目录监听：一个窗口同一时间只监听一个文件夹（当前浏览的目录）。
 * 文件增删改名后合并成一次回调，避免连续事件让界面反复重扫。
 */
function createDirectoryWatchService({
  fsWatch = fs.watch,
  debounceMs = 400,
  logger = console
} = {}) {
  const watchers = new Map();

  function close(key) {
    const entry = watchers.get(key);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    try {
      entry.watcher.close();
    } catch (_error) {
      // 已经关闭时忽略
    }
    watchers.delete(key);
  }

  function watch(key, directoryPath, onChange) {
    close(key);
    try {
      const watcher = fsWatch(directoryPath, { persistent: false }, () => {
        const entry = watchers.get(key);
        if (!entry) return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          const current = watchers.get(key);
          if (!current) return;
          current.timer = null;
          try {
            onChange(directoryPath);
          } catch (error) {
            logger.warn('[Watch] 刷新回调失败:', error?.message || error);
          }
        }, debounceMs);
      });
      watcher.on?.('error', () => {
        logger.warn('[Watch] 目录监听出错，停止监听:', directoryPath);
        close(key);
      });
      watchers.set(key, { watcher, timer: null });
      return true;
    } catch (error) {
      logger.warn('[Watch] 无法监听目录:', directoryPath, error?.message || error);
      return false;
    }
  }

  function closeAll() {
    for (const key of Array.from(watchers.keys())) close(key);
  }

  return { watch, close, closeAll };
}

module.exports = { createDirectoryWatchService };
