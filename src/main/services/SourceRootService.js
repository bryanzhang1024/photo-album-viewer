const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  NAVIGATION_CONTRACT_VERSION,
  SOURCE_ROOT_SCHEMA_VERSION,
  validateNavigationTargetV1,
  validateSaveSourceRootRequestV1,
  validateSourceRootV1
} = require('../../common/contracts/navigation-contract-v1');
const {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  normalizeAbsolutePath,
  resolvePortableRelativePath
} = require('../../common/path-codec');

const MAX_UUID_ATTEMPTS = 32;
let temporaryFileSequence = 0;

function createServiceError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', { value: cause });
  }
  return error;
}

function cloneSource(source) {
  return {
    schemaVersion: source.schemaVersion,
    sourceId: source.sourceId,
    label: source.label,
    rootPath: source.rootPath,
    sourceGeneration: source.sourceGeneration
  };
}

function cloneSources(sources) {
  return sources.map(cloneSource);
}

function cloneNavigationTarget(target) {
  return {
    sourceId: target.sourceId,
    relativePath: target.relativePath,
    viewMode: target.viewMode,
    initialMediaRelativePath: target.initialMediaRelativePath
  };
}

function areEquivalentRoots(left, right) {
  return getPortableRelativePath(left, right) === ''
    && getPortableRelativePath(right, left) === '';
}

function deriveLabel(rootPath) {
  if (rootPath === '/') return '/';
  if (/^[A-Za-z]:\/$/.test(rootPath)) return rootPath.slice(0, 2);
  const segments = rootPath.replace(/^\/\//, '').split('/');
  return segments[segments.length - 1];
}

function isPlainRecordWithExactFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length
    && keys.every((key) => typeof key === 'string' && fields.includes(key));
}

function validateRegistryDocument(document) {
  if (!isPlainRecordWithExactFields(document, ['schemaVersion', 'sources'])) return false;
  if (document.schemaVersion !== SOURCE_ROOT_SCHEMA_VERSION || !Array.isArray(document.sources)) {
    return false;
  }
  if (Reflect.ownKeys(document.sources).some((key) => (
    key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key)
      || Number(key) >= document.sources.length)
  ))) {
    return false;
  }
  if (Object.keys(document.sources).length !== document.sources.length) return false;

  const seenIds = new Set();
  const acceptedSources = [];
  for (const source of document.sources) {
    if (!validateSourceRootV1(source).valid) return false;
    const normalized = normalizeAbsolutePath(source.rootPath);
    if (normalized.absolutePath !== source.rootPath) return false;
    const foldedId = source.sourceId.toLowerCase();
    if (seenIds.has(foldedId)) return false;
    if (acceptedSources.some((candidate) => areEquivalentRoots(candidate.rootPath, source.rootPath))) {
      return false;
    }
    seenIds.add(foldedId);
    acceptedSources.push(source);
  }
  return true;
}

function makeTemporaryPath(registryPath) {
  temporaryFileSequence += 1;
  return `${registryPath}.${process.pid}.${Date.now()}.${temporaryFileSequence}.tmp`;
}

