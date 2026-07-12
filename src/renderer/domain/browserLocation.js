import {
  getPortableRelativePath,
  joinPortableRelativePath,
  resolvePortableRelativePath,
  splitPortableRelativePath
} from '../../common/path-codec';
import { createNavigationTargetFromAbsolutePath } from '../../common/navigation-target';
import {
  normalizeSourceIdV1,
  sourceIdsEqualV1,
  validateNavigationTargetV1
} from '../../common/contracts/navigation-contract-v1';

const hasExactFields = (value, fields) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => (
    Object.prototype.hasOwnProperty.call(value, field)
  ));
};

export const isBrowserLocation = (location) => {
  if (location?.kind === 'landing' || location?.kind === 'favorites') {
    return hasExactFields(location, ['kind']);
  }

  if (location?.kind === 'directory') {
    return hasExactFields(location, ['kind', 'target'])
      && validateNavigationTargetV1(location.target).valid;
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
    pageViewMode: location.target.viewMode === 'photoSet' ? 'album' : 'folder',
    absoluteInitialImage: location.target.initialMediaRelativePath === null
      ? null
      : resolvePortableRelativePath(
        sourceRoot.rootPath,
        location.target.initialMediaRelativePath
      )
  };
};

export const findComputerRootSource = (sources, platform) => {
  if (platform !== 'darwin' || !Array.isArray(sources)) return null;
  return sources.find((source) => source?.rootPath === '/') || null;
};

export const createDirectoryBrowserLocationFromAbsolutePath = ({
  sourceRoot,
  absolutePath,
  viewMode = 'browse',
  initialMediaAbsolutePath = null
}) => {
  const target = createNavigationTargetFromAbsolutePath(sourceRoot, {
    absolutePath,
    viewMode,
    initialMediaAbsolutePath
  });
  return target ? { kind: 'directory', target } : null;
};

export const rebaseBrowserLocationToSourceRoot = (location, sources, sourceRoot) => {
  if (location?.kind !== 'directory') return location;
  const materialized = materializeBrowserLocation(location, sources);
  if (!materialized) return null;

  return createDirectoryBrowserLocationFromAbsolutePath({
    sourceRoot,
    absolutePath: materialized.absolutePath,
    viewMode: location.target.viewMode,
    initialMediaAbsolutePath: materialized.absoluteInitialImage
  });
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
