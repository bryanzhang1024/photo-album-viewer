const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { attachFavoriteLocator } = require('../../common/favorite-locator');

function createFavoritesDigest(favorites) {
  return crypto.createHash('sha256').update(JSON.stringify(favorites)).digest('hex');
}

function normalizeDirectoryIdentity(name) {
  return name.normalize('NFC').replace(/(weibo@|XHS@)(\d{4})-(\d{2})-(\d{2})/i, '$1$2$3$4');
}

function addToIndex(index, key, value) {
  const values = index.get(key) || [];
  values.push(value);
  index.set(key, values);
}

function scanMediaRoots(scanRoots, fsApi) {
  const directoriesByBasename = new Map();
  const directoriesByIdentity = new Map();
  const filesByBasename = new Map();

  for (const root of scanRoots) {
    if (!fsApi.existsSync(root)) {
      throw new Error(`扫描目录不存在: ${root}`);
    }

    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      const entries = fsApi.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          addToIndex(directoriesByBasename, entry.name, entryPath);
          addToIndex(
            directoriesByIdentity,
            normalizeDirectoryIdentity(entry.name),
            entryPath
          );
          stack.push(entryPath);
        } else if (entry.isFile()) {
          addToIndex(filesByBasename, entry.name, {
            path: entryPath,
            size: fsApi.statSync(entryPath).size
          });
        }
      }
    }
  }

  return { directoriesByBasename, directoriesByIdentity, filesByBasename };
}

function createDirectoryResolver(index) {
  const cache = new Map();
  const resolving = new Set();

  const resolve = (oldPath) => {
    if (!oldPath) return null;
    if (cache.has(oldPath)) return cache.get(oldPath);
    if (resolving.has(oldPath)) return null;
    resolving.add(oldPath);

    const name = path.basename(oldPath);
    const exactCandidates = index.directoriesByBasename.get(name) || [];
    let result = null;

    if (exactCandidates.length === 1) {
      result = { newPath: exactCandidates[0], reason: 'directoryName' };
    } else if (exactCandidates.length > 1) {
      const parentPath = path.dirname(oldPath);
      const parent = parentPath === oldPath ? null : resolve(parentPath);
      if (parent) {
        const underParent = exactCandidates.filter((candidate) => (
          path.dirname(candidate) === parent.newPath
        ));
        if (underParent.length === 1) {
          result = { newPath: underParent[0], reason: 'parentPath' };
        }
      }
    } else {
      const normalizedCandidates = index.directoriesByIdentity.get(
        normalizeDirectoryIdentity(name)
      ) || [];
      if (normalizedCandidates.length === 1) {
        result = { newPath: normalizedCandidates[0], reason: 'normalizedParentDate' };
      }
    }

    resolving.delete(oldPath);
    cache.set(oldPath, result);
    return result;
  };

  return resolve;
}

function createLocatedChange(collection, item, newPath, reason, sources) {
  const located = attachFavoriteLocator({ path: newPath }, sources);
  if (!located.sourceId || typeof located.relativePath !== 'string') return null;

  return {
    collection,
    id: item.id,
    oldPath: item.path,
    newPath,
    reason,
    sourceId: located.sourceId,
    relativePath: located.relativePath
  };
}

