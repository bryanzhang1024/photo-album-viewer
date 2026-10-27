/**
 * 「最近有变化」的纯函数部分：从每个来源根的目录快照里取候选、过滤、排序。
 * 放在独立模块里，是为了不用渲染页面就能测聚合规则。
 */

/** 只看最近 7 天。 */
export const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 列表最多几条。 */
export const FEED_LIMIT = 10;

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

/** 把来源根 + 相对路径拼成绝对路径，用来判断「这个子目录是不是另一个来源的根」。 */
export function absolutePathOf(rootPath, relativePath = '') {
  const base = trimTrailingSlash(rootPath);
  const relative = String(relativePath || '').replace(/^\/+/, '');
  return relative ? `${base}/${relative}` : base;
}

export function registeredRootPaths(sources = []) {
  return new Set((sources || []).map((source) => absolutePathOf(source?.rootPath, '')));
}

/**
 * 一个来源根的首层里，够格进「最近有变化」的子文件夹。
 *
 * 规则：有直接图片、7 天内改过、且不是另一个已注册来源的根（否则同一件事会出现两次）。
 */
export function buildSourceEntries(source, snapshot, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : RECENT_WINDOW_MS;
  const registeredPaths = options.registeredPaths instanceof Set ? options.registeredPaths : new Set();
  const children = Array.isArray(snapshot?.children) ? snapshot.children : [];
  const entries = [];

  children.forEach((child) => {
    const relativePath = child?.ref?.relativePath;
    if (typeof relativePath !== 'string') return;
    const imageCount = Number(child?.facts?.directMediaCount) || 0;
    if (imageCount <= 0) return;
    const mtimeMs = Number(child?.mtimeMs);
    if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return;
    if (now - mtimeMs > windowMs) return;
    if (registeredPaths.has(absolutePathOf(source?.rootPath, relativePath))) return;
    const coverSamples = Array.isArray(child?.approximate?.coverSamples)
      ? child.approximate.coverSamples
      : [];
    entries.push({
      key: `${source?.sourceId || ''}:${relativePath}`,
      sourceId: source?.sourceId || '',
      sourceLabel: source?.label || '',
      relativePath,
      name: child?.name || relativePath.split('/').pop(),
      imageCount,
      mtimeMs,
      cover: coverSamples[0] || ''
    });
  });

  return entries;
}

/** 把各来源的候选合成一个按修改时间倒序的列表。 */
export function mergeFeed(entriesBySource = {}, limit = FEED_LIMIT) {
  const all = [];
  Object.values(entriesBySource || {}).forEach((list) => {
    if (Array.isArray(list)) all.push(...list);
  });
  all.sort((left, right) => (
    right.mtimeMs - left.mtimeMs
    || String(left.name).localeCompare(String(right.name), 'zh-Hans-CN', { numeric: true })
  ));
  return Number.isFinite(limit) ? all.slice(0, limit) : all;
}

/** 今天（本地时区）改过几个。 */
export function countToday(entries = [], now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  return entries.filter((entry) => entry.mtimeMs >= startMs).length;
}

function startOfLocalDay(ms) {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 行尾时间：今天 09:12 / 昨天 / 10-26。 */
export function formatWhen(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(ms)) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) {
    const date = new Date(ms);
    return `今天 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  if (dayDiff === 1) return '昨天';
  const date = new Date(ms);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
