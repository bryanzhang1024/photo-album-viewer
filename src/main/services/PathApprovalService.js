const fs = require('fs');
const path = require('path');

/**
 * 路径访问授权：维护「允许访问的根目录」白名单。
 *
 * 规则：
 *   - 所有放行判断都基于 realpath（解析符号链接后再比），避免用软链接绕过；
 *   - 目标必须等于某个根，或位于某个根之下；
 *   - 白名单为空时默认拒绝；只有用户主动选择目录（选目录、拖入）才允许登记新根；
 *   - 登记的是目录本身，不会因为目标不存在而放行。
 */
function createPathApprovalService({
  rootsFilePath,
  fsApi = fs.promises,
  logger = console,
  extraRoots = []
} = {}) {
  if (typeof rootsFilePath !== 'string' || rootsFilePath.length === 0) {
    throw new TypeError('rootsFilePath is required');
  }

  const roots = new Set();
  let loaded = false;
  let loadPromise = null;

  function normalize(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') return null;
    if (!path.isAbsolute(inputPath)) return null;
    return path.resolve(path.normalize(inputPath));
  }

  async function realpathOrNull(targetPath) {
    try {
      return await fsApi.realpath(targetPath);
    } catch (_error) {
      return null;
    }
  }

  async function persist() {
    try {
      await fsApi.mkdir(path.dirname(rootsFilePath), { recursive: true });
      await fsApi.writeFile(
        rootsFilePath,
        `${JSON.stringify({ roots: Array.from(roots) }, null, 2)}\n`,
        'utf8'
      );
    } catch (error) {
      logger.warn('[Security] 保存允许目录失败:', error?.message || error);
    }
  }

  async function load() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const content = await fsApi.readFile(rootsFilePath, 'utf8');
        const parsed = JSON.parse(content);
        let droppedRootEntries = false;
        for (const rootPath of Array.isArray(parsed?.roots) ? parsed.roots : []) {
          const normalized = normalize(rootPath);
          if (!normalized) continue;
          // 旧版本可能把整盘根 / 写进过白名单：读入时丢掉并回写清理
          if (isFilesystemRootPath(normalized)) {
            droppedRootEntries = true;
            continue;
          }
          roots.add(normalized);
        }
        if (droppedRootEntries) await persist();
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          logger.warn('[Security] 加载允许目录失败:', error?.message || error);
        }
      }
      // 仅测试环境注入：让 IPC 契约测试不必准备真实目录；生产不传这个参数
      for (const rootPath of extraRoots) {
        const normalized = normalize(rootPath);
        if (normalized) roots.add(normalized);
      }
      loaded = true;
    })();
    return loadPromise;
  }

  /** 登记一个根目录。传进来的是文件时取它所在目录。 */
  async function register(candidatePath, { persist: shouldPersist = true } = {}) {
    await load();
    const normalized = normalize(candidatePath);
    if (!normalized) return false;

    let stats;
    try {
      stats = await fsApi.stat(normalized);
    } catch (error) {
      logger.warn('[Security] 登记目录失败:', normalized, error?.message || error);
      return false;
    }

    const rootPath = stats.isDirectory() ? normalized : path.dirname(normalized);
    const realRoot = (await realpathOrNull(rootPath)) || rootPath;
    if (!roots.has(realRoot)) {
      roots.add(realRoot);
      logger.log(`[Security] 注册允许访问目录: ${realRoot}`);
      if (shouldPersist) await persist();
    }
    return true;
  }

  async function unregister(candidatePath) {
    await load();
    const normalized = normalize(candidatePath);
    if (!normalized) return false;
    const realRoot = (await realpathOrNull(normalized)) || normalized;
    const changed = roots.delete(realRoot) || roots.delete(normalized);
    if (changed) await persist();
    return changed;
  }

  async function isWithin(targetPath) {
    await load();
    const normalized = normalize(targetPath);
    if (!normalized) return false;
    // 目标不存在时退回词法比较：路径已 normalize，仍能挡住 .. 越界；
    // 存在的文件（真实访问场景）一律按 realpath 比较，软链接绕不过去。
    const realTarget = (await realpathOrNull(normalized)) || normalized;

    for (const root of roots) {
      const realRoot = (await realpathOrNull(root)) || root;
      // 根目录本身可能是 '/'，拼接时不能变成 '//'
      const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
      if (realTarget === realRoot || realTarget.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 读取类操作使用：路径必须在已授权根内。
   * bootstrapWhenEmpty 只允许「用户主动选择目录」的入口使用。
   */
  async function assert(targetPath, { bootstrapWhenEmpty = false } = {}) {
    await load();
    const normalized = normalize(targetPath);
    if (!normalized) return false;

    if (roots.size === 0) {
      if (!bootstrapWhenEmpty) return false;
      return register(normalized, { persist: true });
    }
    return isWithin(normalized);
  }

  function list() {
    return Array.from(roots);
  }

  function size() {
    return roots.size;
  }

  return { load, register, unregister, isWithin, assert, list, size };
}

function isFilesystemRootPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return false;
  if (!path.isAbsolute(inputPath)) return false;
  const normalized = path.resolve(path.normalize(inputPath));
  return normalized === path.parse(normalized).root;
}

module.exports = { createPathApprovalService, isFilesystemRootPath };
