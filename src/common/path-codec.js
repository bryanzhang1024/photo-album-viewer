const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/;
const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:/;
const WINDOWS_UNC_ROOT = /^(?:\\\\|\/\/)[^\\/:]+[\\/][^\\/:]+(?:[\\/]|$)/;

function getRootPathFlavor(rootPath) {
  if (typeof rootPath !== 'string' || rootPath.length === 0 || rootPath.includes('\0')) {
    return null;
  }
  if (WINDOWS_DRIVE_ROOT.test(rootPath) || WINDOWS_UNC_ROOT.test(rootPath)) {
    return 'win32';
  }
  if (rootPath.startsWith('//')) {
    return null;
  }
  if (rootPath.startsWith('/')) {
    return 'posix';
  }
  return null;
}

function createPathError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSegments(segments) {
  const normalized = [];
  for (const segment of segments) {
    if (segment.length === 0) continue;
    if (segment === '.' || segment === '..') {
      throw createPathError('Invalid absolute path', 'INVALID_ABSOLUTE_PATH');
    }
    normalized.push(segment);
  }
  return normalized;
}

function normalizeAbsolutePath(value) {
  const pathFlavor = getRootPathFlavor(value);
  if (pathFlavor === null) {
    throw createPathError('Invalid absolute path', 'INVALID_ABSOLUTE_PATH');
  }

  const portable = value.replace(/\\/g, '/');
  if (pathFlavor === 'posix') {
    const segments = normalizeSegments(portable.slice(1).split('/'));
    return {
      absolutePath: segments.length === 0 ? '/' : `/${segments.join('/')}`,
      pathFlavor
    };
  }

  if (WINDOWS_DRIVE_ROOT.test(value)) {
    const drive = portable.slice(0, 2);
    const segments = normalizeSegments(portable.slice(3).split('/'));
    return {
      absolutePath: segments.length === 0 ? `${drive}/` : `${drive}/${segments.join('/')}`,
      pathFlavor
    };
  }

  const segments = normalizeSegments(portable.slice(2).split('/'));
  if (segments.length < 2) {
    throw createPathError('Invalid absolute path', 'INVALID_ABSOLUTE_PATH');
  }
  return { absolutePath: `//${segments.join('/')}`, pathFlavor };
}

function splitAbsolutePath(normalized) {
  if (normalized.pathFlavor === 'posix') {
    return normalized.absolutePath === '/' ? [] : normalized.absolutePath.slice(1).split('/');
  }
  if (WINDOWS_DRIVE_ROOT.test(normalized.absolutePath)) {
    const drive = normalized.absolutePath.slice(0, 2);
    const rest = normalized.absolutePath.slice(3);
    return rest ? [drive, ...rest.split('/')] : [drive];
  }
  return normalized.absolutePath.slice(2).split('/');
}

function getPortableRelativePath(rootPath, candidatePath) {
  let root;
  let candidate;
  try {
    root = normalizeAbsolutePath(rootPath);
    candidate = normalizeAbsolutePath(candidatePath);
  } catch (_error) {
    return null;
  }
  if (root.pathFlavor !== candidate.pathFlavor) return null;

  const rootSegments = splitAbsolutePath(root);
  const candidateSegments = splitAbsolutePath(candidate);
  if (candidateSegments.length < rootSegments.length) return null;
  const caseFold = root.pathFlavor === 'win32';
  const matches = rootSegments.every((segment, index) => {
    const candidateSegment = candidateSegments[index];
    return caseFold
      ? segment.toLocaleLowerCase('en-US') === candidateSegment.toLocaleLowerCase('en-US')
      : segment === candidateSegment;
  });
  return matches ? candidateSegments.slice(rootSegments.length).join('/') : null;
}

function resolvePortableRelativePath(rootPath, relativePath) {
  const normalized = normalizeAbsolutePath(rootPath);
  if (!isPortableRelativePath(relativePath)) {
    throw createPathError('Invalid portable relative path', 'INVALID_RELATIVE_PATH');
  }
  if (relativePath === '') return normalized.absolutePath;
  const separator = normalized.absolutePath.endsWith('/') ? '' : '/';
  return `${normalized.absolutePath}${separator}${relativePath}`;
}

function findUniqueLongestSourceRoot(sources, absolutePath) {
  if (!Array.isArray(sources)) return { status: 'notFound' };

  const matches = [];
  for (const source of sources) {
    if (source === null || typeof source !== 'object') continue;
    const relativePath = getPortableRelativePath(source.rootPath, absolutePath);
    if (relativePath === null) continue;
    let normalized;
    try {
      normalized = normalizeAbsolutePath(source.rootPath);
    } catch (_error) {
      continue;
    }
    matches.push({
      relativePath,
      segmentCount: splitAbsolutePath(normalized).length,
      source
    });
  }

  if (matches.length === 0) return { status: 'notFound' };
  const longest = Math.max(...matches.map((match) => match.segmentCount));
  const winners = matches.filter((match) => match.segmentCount === longest);
  if (winners.length > 1) {
    return {
      status: 'ambiguous',
      sources: winners.map((winner) => winner.source),
      relativePath: winners[0].relativePath
    };
  }
  return {
    status: 'resolved',
    source: winners[0].source,
    relativePath: winners[0].relativePath
  };
}

function isPortableRelativePath(value) {
  if (typeof value !== 'string' || value.includes('\0')) return false;
  if (value === '') return true;
  if (value.startsWith('/') || value.includes('\\')) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'
    && !WINDOWS_DRIVE_PREFIX.test(segment));
}

function splitPortableRelativePath(value) {
  if (!isPortableRelativePath(value)) {
    const error = new Error('Invalid portable relative path');
    error.code = 'INVALID_RELATIVE_PATH';
    throw error;
  }
  return value === '' ? [] : value.split('/');
}

function joinPortableRelativePath(parent, childName) {
  if (!isPortableRelativePath(parent) || typeof childName !== 'string'
      || childName.length === 0 || childName.includes('/') || childName.includes('\\')
      || childName === '.' || childName === '..' || childName.includes('\0')
      || WINDOWS_DRIVE_PREFIX.test(childName)) {
    const error = new Error('Invalid portable path segment');
    error.code = 'INVALID_RELATIVE_PATH';
    throw error;
  }
  return parent ? `${parent}/${childName}` : childName;
}

module.exports = {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  getRootPathFlavor,
  isPortableRelativePath,
  joinPortableRelativePath,
  normalizeAbsolutePath,
  resolvePortableRelativePath,
  splitPortableRelativePath
};
