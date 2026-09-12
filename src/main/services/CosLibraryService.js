const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FileSystemService = require('./FileSystemService');
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
    this.rootCatalogs = new Map();
    this.summary = { ...EMPTY_SUMMARY };
    this.lastIndexedAt = null;
    this.cached = false;
    this.initialized = false;
  }

  async initialize() {
    if (this.initializing) return this.initializing;
    if (this.initialized) return this.getStatus();
    this.initializing = this.initializeOnce();
    try { return await this.initializing; } finally { this.initializing = null; }
  }

  async initializeOnce() {
    const config = await readJson(this.fs, this.configPath).catch(() => null);
    this.roots = Array.isArray(config?.roots)
      ? config.roots
        .filter((root) => root && typeof root.id === 'string' && typeof root.path === 'string')
        .map((root) => ({ id: root.id, path: path.resolve(root.path), label: root.label || path.basename(root.path),
          kind: root.kind || (path.basename(root.path).startsWith('400') ? 'collections' : 'sets') }))
      : [];
    await this.updateRootStatuses();

    const cache = await readJson(this.fs, this.cachePath).catch(() => null);
    if (cache && [1, 2].includes(cache.version)) {
      try {
        if (cache.rootCatalogs) {
          this.rootCatalogs = new Map(Object.entries(cache.rootCatalogs));
        } else if (cache.catalog) {
          // Migrate old shared snapshots without assuming another location has the same files.
          for (const root of this.roots) {
            const sets = cache.catalog.sets.filter(r => r.locations.some(l => l.rootId === root.id)).map(r => ({
              ...r, locations: r.locations.filter(l => l.rootId === root.id),
              media: Array.isArray(r.media) ? r.media.filter(m => m.rootId === root.id)
                : r.media?.rootId === root.id ? r.media : null
            }));
            this.rootCatalogs.set(root.id, { ...cache.catalog, sets });
          }
          if (!await readJson(this.fs, `${this.cachePath}.pre-3.4.json`)) {
            await writeJsonAtomic(this.fs, `${this.cachePath}.pre-3.4.json`, cache, { pretty: false });
          }
        }
        this.rebuildCatalog();
        this.lastIndexedAt = cache.createdAt || null;
        this.cached = true;
      } catch (error) {
        this.rootCatalogs.clear();
        this.catalog.reset();
      }
    }
    this.initialized = true;
    if (this.roots.some(root => root.status === 'online')) await this.refresh();
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
      this.roots.push({ id, path: normalizedPath, label: path.basename(normalizedPath), status: 'online',
        kind: path.basename(normalizedPath).startsWith('400') ? 'collections' : 'sets' });
      await this.saveConfig();
    }
    await this.refresh(options);
    return this.getStatus();
  }

  async removeRoot(rootId) {
    this.roots = this.roots.filter((root) => root.id !== rootId);
    this.rootCatalogs.delete(rootId);
    this.rebuildCatalog();
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
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshOnce(options);
    try { return await this.refreshing; } finally { this.refreshing = null; }
  }

  async refreshOnce(options = {}) {
    await this.updateRootStatuses();
    let refreshed = 0;
    const failures = [];
    for (const root of this.roots) {
      if (root.status !== 'online') continue;
      const next = new CosCatalogService({ fs: this.fs });
      await next.buildIndex([root], options);
      const errors = next.getErrors();
      // An incomplete read cannot erase a previously usable root snapshot.
      if (errors.length && this.rootCatalogs.has(root.id)) {
        failures.push(...errors);
        root.refreshError = true;
        continue;
      }
      this.rootCatalogs.set(root.id, next.exportSnapshot());
      refreshed += 1;
    }
    this.rebuildCatalog();
    this.catalog.errors.push(...failures);
    this.summary = { ...EMPTY_SUMMARY, ...this.catalog.getSummary() };
    if (refreshed) this.lastIndexedAt = this.now();
    this.cached = this.rootCatalogs.size > 0;
    await this.saveCache();
    const partial = failures.length > 0 || this.roots.some(root => root.status !== 'online');
    return { ...this.getStatus(), ok: !partial, code: failures.length ? 'INDEX_READ_FAILED' : partial ? 'OFFLINE_ROOTS' : undefined, refreshedRoots: refreshed };
  }

  rebuildCatalog() {
    const next = new CosCatalogService({ fs: this.fs });
    // Prefer online locations; keep each root's independent media snapshot on disk.
    const ordered = [...this.roots].sort((a,b) => Number(b.status === 'online') - Number(a.status === 'online'));
    for (const root of ordered) {
      const snapshot = this.rootCatalogs.get(root.id);
      if (!snapshot) continue;
      const part = new CosCatalogService({ fs: this.fs });
      part.importSnapshot(snapshot, this.roots);
      for (const record of part.sets.values()) next.ingestRecord(record);
      next.errors.push(...part.getErrors());
    }
    this.catalog = next;
    this.summary = { ...EMPTY_SUMMARY, ...next.getSummary() };
  }

  async saveConfig() {
    await writeJsonAtomic(this.fs, this.configPath, {
      version: 1,
      roots: this.roots.map(({ id, path: rootPath, label, kind }) => ({ id, path: rootPath, label, kind }))
    });
  }

  async saveCache() {
    await writeJsonAtomic(this.fs, this.cachePath, {
      version: 2,
      rootCatalogs: Object.fromEntries(this.rootCatalogs),
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
      roots: this.roots.map(({ id, status, kind }, index) => ({ id, label: displayLabels[index], status, kind })),
      summary: { ...this.summary },
      lastIndexedAt: this.lastIndexedAt,
      cached: this.cached,
      facets: this.catalog.getFacets(),
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

  async resolveSetAlbumPath(setId) {
    const find = async () => {
      const record = this.catalog.getSet(setId);
      if (!record) return null;
      for (const location of record.locations) {
        const root = this.roots.find(r => r.id === location.rootId && r.status === 'online');
        if (!root) continue;
        const resolved = path.resolve(root.path, location.relativePath);
        if (!resolved.startsWith(`${root.path}${path.sep}`)) continue;
        try {
          const metadata = JSON.parse(await this.fs.readFile(path.join(resolved, 'cosset.json'), 'utf8'));
          if (metadata.id === setId) return resolved;
        } catch { /* stale path: retry after rebuilding current locations */ }
      }
      return null;
    };
    const current = await find();
    if (current) return current;
    await this.refresh();
    return find();
  }

  async getSetImagesPage(setId, options = {}) {
    if (options.forceRefresh) await this.refresh();
    const albumPath = await this.resolveSetAlbumPath(setId);
    if (!albumPath) return { success: false, images: [], totalCount: 0, error: '收藏所在目录不可用' };
    const record = this.catalog.sets.get(setId);
    if (!record.imageMetadata || options.forceRefresh) {
      record.imageMetadata = Promise.all(record.media.map(async item => {
        try {
          const stats = await this.fs.stat(item.absolutePath);
          return { path: item.absolutePath, name: item.name, size: stats.size, lastModified: stats.mtime };
        } catch {
          return { path: item.absolutePath, name: item.name, size: 0, lastModified: null, unavailable: true };
        }
      }));
    }
    return FileSystemService.getAlbumImagesPage(albumPath, options, await record.imageMetadata);
  }

}

module.exports = {
  CosLibraryService,
  EMPTY_SUMMARY,
  rootIdForPath
};
