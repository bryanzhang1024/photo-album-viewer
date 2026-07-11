import {
  isPortableRelativePath,
  joinPortableRelativePath,
  normalizeAbsolutePath,
  resolvePortableRelativePath,
  splitPortableRelativePath
} from '../../common/path-codec';
import {
  normalizeSourceIdV1,
  sourceIdsEqualV1,
  toLegacyViewMode,
  validateNavigationTargetV1
} from '../../common/contracts/navigation-contract-v1';

const hasExactFields = (value, fields) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => (
    Object.prototype.hasOwnProperty.call(value, field)
  ));
};

const isAbsolutePath = (value) => {
  try {
    normalizeAbsolutePath(value);
    return true;
  } catch (_error) {
    return false;
  }
};

export const isBrowserLocation = (location) => {
  if (location?.kind === 'landing' || location?.kind === 'favorites') {
    return hasExactFields(location, ['kind']);
  }

  if (location?.kind === 'directory') {
    return hasExactFields(location, ['kind', 'target'])
      && validateNavigationTargetV1(location.target).valid;
  }

  if (location?.kind === 'legacyAbsolute') {
    return hasExactFields(location, [
      'kind',
      'legacyAbsolutePath',
      'viewMode',
      'legacyInitialMediaPath'
    ])
      && isAbsolutePath(location.legacyAbsolutePath)
      && (location.viewMode === 'folder' || location.viewMode === 'album')
      && (location.legacyInitialMediaPath === null
        || (typeof location.legacyInitialMediaPath === 'string'
          && location.legacyInitialMediaPath.length > 0
          && (isAbsolutePath(location.legacyInitialMediaPath)
            || isPortableRelativePath(location.legacyInitialMediaPath))));
  }

  return false;
};

export const getBrowserLocationIdentity = (location) => {
  if (location.kind === 'directory') {
    const { target } = location;
    return JSON.stringify([
      'directory',
      normalizeSourceIdV1(target.sourceId),
      target.relativePath,
      target.viewMode,
      target.initialMediaRelativePath
    ]);
  }

  if (location.kind === 'legacyAbsolute') {
    return JSON.stringify([
      'legacyAbsolute',
      location.legacyAbsolutePath,
      location.viewMode,
      location.legacyInitialMediaPath
    ]);
  }

  return JSON.stringify([location.kind]);
};

export const materializeBrowserLocation = (location, sources) => {
  if (location?.kind !== 'directory' || !Array.isArray(sources)) return null;

  const sourceRoot = sources.find((source) => (
    sourceIdsEqualV1(source?.sourceId, location.target.sourceId)
  ));
  if (!sourceRoot) return null;

  return {
    location,
    sourceRoot,
    absolutePath: resolvePortableRelativePath(
      sourceRoot.rootPath,
      location.target.relativePath
    ),
    rootPath: sourceRoot.rootPath,
    legacyViewMode: toLegacyViewMode(location.target.viewMode),
    absoluteInitialImage: location.target.initialMediaRelativePath === null
      ? null
      : resolvePortableRelativePath(
        sourceRoot.rootPath,
        location.target.initialMediaRelativePath
      )
  };
};

export const createChildBrowserLocation = (location, childName) => {
  if (location?.kind !== 'directory') return location;

  return {
    kind: 'directory',
    target: {
      sourceId: location.target.sourceId,
      relativePath: joinPortableRelativePath(location.target.relativePath, childName),
      viewMode: 'browse',
      initialMediaRelativePath: null
    }
  };
};

const getLegacyParentPath = (absolutePath) => {
  const normalized = normalizeAbsolutePath(absolutePath).absolutePath;

  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) return normalized;

  if (normalized.startsWith('//')) {
    const segments = normalized.slice(2).split('/');
    return segments.length <= 2 ? normalized : `//${segments.slice(0, -1).join('/')}`;
  }

  const lastSeparator = normalized.lastIndexOf('/');
  if (lastSeparator === 0) return '/';
  if (lastSeparator === 2 && /^[A-Za-z]:/.test(normalized)) {
    return `${normalized.slice(0, 2)}/`;
  }
  return normalized.slice(0, lastSeparator);
};

export const getParentBrowserLocation = (location) => {
  if (location?.kind === 'directory') {
    const segments = splitPortableRelativePath(location.target.relativePath);
    if (segments.length === 0) return location;

    return {
      kind: 'directory',
      target: {
        sourceId: location.target.sourceId,
        relativePath: segments.slice(0, -1).join('/'),
        viewMode: 'browse',
        initialMediaRelativePath: null
      }
    };
  }

  if (location?.kind === 'legacyAbsolute') {
    const legacyAbsolutePath = getLegacyParentPath(location.legacyAbsolutePath);
    if (legacyAbsolutePath === location.legacyAbsolutePath
      && location.viewMode === 'folder'
      && location.legacyInitialMediaPath === null) {
      return location;
    }

    return {
      kind: 'legacyAbsolute',
      legacyAbsolutePath,
      viewMode: 'folder',
      legacyInitialMediaPath: null
    };
  }

  return location;
};

export const getSourceRootBreadcrumbs = (sourceRoot, relativePath) => {
  const breadcrumbs = [{ name: sourceRoot.label, path: sourceRoot.rootPath }];
  let accumulated = '';

  for (const segment of splitPortableRelativePath(relativePath)) {
    accumulated = joinPortableRelativePath(accumulated, segment);
    breadcrumbs.push({
      name: segment,
      path: resolvePortableRelativePath(sourceRoot.rootPath, accumulated)
    });
  }

  return breadcrumbs;
};
