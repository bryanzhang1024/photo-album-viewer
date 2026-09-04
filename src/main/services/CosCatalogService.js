const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SUPPORTED_FORMATS } = require('./FileSystemService');

const MIXED_LOOK_ID = 'look:__mixed__';
const UNSPECIFIED_LOOK_ID = 'look:__unspecified__';
const UNKNOWN_COSER_ID = 'coser:__unknown__';
const SINGLETON_COSERS_ID = 'coser:__singletons__';
const DEFAULT_PAGE_SIZE = 100;
const INDEX_CONCURRENCY = 16;

const SPECIAL_LOOKS = new Map([
  [MIXED_LOOK_ID, '混合造型'],
  [UNSPECIFIED_LOOK_ID, '未细分']
]);

function naturalCompare(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
}

function makeEntityId(kind, name) {
  return `${kind}:${name}`;
}

function entityName(id, kind) {
  const prefix = `${kind}:`;
  return typeof id === 'string' && id.startsWith(prefix) ? id.slice(prefix.length) : null;
}

function makeMediaId(rootId, setRelativePath, fileName) {
  return `media:${crypto
    .createHash('sha1')
    .update(`${rootId}\0${setRelativePath}\0${fileName}`)
    .digest('hex')}`;
}

function paginate(items, options = {}) {
  const requestedOffset = Number(options.offset);
  const requestedLimit = Number(options.limit);
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.floor(requestedLimit))
    : DEFAULT_PAGE_SIZE;

  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    offset,
    limit
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

class CosCatalogService {
  constructor(options = {}) {
    this.fs = options.fs || fs.promises;
    this.supportedFormats = new Set(
      (options.supportedFormats || SUPPORTED_FORMATS).map((extension) => extension.toLowerCase())
    );
    this.reset();
  }

  reset() {
    this.sets = new Map();
    this.mediaPaths = new Map();
    this.errors = [];
    this.characterSets = new Map();
    this.coserSets = new Map();
    this.characterLookSets = new Map();
  }

  async buildIndex(roots, options = {}) {
    this.reset();
    const normalizedRoots = this.normalizeRoots(roots);
    const tasks = [];

    for (let rootIndex = 0; rootIndex < normalizedRoots.length; rootIndex += 1) {
      const root = normalizedRoots[rootIndex];
      try {
        const entries = await this.fs.readdir(root.path, { withFileTypes: true });
        entries
          .filter((entry) => entry.isDirectory())
          .sort((left, right) => naturalCompare(left.name, right.name))
          .forEach((entry) => tasks.push({ root, rootIndex, folderName: entry.name }));
      } catch (error) {
        this.errors.push(this.makeError(root.id, '', error));
      }
    }

    let processed = 0;
    const parsed = await mapWithConcurrency(tasks, options.concurrency || INDEX_CONCURRENCY, async (task) => {
      const result = await this.parseSetDirectory(task);
      processed += 1;
      if (typeof options.onProgress === 'function') {
        options.onProgress({ processed, total: tasks.length, rootId: task.root.id });
      }
      return result;
    });

    parsed.filter(Boolean).forEach((record) => this.ingestRecord(record));

    return {
      setCount: this.sets.size,
      characterCount: this.characterSets.size,
      coserCount: this.coserSets.size - (this.coserSets.has(UNKNOWN_COSER_ID) ? 1 : 0),
      coserCategoryCount: this.coserSets.size,
      lookCount: this.countDistinctLooks(),
      imageCount: [...this.sets.values()].reduce((total, record) => total + record.imageCount, 0),
      errorCount: this.errors.length
    };
  }

  normalizeRoots(roots) {
    if (!Array.isArray(roots)) return [];
    const seen = new Set();
    return roots.map((root, index) => {
      if (!root || typeof root.path !== 'string' || !path.isAbsolute(root.path)) {
        throw new TypeError(`Cos library root ${index + 1} must have an absolute path`);
      }
      const id = typeof root.id === 'string' && root.id.trim() ? root.id.trim() : `root-${index + 1}`;
      if (seen.has(id)) throw new TypeError(`Duplicate Cos library root id: ${id}`);
      seen.add(id);
      return {
        id,
        path: path.resolve(root.path),
        label: typeof root.label === 'string' && root.label.trim() ? root.label.trim() : path.basename(root.path)
      };
    });
  }