function createSourceRootService({
  registryPath,
  fsApi = fs.promises,
  randomUUID = () => crypto.randomUUID()
}) {
  if (typeof registryPath !== 'string' || registryPath.length === 0) {
    throw new TypeError('registryPath is required');
  }
  if (fsApi === null || typeof fsApi !== 'object') {
    throw new TypeError('fsApi is required');
  }
  if (typeof randomUUID !== 'function') {
    throw new TypeError('randomUUID must be a function');
  }

  let sources = [];
  let initialized = false;
  let initializationPromise = null;
  let corruptionError = null;
  let mutationTail = Promise.resolve();

  async function loadRegistry() {
    let serialized;
    try {
      serialized = await fsApi.readFile(registryPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        sources = [];
        return;
      }
      throw createServiceError(
        'SOURCE_ROOT_REGISTRY_READ_FAILED',
        'Failed to read the SourceRoot registry',
        error
      );
    }

    let document;
    try {
      document = JSON.parse(String(serialized));
    } catch (error) {
      throw createServiceError(
        'SOURCE_ROOT_REGISTRY_CORRUPT',
        'SourceRoot registry contains invalid JSON',
        error
      );
    }
    let valid = false;
    try {
      valid = validateRegistryDocument(document);
    } catch (_error) {
      valid = false;
    }
    if (!valid) {
      throw createServiceError(
        'SOURCE_ROOT_REGISTRY_CORRUPT',
        'SourceRoot registry has an unsupported or invalid schema'
      );
    }
    sources = cloneSources(document.sources);
  }

  function initialize() {
    if (initialized) return Promise.resolve();
    if (corruptionError) return Promise.reject(corruptionError);
    if (initializationPromise) return initializationPromise;

    initializationPromise = loadRegistry()
      .then(() => {
        initialized = true;
      })
      .catch((error) => {
        initializationPromise = null;
        if (error?.code === 'SOURCE_ROOT_REGISTRY_CORRUPT') {
          corruptionError = error;
        }
        throw error;
      });
    return initializationPromise;
  }

  async function requireReady() {
    if (corruptionError) throw corruptionError;
    await initialize();
    if (corruptionError) throw corruptionError;
  }

  function enqueueMutation(operation) {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.catch(() => undefined);
    return result;
  }

  async function persistSources(nextSources) {
    const temporaryPath = makeTemporaryPath(registryPath);
    const serialized = `${JSON.stringify({
      schemaVersion: SOURCE_ROOT_SCHEMA_VERSION,
      sources: nextSources
    }, null, 2)}\n`;

    try {
      await fsApi.mkdir(path.dirname(registryPath), { recursive: true });
      await fsApi.writeFile(temporaryPath, serialized, { encoding: 'utf8', flag: 'wx' });

      if (typeof fsApi.open === 'function') {
        let handle;
        try {
          handle = await fsApi.open(temporaryPath, 'r');
          if (typeof handle?.sync === 'function') await handle.sync();
        } finally {
          if (typeof handle?.close === 'function') await handle.close();
        }
      }

      await fsApi.rename(temporaryPath, registryPath);
    } catch (error) {
      if (typeof fsApi.unlink === 'function') {
        try {
          await fsApi.unlink(temporaryPath);
        } catch (_cleanupError) {
          // Preserve the persistence failure; the temp path is unique and never the formal registry.
        }
      }
      throw createServiceError(
        'SOURCE_ROOT_PERSIST_FAILED',
        'Failed to persist the SourceRoot registry atomically',
        error
      );
    }
  }

  async function ensureDirectory(rootPath) {
    let stats;
    try {
      stats = await fsApi.stat(rootPath);
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        throw createServiceError('SOURCE_ROOT_MISSING', 'Source root does not exist', error);
      }
      throw createServiceError('SOURCE_ROOT_UNAVAILABLE', 'Source root is unavailable', error);
    }
    if (!stats || typeof stats.isDirectory !== 'function' || !stats.isDirectory()) {
      throw createServiceError('SOURCE_ROOT_NOT_DIRECTORY', 'Source root is not a directory');
    }
  }

  function createUniqueSourceId() {
    const existingIds = new Set(sources.map((source) => source.sourceId.toLowerCase()));
    for (let attempt = 0; attempt < MAX_UUID_ATTEMPTS; attempt += 1) {
      const generated = randomUUID();
      const candidate = typeof generated === 'string' ? `src_${generated.toLowerCase()}` : '';
      if (validateSourceRootV1({
        schemaVersion: SOURCE_ROOT_SCHEMA_VERSION,
        sourceId: candidate,
        label: 'candidate',
        rootPath: '/',
        sourceGeneration: 1
      }).valid && !existingIds.has(candidate)) {
        return candidate;
      }
    }
    throw createServiceError(
      'SOURCE_ROOT_ID_UNAVAILABLE',
      'Could not generate a unique SourceRoot id'
    );
  }

  async function saveSourceRoot(input) {
    return enqueueMutation(async () => {
      await requireReady();
      const request = { contractVersion: NAVIGATION_CONTRACT_VERSION, ...input };
      if (!validateSaveSourceRootRequestV1(request).valid) {
        throw createServiceError(
          'INVALID_SOURCE_ROOT_REQUEST',
          'Invalid SourceRoot save request'
        );
      }

      const normalizedRoot = normalizeAbsolutePath(request.rootPath).absolutePath;
      await ensureDirectory(normalizedRoot);

      if (request.sourceId === null) {
        const existing = sources.find((source) => (
          areEquivalentRoots(source.rootPath, normalizedRoot)
        ));
        if (existing) return { source: cloneSource(existing), created: false };

        const source = {
          schemaVersion: SOURCE_ROOT_SCHEMA_VERSION,
          sourceId: createUniqueSourceId(),
          label: request.label ?? deriveLabel(normalizedRoot),
          rootPath: normalizedRoot,
          sourceGeneration: 1
        };
        const nextSources = [...sources, source];
        await persistSources(nextSources);
        sources = cloneSources(nextSources);
        return { source: cloneSource(source), created: true };
      }

      const sourceIndex = sources.findIndex((source) => (
        source.sourceId.toLowerCase() === request.sourceId.toLowerCase()
      ));
      if (sourceIndex < 0) {
        throw createServiceError('SOURCE_ROOT_NOT_FOUND', 'Source root is not registered');
      }
      const current = sources[sourceIndex];
      const conflict = sources.some((source, index) => (
        index !== sourceIndex && areEquivalentRoots(source.rootPath, normalizedRoot)
      ));
      if (conflict) {
        throw createServiceError(
          'SOURCE_ROOT_CONFLICT',
          'Another SourceRoot already owns this root path'
        );
      }

      const rootChanged = !areEquivalentRoots(current.rootPath, normalizedRoot);
      const nextLabel = request.label ?? current.label;
      const labelChanged = nextLabel !== current.label;
      if (!rootChanged && !labelChanged) {
        return { source: cloneSource(current), created: false };
      }
      if (rootChanged && current.sourceGeneration >= Number.MAX_SAFE_INTEGER) {
        throw createServiceError(
          'SOURCE_ROOT_GENERATION_EXHAUSTED',
          'Source generation cannot be incremented safely'
        );
      }

      const updated = {
        ...current,
        label: nextLabel,
        rootPath: rootChanged ? normalizedRoot : current.rootPath,
        sourceGeneration: rootChanged
          ? current.sourceGeneration + 1
          : current.sourceGeneration
      };
      const nextSources = sources.map((source, index) => (
        index === sourceIndex ? updated : source
      ));
      await persistSources(nextSources);
      sources = cloneSources(nextSources);
      return { source: cloneSource(updated), created: false };
    });
  }

  async function listSourceRoots() {
    await requireReady();
    return cloneSources(sources);
  }

  async function getSourceRoot(sourceId) {
    await requireReady();
    if (typeof sourceId !== 'string') return null;
    const source = sources.find((candidate) => (
      candidate.sourceId.toLowerCase() === sourceId.toLowerCase()
    ));
    return source ? cloneSource(source) : null;
  }

  async function resolveNavigationTarget(target) {
    await requireReady();
    if (!validateNavigationTargetV1(target).valid) {
      throw createServiceError('INVALID_NAVIGATION_TARGET', 'Invalid navigation target');
    }
    const source = sources.find((candidate) => (
      candidate.sourceId.toLowerCase() === target.sourceId.toLowerCase()
    ));
    if (!source) {
      throw createServiceError('SOURCE_ROOT_NOT_FOUND', 'Source root is not registered');
    }
    return {
      source: cloneSource(source),
      target: cloneNavigationTarget(target),
      absolutePath: resolvePortableRelativePath(source.rootPath, target.relativePath),
      initialMediaAbsolutePath: target.initialMediaRelativePath === null
        ? null
        : resolvePortableRelativePath(source.rootPath, target.initialMediaRelativePath)
    };
  }

  function matchLegacyAbsolutePath(absolutePath) {
    if (corruptionError) throw corruptionError;
    if (!initialized) {
      throw createServiceError(
        'SOURCE_ROOT_SERVICE_NOT_INITIALIZED',
        'SourceRoot service must be initialized before matching paths'
      );
    }
    const match = findUniqueLongestSourceRoot(sources, absolutePath);
    if (match.status === 'resolved') {
      return { ...match, source: cloneSource(match.source) };
    }
    if (match.status === 'ambiguous') {
      return { ...match, sources: cloneSources(match.sources) };
    }
    return match;
  }

  return {
    getSourceRoot,
    initialize,
    listSourceRoots,
    matchLegacyAbsolutePath,
    resolveNavigationTarget,
    saveSourceRoot
  };
}

module.exports = { createSourceRootService };