function createReconciliationPlan({ favorites, sources, scanRoots, fsApi = fs }) {
  if (!favorites || !Array.isArray(sources) || !Array.isArray(scanRoots)) {
    throw new TypeError('favorites, sources and scanRoots are required');
  }

  const index = scanMediaRoots(scanRoots, fsApi);
  const resolveDirectory = createDirectoryResolver(index);
  const changes = [];
  const unresolved = [];
  const albumResolutions = new Map();

  for (const album of favorites.albums || []) {
    if (!album?.path || fsApi.existsSync(album.path)) continue;
    const resolution = resolveDirectory(album.path);
    if (!resolution) {
      unresolved.push({
        collection: 'albums',
        id: album.id,
        oldPath: album.path,
        reason: 'notFound'
      });
      continue;
    }

    albumResolutions.set(album.path, resolution);
    const change = createLocatedChange(
      'albums',
      album,
      resolution.newPath,
      resolution.reason,
      sources
    );
    if (change) changes.push(change);
  }

  const resolveAlbumPath = (oldAlbumPath) => {
    if (!oldAlbumPath) return null;
    if (albumResolutions.has(oldAlbumPath)) return albumResolutions.get(oldAlbumPath);
    const resolution = resolveDirectory(oldAlbumPath);
    if (resolution) albumResolutions.set(oldAlbumPath, resolution);
    return resolution;
  };

  for (const image of favorites.images || []) {
    if (!image?.path || fsApi.existsSync(image.path)) continue;

    const name = path.basename(image.path);
    const albumResolution = resolveAlbumPath(image.albumPath);
    let selectedPath = null;
    let reason = null;

    if (albumResolution && image.albumPath) {
      const relativePath = path.relative(image.albumPath, image.path);
      const relativeCandidate = path.join(albumResolution.newPath, relativePath);
      if (!relativePath.startsWith('..') && fsApi.existsSync(relativeCandidate)) {
        selectedPath = relativeCandidate;
        reason = albumResolution.reason === 'normalizedParentDate'
          ? 'normalizedParentDate'
          : 'albumRelativePath';
      }
    }

    let candidates = index.filesByBasename.get(name) || [];
    if (!selectedPath && albumResolution) {
      const inAlbum = candidates.filter((candidate) => (
        candidate.path.startsWith(`${albumResolution.newPath}${path.sep}`)
      ));
      if (inAlbum.length === 1) {
        selectedPath = inAlbum[0].path;
        reason = albumResolution.reason === 'normalizedParentDate'
          ? 'normalizedParentDate'
          : 'albumFilename';
      }
    }

    const expectedSize = Number.isFinite(image.size) && image.size > 0 ? image.size : null;
    if (!selectedPath && expectedSize !== null) {
      const sizeMatches = candidates.filter((candidate) => candidate.size === expectedSize);
      if (sizeMatches.length === 1) {
        selectedPath = sizeMatches[0].path;
        reason = 'filenameAndSize';
      }
      if (sizeMatches.length > 0) candidates = sizeMatches;
    }

    if (!selectedPath && candidates.length === 1) {
      selectedPath = candidates[0].path;
      reason = 'filenameUnique';
    }

    if (!selectedPath) {
      unresolved.push({
        collection: 'images',
        id: image.id,
        oldPath: image.path,
        reason: candidates.length > 0 ? 'ambiguous' : 'notFound'
      });
      continue;
    }

    const change = createLocatedChange(
      'images',
      image,
      selectedPath,
      reason,
      sources
    );
    if (change) changes.push(change);
  }

  return {
    sourceDigest: createFavoritesDigest(favorites),
    summary: {
      albumsResolved: changes.filter((change) => change.collection === 'albums').length,
      imagesResolved: changes.filter((change) => change.collection === 'images').length,
      unresolved: unresolved.length
    },
    changes,
    unresolved
  };
}

function formatBackupTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function applyReconciliationPlan({
  favoritesPath,
  plan,
  backupRoot,
  fsApi = fs,
  now = () => new Date()
}) {
  const original = fsApi.readFileSync(favoritesPath, 'utf8');
  const favorites = JSON.parse(original);
  if (createFavoritesDigest(favorites) !== plan.sourceDigest) {
    throw new Error('收藏数据已变化，请重新生成重连计划');
  }

  for (const change of plan.changes) {
    if (!fsApi.existsSync(change.newPath)) {
      throw new Error(`重连目标已不存在: ${change.newPath}`);
    }
  }

  const currentTime = now();
  const backupDir = path.join(
    backupRoot,
    `${formatBackupTimestamp(currentTime)}-reconcile-favorites`
  );
  const backupPath = path.join(backupDir, 'favorites.json');
  fsApi.mkdirSync(backupDir, { recursive: true });
  fsApi.writeFileSync(backupPath, original, 'utf8');

  const manifest = {
    created_by: 'codex',
    created_at: currentTime.toISOString(),
    task: 'reconcile-favorites',
    cleanup_policy: 'retain_for_manual_recovery',
    items: [{
      original_path: favoritesPath,
      backup_path: backupPath,
      reason: 'Backup before favorites path reconciliation',
      original_sha256: crypto.createHash('sha256').update(original).digest('hex'),
      cleanup_allowed: false
    }]
  };
  fsApi.writeFileSync(
    path.join(backupDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  const changesByIdentity = new Map(plan.changes.map((change) => [
    `${change.collection}:${change.id}:${change.oldPath}`,
    change
  ]));
  const updated = { ...favorites };
  for (const collection of ['albums', 'images']) {
    updated[collection] = (favorites[collection] || []).map((item) => {
      const change = changesByIdentity.get(`${collection}:${item.id}:${item.path}`);
      if (!change) return item;
      return {
        ...item,
        path: change.newPath,
        sourceId: change.sourceId,
        relativePath: change.relativePath
      };
    });
  }
  updated.version = (favorites.version || 1) + 1;
  updated.lastModified = currentTime.getTime();

  const temporaryPath = `${favoritesPath}.${process.pid}.${Date.now()}.tmp`;
  fsApi.writeFileSync(temporaryPath, JSON.stringify(updated, null, 2), 'utf8');
  fsApi.renameSync(temporaryPath, favoritesPath);

  const verified = JSON.parse(fsApi.readFileSync(favoritesPath, 'utf8'));
  if ((verified.albums || []).length !== (favorites.albums || []).length
      || (verified.images || []).length !== (favorites.images || []).length) {
    throw new Error('收藏写入后数量校验失败');
  }

  return { backupDir, backupPath, summary: plan.summary };
}

module.exports = {
  applyReconciliationPlan,
  createFavoritesDigest,
  createReconciliationPlan,
  normalizeDirectoryIdentity
};