  async parseSetDirectory({ root, folderName }) {
    const setPath = path.join(root.path, folderName);
    const metadataPath = path.join(setPath, 'cosset.json');

    try {
      const [rawMetadata, entries] = await Promise.all([
        this.fs.readFile(metadataPath, 'utf8'),
        this.fs.readdir(setPath, { withFileTypes: true })
      ]);
      const metadata = JSON.parse(rawMetadata);
      if (!metadata || metadata.schema !== 'cosset/1' || typeof metadata.id !== 'string' || !metadata.id.trim()) {
        throw new Error('Invalid cosset/1 metadata');
      }

      const relativePath = folderName;
      const media = entries
        .filter((entry) => entry.isFile() && this.supportedFormats.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => ({
          id: makeMediaId(root.id, relativePath, entry.name),
          name: entry.name,
          rootId: root.id,
          relativePath: path.join(relativePath, entry.name),
          absolutePath: path.join(setPath, entry.name)
        }))
        .sort((left, right) => naturalCompare(left.name, right.name));

      return {
        id: metadata.id.trim(),
        displayName: typeof metadata.display_name === 'string' && metadata.display_name.trim()
          ? metadata.display_name.trim()
          : folderName,
        cosers: uniqueStrings(metadata.cosers),
        characters: uniqueStrings(metadata.characters),
        looks: uniqueStrings(metadata.looks),
        works: uniqueStrings(metadata.works),
        themes: uniqueStrings(metadata.themes),
        type: typeof metadata.type === 'string' ? metadata.type : '',
        locations: [{ rootId: root.id, relativePath, status: 'online' }],
        imageCount: media.length,
        coverMediaId: media[0]?.id || null,
        status: 'online',
        media
      };
    } catch (error) {
      this.errors.push(this.makeError(root.id, folderName, error));
      return null;
    }
  }

  makeError(rootId, relativePath, error) {
    return {
      rootId,
      relativePath,
      code: error?.code || 'INVALID_METADATA',
      message: error?.message || String(error)
    };
  }

  ingestRecord(record) {
    const existing = this.sets.get(record.id);
    if (existing) {
      existing.locations.push(...record.locations);
      if (existing.media.length === 0 && record.media.length > 0) {
        existing.media = record.media;
        existing.imageCount = record.imageCount;
        existing.coverMediaId = record.coverMediaId;
        record.media.forEach((item) => this.mediaPaths.set(item.id, item.absolutePath));
      }
      return;
    }

    record.searchText = [
      record.displayName,
      ...record.cosers,
      ...record.characters,
      ...record.looks,
      ...record.works,
      ...record.themes,
      record.type
    ].join('\n').toLocaleLowerCase();
    this.sets.set(record.id, record);
    record.media.forEach((item) => this.mediaPaths.set(item.id, item.absolutePath));
    this.addRecordToIndexes(record);
  }

  addRecordToIndexes(record) {
    record.characters.forEach((character) => {
      this.addToSetMap(this.characterSets, character, record.id);
      const lookMap = this.ensureMap(this.characterLookSets, character);
      this.lookIdsForRecord(record).forEach((lookId) => this.addToSetMap(lookMap, lookId, record.id));
    });

    const cosers = record.cosers.length > 0 ? record.cosers : [UNKNOWN_COSER_ID];
    cosers.forEach((coser) => this.addToSetMap(this.coserSets, coser, record.id));
  }

  lookIdsForRecord(record) {
    if (record.looks.length === 0) return [UNSPECIFIED_LOOK_ID];
    if (record.characters.length > 1 && record.looks.length > 1) return [MIXED_LOOK_ID];
    return record.looks.map((look) => makeEntityId('look', look));
  }

