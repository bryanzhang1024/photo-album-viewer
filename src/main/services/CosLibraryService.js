const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CosCatalogService } = require('./CosCatalogService');

const EMPTY_SUMMARY = Object.freeze({
  setCount: 0,
  characterCount: 0,
  coserCount: 0,
  coserCategoryCount: 0,
  lookCount: 0,
  imageCount: 0,
  errorCount: 0
});

async function readJson(fsApi, filePath) {
  try {
    return JSON.parse(await fsApi.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(fsApi, filePath, value, { pretty = true } = {}) {
  await fsApi.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fsApi.writeFile(temporaryPath, JSON.stringify(value, null, pretty ? 2 : 0), 'utf8');
  await fsApi.rename(temporaryPath, filePath);
}

function rootIdForPath(rootPath) {
  return `root:${crypto.createHash('sha1').update(rootPath).digest('hex')}`;
}

class CosLibraryService {
  constructor(options = {}) {
    if (!options.configPath || !options.cachePath) {
      throw new TypeError('CosLibraryService requires configPath and cachePath');
    }
    this.configPath = options.configPath;
    this.cachePath = options.cachePath;
    this.fs = options.fs || fs.promises;
    this.now = options.now || Date.now;
    this.catalog = options.catalog || new CosCatalogService({ fs: this.fs });
    this.roots = [];
    this.summary = { ...EMPTY_SUMMARY };
    this.lastIndexedAt = null;
    this.cached = false;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return this.getStatus();
    const config = await readJson(this.fs, this.configPath).catch(() => null);
    this.roots = Array.isArray(config?.roots)
      ? config.roots
        .filter((root) => root && typeof root.id === 'string' && typeof root.path === 'string')
        .map((root) => ({ id: root.id, path: path.resolve(root.path), label: root.label || path.basename(root.path) }))
      : [];
    await this.updateRootStatuses();

    const cache = await readJson(this.fs, this.cachePath).catch(() => null);
    if (cache?.version === 1 && cache.catalog) {
      try {
        this.catalog.importSnapshot(cache.catalog, this.roots);
        this.summary = { ...EMPTY_SUMMARY, ...(cache.summary || {}) };
        this.lastIndexedAt = cache.createdAt || null;
        this.cached = true;
      } catch (error) {
        this.catalog.reset();
      }
    }

    this.initialized = true;
    if (!this.cached && this.roots.length > 0 && this.roots.every((root) => root.status === 'online')) {
      await this.refresh();
    }
    return this.getStatus();
  }

  async updateRootStatuses() {
    await Promise.all(this.roots.map(async (root) => {
      try {
        const stats = await this.fs.stat(root.path);
        root.status = stats.isDirectory() ? 'online' : 'offline';
      } catch (error) {
        root.status = 'offline';
      }
    }));
  }

  async addRoot(rootPath, options = {}) {
    const normalizedPath = path.resolve(rootPath || '');
    if (!path.isAbsolute(rootPath || '')) throw new TypeError('Cos library root must be absolute');
    const stats = await this.fs.stat(normalizedPath);
    if (!stats.isDirectory()) throw new TypeError('Cos library root must be a directory');

    const id = rootIdForPath(normalizedPath);
    if (!this.roots.some((root) => root.id === id)) {
      this.roots.push({ id, path: normalizedPath, label: path.basename(normalizedPath), status: 'online' });
      await this.saveConfig();
    }
    await this.refresh(options);
    return this.getStatus();
  }

  async removeRoot(rootId) {
    this.roots = this.roots.filter((root) => root.id !== rootId);
    await this.saveConfig();
    if (this.roots.length === 0) {
      this.catalog.reset();
      this.summary = { ...EMPTY_SUMMARY };
      this.lastIndexedAt = null;
      this.cached = false;
      await this.saveCache();
      return this.getStatus();
    }
    await this.refresh();
    return this.getStatus();
  }

  async refresh(options = {}) {
    await this.updateRootStatuses();
    const offlineRoots = this.roots.filter((root) => root.status !== 'online');
    if (offlineRoots.length > 0) {
      return {
        ...this.getStatus(),
        ok: false,
        code: 'OFFLINE_ROOTS'
      };
    }
    if (this.roots.length === 0) {
      return { ...this.getStatus(), ok: true };
    }

    const summary = await this.catalog.buildIndex(
      this.roots.map(({ id, path: rootPath, label }) => ({ id, path: rootPath, label })),
      { onProgress: options.onProgress }
    );
    this.summary = { ...EMPTY_SUMMARY, ...summary };
    this.lastIndexedAt = this.now();
    this.cached = true;
    await this.saveCache();
    return { ...this.getStatus(), ok: true };
  }

  async saveConfig() {
    await writeJsonAtomic(this.fs, this.configPath, {
      version: 1,
      roots: this.roots.map(({ id, path: rootPath, label }) => ({ id, path: rootPath, label }))
    });
  }

  async saveCache() {
    await writeJsonAtomic(this.fs, this.cachePath, {
      version: 1,
      createdAt: this.lastIndexedAt,
      summary: this.summary,
      catalog: this.catalog.exportSnapshot()
    }, { pretty: false });
  }

  getStatus() {
    let state = 'ready';
    if (this.roots.length === 0) state = 'empty';
    else if (this.roots.some((root) => root.status !== 'online')) state = 'partial';

    const labelCounts = new Map();
    for (const root of this.roots) {
      labelCounts.set(root.label, (labelCounts.get(root.label) || 0) + 1);
    }
    const candidateLabels = this.roots.map((root) => (
      labelCounts.get(root.label) > 1
        ? `${root.label} · ${path.basename(path.dirname(root.path))}`
        : root.label
    ));
    const candidateCounts = new Map();
    for (const label of candidateLabels) {
      candidateCounts.set(label, (candidateCounts.get(label) || 0) + 1);
    }
    const candidateIndexes = new Map();
    const displayLabels = candidateLabels.map((label) => {
      if (candidateCounts.get(label) === 1) return label;
      const index = (candidateIndexes.get(label) || 0) + 1;
      candidateIndexes.set(label, index);
      return `${label} #${index}`;
    });

    return {
      state,
      roots: this.roots.map(({ id, status }, index) => ({ id, label: displayLabels[index], status })),
      summary: { ...this.summary },
      lastIndexedAt: this.lastIndexedAt,
      cached: this.cached,
      errors: this.catalog.getErrors()
    };
  }

  listCharacters(options) {
    return this.catalog.listCharacters(options);
  }

  listLooks(options) {
    return this.catalog.listLooks(options);
  }

  listCosers(options) {
    return this.catalog.listCosers(options);
  }

  listSets(options) {
    return this.catalog.listSets(options);
  }

  getSet(setId) {
    return this.catalog.getSet(setId);
  }

  listSetMedia(setId, options) {
    return this.catalog.listSetMedia(setId, options);
  }

  resolveMediaPath(mediaId) {
    return this.catalog.resolveMediaPath(mediaId);
  }

  resolveSetAlbumPath(setId) {
    const record = this.catalog.getSet(setId);
    if (!record) return null;
    for (const location of record.locations) {
      const root = this.roots.find((candidate) => candidate.id === location.rootId && candidate.status === 'online');
      if (!root) continue;
      const resolved = path.resolve(root.path, location.relativePath);
      if (resolved === root.path || resolved.startsWith(`${root.path}${path.sep}`)) return resolved;
    }
    return null;
  }
}

module.exports = {
  CosLibraryService,
  EMPTY_SUMMARY,
  rootIdForPath
};
