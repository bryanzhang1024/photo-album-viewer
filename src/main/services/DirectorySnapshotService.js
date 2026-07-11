const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { SUPPORTED_FORMATS } = require('./FileSystemService');
const {
  DIRECTORY_CONTRACT_VERSION,
  validateDirectoryLevelRequestV1,
  validateDirectorySnapshotV1
} = require('../../common/contracts/directory-contract-v1');
const {
  getRootPathFlavor,
  joinPortableRelativePath,
  splitPortableRelativePath
} = require('../../common/path-codec');

const ROOT_COMPLETENESS_FIELDS = ['entries', 'directMedia', 'children'];
const CHILD_COMPLETENESS_FIELDS = ['directMedia', 'children'];
const MISSING_ERROR_CODES = new Set(['ENOENT', 'ENOTDIR']);

function createScheduler(limit) {
  const max = Math.max(1, Math.min(8, Number(limit) || 5));
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < max && queue.length > 0) {
      const { task, resolve, reject } = queue.shift();
      active += 1;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active -= 1;
        drain();
      });
    }
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    drain();
  });
}

function naturalCompare(left, right) {
  const primary = left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
  if (primary !== 0) return primary;
  return left === right ? 0 : (left < right ? -1 : 1);
}

function createCodedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function mapDirectoryStatus(error) {
  return MISSING_ERROR_CODES.has(error?.code) ? 'missing' : 'unreadable';
}

function createUnavailableRootError(sourceError) {
  const error = new Error(sourceError?.message || 'Directory is unavailable');
  if (typeof sourceError?.code === 'string') error.code = sourceError.code;
  error.directoryStatus = mapDirectoryStatus(sourceError);
  return error;
}

function setCompletenessPartial(completeness, fields) {
  for (const field of fields) completeness[field] = 'partial';
}

function createApproximate(status, completeness, facts, coverSamples, observedAt) {
  const unavailable = status !== 'ready';
  const values = Object.values(completeness);
  const allComplete = values.every((value) => value === 'complete');
  const hasPartial = values.includes('partial');
  const hasPositiveEvidence = facts.directMediaCount > 0 || coverSamples.length > 0;

  let hasDescendantMedia = 'unknown';
  if (!unavailable && hasPositiveEvidence) {
    hasDescendantMedia = 'yes';
  } else if (!unavailable && allComplete
    && facts.directMediaCount === 0 && facts.childDirectoryCount === 0) {
    hasDescendantMedia = 'no';
  }

  return {
    coverSamples,
    hasDescendantMedia,
    observedAt,
    truncated: unavailable || hasPartial || facts.childDirectoryCount > 0
  };
}

function createMediaEntry(name, relativePath, stats) {
  if (!Number.isFinite(stats?.size) || stats.size < 0 || !Number.isFinite(stats?.mtimeMs)) {
    return null;
  }
  return {
    relativePath,
    name,
    size: stats.size,
    mtimeMs: stats.mtimeMs
  };
}