  addToSetMap(map, key, setId) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(setId);
  }

  ensureMap(map, key) {
    if (!map.has(key)) map.set(key, new Map());
    return map.get(key);
  }

  countDistinctLooks() {
    const looks = new Set();
    this.sets.forEach((record) => record.looks.forEach((look) => looks.add(look)));
    return looks.size;
  }

  exportSnapshot() {
    return {
      version: 2,
      sets: [...this.sets.values()].map((record) => {
        const firstMedia = record.media[0];
        return {
          ...this.toSetDto(record),
          media: firstMedia ? {
            rootId: firstMedia.rootId,
            directory: path.dirname(firstMedia.relativePath),
            names: record.media.map((item) => item.name)
          } : null
        };
      }),
      errors: this.getErrors()
    };
  }

  importSnapshot(snapshot, roots = []) {
    if (!snapshot || ![1, 2].includes(snapshot.version) || !Array.isArray(snapshot.sets)) {
      throw new TypeError('Unsupported Cos catalog snapshot');
    }

    this.reset();
    const rootMap = new Map(roots.map((root) => [root.id, root]));
    this.errors = Array.isArray(snapshot.errors)
      ? snapshot.errors.map((error) => ({ ...error }))
      : [];

    snapshot.sets.forEach((cached) => {
      const locations = Array.isArray(cached.locations)
        ? cached.locations.map((location) => ({
          rootId: location.rootId,
          relativePath: location.relativePath,
          status: rootMap.get(location.rootId)?.status === 'online' ? 'online' : 'offline'
        }))
        : [];
      const cachedMedia = Array.isArray(cached.media)
        ? cached.media
        : cached.media && Array.isArray(cached.media.names)
          ? cached.media.names.map((name) => ({
            id: makeMediaId(cached.media.rootId, cached.media.directory, name),
            name,
            rootId: cached.media.rootId,
            relativePath: path.join(cached.media.directory, name)
          }))
          : [];
      const media = cachedMedia.map((item) => {
        const root = rootMap.get(item.rootId);
        const absolutePath = root?.status === 'online' && typeof root.path === 'string'
          ? path.join(root.path, item.relativePath)
          : null;
        return { ...item, absolutePath };
      });
      const record = {
        id: cached.id,
        displayName: cached.displayName,
        cosers: uniqueStrings(cached.cosers),
        characters: uniqueStrings(cached.characters),
        looks: uniqueStrings(cached.looks),
        works: uniqueStrings(cached.works),
        themes: uniqueStrings(cached.themes),
        type: typeof cached.type === 'string' ? cached.type : '',
        locations,
        imageCount: Number.isFinite(cached.imageCount) ? cached.imageCount : media.length,
        coverMediaId: cached.coverMediaId || media[0]?.id || null,
        status: locations.some((location) => location.status === 'online') ? 'online' : 'offline',
        media
      };
      this.ingestRecord(record);
      media.forEach((item) => {
        if (item.absolutePath) this.mediaPaths.set(item.id, item.absolutePath);
      });
    });

    return {
      setCount: this.sets.size,
      errorCount: this.errors.length
    };
  }

  listCharacters(options = {}) {
    const items = [...this.characterSets.entries()]
      .map(([name, setIds]) => this.makeEntityCard('character', name, setIds))
      .filter((item) => this.matchesEntityQuery(item, options.query))
      .sort((left, right) => naturalCompare(left.name, right.name));
    return paginate(items, options);
  }

  listCosers(options = {}) {
    const query = typeof options.query === 'string' ? options.query.trim() : '';
    const shouldGroupSingletons = options.groupSingletons === true && !query;
    const singletonEntries = shouldGroupSingletons
      ? [...this.coserSets.entries()].filter(([key, setIds]) => (
        key !== UNKNOWN_COSER_ID && setIds.size === 1
      ))
      : [];
    const singletonSetIds = new Set();
    singletonEntries.forEach(([, setIds]) => {
      setIds.forEach((setId) => singletonSetIds.add(setId));
    });

    const items = [...this.coserSets.entries()]
      .filter(([key, setIds]) => (
        !shouldGroupSingletons || key === UNKNOWN_COSER_ID || setIds.size > 1
      ))
      .map(([key, setIds]) => key === UNKNOWN_COSER_ID
        ? this.makeEntityCard('coser', '未知 Coser', setIds, UNKNOWN_COSER_ID)
        : this.makeEntityCard('coser', key, setIds))
      .concat(singletonSetIds.size > 0 ? [{
        id: SINGLETON_COSERS_ID,
        name: '其他',
        coserCount: singletonEntries.length,
        setCount: singletonSetIds.size,
        coverMediaId: this.firstCover(singletonSetIds)
      }] : [])
      .filter((item) => this.matchesEntityQuery(item, query))
      .sort((left, right) => {
        const rank = (item) => (
          item.id === UNKNOWN_COSER_ID ? 2 : item.id === SINGLETON_COSERS_ID ? 1 : 0
        );
        return rank(left) - rank(right) || naturalCompare(left.name, right.name);
      });
    return paginate(items, options);
  }

  listLooks(options = {}) {
    const character = entityName(options.characterId, 'character');
    const lookMap = character ? this.characterLookSets.get(character) : null;
    if (!lookMap) return paginate([], options);

    const items = [...lookMap.entries()]
      .map(([lookId, setIds]) => ({
        id: lookId,
        name: SPECIAL_LOOKS.get(lookId) || entityName(lookId, 'look') || lookId,
        setCount: setIds.size,
        coverMediaId: this.firstCover(setIds)
      }))
      .filter((item) => this.matchesEntityQuery(item, options.query))
      .sort((left, right) => {
        const leftRank = left.id === MIXED_LOOK_ID ? 0 : left.id === UNSPECIFIED_LOOK_ID ? 2 : 1;
        const rightRank = right.id === MIXED_LOOK_ID ? 0 : right.id === UNSPECIFIED_LOOK_ID ? 2 : 1;
        return leftRank - rightRank || naturalCompare(left.name, right.name);
      });
    return paginate(items, options);
  }

  listSets(options = {}) {
    let candidates = [...this.sets.values()];
    const character = entityName(options.characterId, 'character');
    const isSingletonGroup = options.coserId === SINGLETON_COSERS_ID;
    const coser = options.coserId === UNKNOWN_COSER_ID
      ? UNKNOWN_COSER_ID
      : entityName(options.coserId, 'coser');

    if (character) {
      const ids = this.characterSets.get(character) || new Set();
      candidates = candidates.filter((record) => ids.has(record.id));
    }
    if (options.lookId) {
      if (!character) return paginate([], options);
      const ids = this.characterLookSets.get(character)?.get(options.lookId) || new Set();
      candidates = candidates.filter((record) => ids.has(record.id));
    }
    if (isSingletonGroup) {
      const ids = new Set();
      this.coserSets.forEach((setIds, key) => {
        if (key !== UNKNOWN_COSER_ID && setIds.size === 1) {
          setIds.forEach((setId) => ids.add(setId));
        }
      });
      candidates = candidates.filter((record) => ids.has(record.id));
    } else if (coser) {
      const ids = this.coserSets.get(coser) || new Set();
      candidates = candidates.filter((record) => ids.has(record.id));
    }

    const query = typeof options.query === 'string' ? options.query.trim().toLocaleLowerCase() : '';
    const items = candidates
      .filter((record) => !query || record.searchText.includes(query))
      .sort((left, right) => naturalCompare(left.displayName, right.displayName))
      .map((record) => this.toSetDto(record));
    return paginate(items, options);
  }

  makeEntityCard(kind, name, setIds, explicitId = null) {
    return {
      id: explicitId || makeEntityId(kind, name),
      name,
      setCount: setIds.size,
      coverMediaId: this.firstCover(setIds)
    };
  }

  firstCover(setIds) {
    for (const setId of setIds) {
      const coverMediaId = this.sets.get(setId)?.coverMediaId;
      if (coverMediaId) return coverMediaId;
    }
    return null;
  }

  matchesEntityQuery(item, query) {
    if (typeof query !== 'string' || !query.trim()) return true;
    return item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }

  getSet(setId) {
    const record = this.sets.get(setId);
    return record ? this.toSetDto(record) : null;
  }

  toSetDto(record) {
    return {
      id: record.id,
      displayName: record.displayName,
      cosers: [...record.cosers],
      characters: [...record.characters],
      looks: [...record.looks],
      works: [...record.works],
      themes: [...record.themes],
      type: record.type,
      locations: record.locations.map((location) => ({ ...location })),
      imageCount: record.imageCount,
      coverMediaId: record.coverMediaId,
      status: record.status
    };
  }

  listSetMedia(setId, options = {}) {
    const record = this.sets.get(setId);
    if (!record) return paginate([], options);
    const items = record.media.map((item) => ({
      id: item.id,
      name: item.name,
      rootId: item.rootId,
      relativePath: item.relativePath
    }));
    return paginate(items, options);
  }

  resolveMediaPath(mediaId) {
    return this.mediaPaths.get(mediaId) || null;
  }

  getErrors() {
    return this.errors.map((error) => ({ ...error }));
  }
}

module.exports = {
  CosCatalogService,
  MIXED_LOOK_ID,
  UNSPECIFIED_LOOK_ID,
  UNKNOWN_COSER_ID,
  SINGLETON_COSERS_ID,
  DEFAULT_PAGE_SIZE
};
