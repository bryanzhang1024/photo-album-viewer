/**
 * 「接着看」的数据：每个照片来源上一次打开的文件夹。
 *
 * 只存本地，不进主进程注册表：删掉来源、换机器都不影响图库本身。
 * 每个来源只留最近一条，总条数封顶，避免历史无限增长。
 */
const STORAGE_KEY = 'pav.recent-locations.v1';
const STORAGE_VERSION = 1;
const MAX_ENTRIES = 20;

function isValidEntry(entry) {
  return entry
    && typeof entry.sourceId === 'string'
    && entry.sourceId.length > 0
    && typeof entry.relativePath === 'string'
    && Number.isFinite(entry.at);
}

function readRaw() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.filter(isValidEntry);
  } catch (_error) {
    return [];
  }
}

function writeRaw(entries) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      entries
    }));
    return true;
  } catch (_error) {
    return false;
  }
}

/** 最近打开的位置，按时间倒序；同一来源只会出现一次（后写的覆盖先写的）。 */
export function listRecentLocations() {
  return readRaw().slice().sort((left, right) => right.at - left.at);
}

/**
 * 记录一次「打开了某个文件夹」。
 * relativePath 用 portable 写法（'/' 分隔），来源根是空字符串。
 */
export function recordLocation(sourceId, relativePath, at = Date.now()) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
  const normalizedPath = typeof relativePath === 'string' ? relativePath : '';
  if (!Number.isFinite(at)) return false;
  const rest = readRaw().filter((entry) => entry.sourceId !== sourceId);
  const next = [
    { sourceId, relativePath: normalizedPath, at },
    ...rest
  ]
    .sort((left, right) => right.at - left.at)
    .slice(0, MAX_ENTRIES);
  return writeRaw(next);
}

/** 记录失效时（文件夹被删、盘没挂）把它清掉，免得下次还画一张坏卡。 */
export function forgetLocation(sourceId) {
  if (typeof sourceId !== 'string' || sourceId.length === 0) return false;
  const rest = readRaw().filter((entry) => entry.sourceId !== sourceId);
  return writeRaw(rest);
}

export const RECENT_LOCATIONS_MAX = MAX_ENTRIES;