function createDirectorySnapshotService({
  fsApi = fs.promises,
  now = () => Date.now(),
  makeRevision = () => `snap_${crypto.randomUUID()}`,
  supportedFormats = SUPPORTED_FORMATS
} = {}) {
  const mediaExtensions = new Set(
    Array.from(supportedFormats, (extension) => String(extension).toLowerCase())
  );

  function resolveDirectoryLocatorV1(request) {
    const validation = validateDirectoryLevelRequestV1(request);
    if (!validation.valid) {
      throw createCodedError('INVALID_REQUEST', 'Invalid directory level request');
    }

    const pathFlavor = getRootPathFlavor(request.runtimeSource.rootPath);
    const pathApi = pathFlavor === 'win32' ? path.win32 : path.posix;
    const segments = splitPortableRelativePath(request.ref.relativePath);
    const resolvedRoot = pathApi.resolve(request.runtimeSource.rootPath);
    const resolvedTarget = pathApi.resolve(pathApi.join(resolvedRoot, ...segments));
    const relative = pathApi.relative(resolvedRoot, resolvedTarget);
    const outside = pathApi.isAbsolute(relative)
      || relative === '..'
      || relative.startsWith(`..${pathApi.sep}`);

    if (outside) {
      throw createCodedError('PATH_OUTSIDE_SOURCE', 'Directory path is outside its source');
    }

    return {
      ref: {
        sourceId: request.ref.sourceId,
        relativePath: request.ref.relativePath
      },
      absolutePath: resolvedTarget,
      name: pathApi.basename(resolvedTarget) || pathApi.parse(resolvedTarget).root,
      pathFlavor
    };
  }

  async function scanDirectorySnapshot(locator, options = {}) {
    const pathApi = locator.pathFlavor === 'win32' ? path.win32 : path.posix;
    const schedule = createScheduler(options.concurrencyLimit);
    const readDirectory = (target) => schedule(() => fsApi.readdir(target));
    const readStats = (target) => schedule(() => fsApi.stat(target));
    const observedAt = now();
    const revision = makeRevision();

    function isSupportedMedia(name) {
      return mediaExtensions.has(pathApi.extname(name).toLowerCase());
    }

    async function inspectEntry(parentAbsolutePath, parentRelativePath, name) {
      let relativePath;
      try {
        relativePath = joinPortableRelativePath(parentRelativePath, name);
      } catch (error) {
        if (error?.code === 'INVALID_RELATIVE_PATH') return { kind: 'skipped' };
        throw error;
      }

      const absolutePath = pathApi.join(parentAbsolutePath, name);
      let stats;
      try {
        stats = await readStats(absolutePath);
      } catch (_error) {
        return { kind: 'unknown' };
      }

      if (stats.isDirectory()) {
        return { kind: 'directory', name, relativePath, absolutePath };
      }
      if (!stats.isFile() || !isSupportedMedia(name)) {
        return { kind: 'other' };
      }

      const media = createMediaEntry(name, relativePath, stats);
      return media ? { kind: 'media', media } : { kind: 'unknown' };
    }

    async function scanChild(candidate) {
      const unavailableCompleteness = { directMedia: 'partial', children: 'partial' };
      let entryNames;
      try {
        entryNames = await readDirectory(candidate.absolutePath);
      } catch (error) {
        const status = mapDirectoryStatus(error);
        const facts = { directMediaCount: 0, childDirectoryCount: 0 };
        return {
          ref: { sourceId: locator.ref.sourceId, relativePath: candidate.relativePath },
          name: candidate.name,
          status,
          completeness: unavailableCompleteness,
          facts,
          approximate: createApproximate(
            status,
            unavailableCompleteness,
            facts,
            [],
            observedAt
          )
        };
      }

      const completeness = { directMedia: 'complete', children: 'complete' };
      const inspected = await Promise.all(entryNames.map(
        (name) => inspectEntry(candidate.absolutePath, candidate.relativePath, name)
      ));
      const directMedia = [];
      let childDirectoryCount = 0;
      for (const entry of inspected) {
        if (entry.kind === 'media') directMedia.push(entry.media);
        if (entry.kind === 'directory') childDirectoryCount += 1;
        if (entry.kind === 'skipped' || entry.kind === 'unknown') {
          setCompletenessPartial(completeness, CHILD_COMPLETENESS_FIELDS);
        }
      }
      directMedia.sort((left, right) => naturalCompare(left.relativePath, right.relativePath));
      const facts = {
        directMediaCount: directMedia.length,
        childDirectoryCount
      };
      const coverSamples = directMedia.slice(0, 4).map((media) => media.relativePath);

      return {
        ref: { sourceId: locator.ref.sourceId, relativePath: candidate.relativePath },
        name: candidate.name,
        status: 'ready',
        completeness,
        facts,
        approximate: createApproximate('ready', completeness, facts, coverSamples, observedAt)
      };
    }

    let entryNames;
    try {
      entryNames = await readDirectory(locator.absolutePath);
    } catch (error) {
      throw createUnavailableRootError(error);
    }

    const completeness = { entries: 'complete', directMedia: 'complete', children: 'complete' };
    const inspected = await Promise.all(entryNames.map(
      (name) => inspectEntry(locator.absolutePath, locator.ref.relativePath, name)
    ));
    const directMedia = [];
    const childCandidates = [];
    for (const entry of inspected) {
      if (entry.kind === 'media') directMedia.push(entry.media);
      if (entry.kind === 'directory') childCandidates.push(entry);
      if (entry.kind === 'skipped' || entry.kind === 'unknown') {
        setCompletenessPartial(completeness, ROOT_COMPLETENESS_FIELDS);
      }
    }

    directMedia.sort((left, right) => naturalCompare(left.relativePath, right.relativePath));
    const children = await Promise.all(childCandidates.map(scanChild));
    children.sort((left, right) => naturalCompare(left.name, right.name));
    const facts = {
      directMediaCount: directMedia.length,
      childDirectoryCount: children.length
    };
    const coverSamples = [...new Set([
      ...directMedia.map((media) => media.relativePath),
      ...children.flatMap((child) => child.approximate.coverSamples)
    ])].sort(naturalCompare).slice(0, 4);
    const snapshot = {
      contractVersion: DIRECTORY_CONTRACT_VERSION,
      ref: { sourceId: locator.ref.sourceId, relativePath: locator.ref.relativePath },
      locator: { absolutePath: locator.absolutePath },
      name: locator.name,
      status: 'ready',
      observedAt,
      revision,
      completeness,
      facts,
      directMedia,
      children,
      approximate: createApproximate('ready', completeness, facts, coverSamples, observedAt)
    };

    if (!validateDirectorySnapshotV1(snapshot).valid) {
      throw createCodedError('INVALID_RESPONSE', 'Invalid directory snapshot');
    }
    return snapshot;
  }

  return { resolveDirectoryLocatorV1, scanDirectorySnapshot };
}

const defaultService = createDirectorySnapshotService();

module.exports = {
  createDirectorySnapshotService,
  resolveDirectoryLocatorV1: defaultService.resolveDirectoryLocatorV1,
  scanDirectorySnapshot: defaultService.scanDirectorySnapshot
};
