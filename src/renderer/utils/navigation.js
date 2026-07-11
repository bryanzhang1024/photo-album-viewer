import {
  toCanonicalViewMode,
  toLegacyViewMode
} from '../../common/contracts/navigation-contract-v1';

const LAST_PATH_KEY = 'lastPath';

export const normalizeTargetPath = (rawPath = '') => {
  if (!rawPath) return '';
  let normalized = rawPath.replace(/\\/g, '/');

  if (/^[A-Za-z]:$/.test(normalized)) {
    return `${normalized}/`;
  }

  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized;
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  return normalized;
};

export const buildBrowseUrl = (targetPath, viewMode = 'folder', initialImage = null) => {
  const normalizedPath = normalizeTargetPath(targetPath);
  const basePath = normalizedPath ? `/browse/${encodeURIComponent(normalizedPath)}` : '/browse';
  const params = new URLSearchParams();

  if (viewMode && viewMode !== 'folder') {
    params.set('view', viewMode);
  }

  if (initialImage) {
    params.set('image', encodeURIComponent(initialImage));
  }

  const queryString = params.toString();
  return queryString ? `${basePath}?${queryString}` : basePath;
};

export const buildNavigationTargetUrl = (target) => {
  const params = new URLSearchParams();
  params.set('sourceId', target.sourceId);
  params.set('relativePath', target.relativePath);
  params.set('view', toLegacyViewMode(target.viewMode) || 'folder');

  if (target.initialMediaRelativePath !== null) {
    params.set('image', target.initialMediaRelativePath);
  }

  return `/browse?${params.toString()}`;
};

const safelyDecodeLegacyValue = (value) => {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
};

export const parseBrowseLocation = (pathname, search = '') => {
  if (pathname === '/') return { kind: 'landing' };
  if (pathname === '/favorites') return { kind: 'favorites' };

  const params = new URLSearchParams(search);
  if (pathname === '/browse') {
    if (params.has('sourceId') && params.has('relativePath')) {
      return {
        kind: 'directory',
        target: {
          sourceId: params.get('sourceId'),
          relativePath: params.get('relativePath'),
          viewMode: toCanonicalViewMode(params.get('view')) || 'browse',
          initialMediaRelativePath: params.has('image') ? params.get('image') : null
        }
      };
    }

    return { kind: 'landing' };
  }

  if (!pathname.startsWith('/browse/')) return null;

  const encodedAbsolutePath = pathname.slice('/browse/'.length);
  const legacyAbsolutePath = normalizeTargetPath(
    safelyDecodeLegacyValue(encodedAbsolutePath)
  );
  if (!legacyAbsolutePath) return { kind: 'landing' };

  const encodedInitialImage = params.get('image');
  return {
    kind: 'legacyAbsolute',
    legacyAbsolutePath,
    viewMode: params.get('view') === 'album' ? 'album' : 'folder',
    legacyInitialMediaPath: encodedInitialImage
      ? safelyDecodeLegacyValue(encodedInitialImage)
      : null
  };
};

export const navigateToBrowsePath = (
  navigate,
  targetPath,
  { viewMode = 'folder', initialImage = null, replace = false, state } = {}
) => {
  const url = buildBrowseUrl(targetPath, viewMode, initialImage);
  const options = {};

  if (replace) {
    options.replace = true;
  }

  if (state !== undefined) {
    options.state = state;
  }

  navigate(url, options);
};

export const getLastPath = () => localStorage.getItem(LAST_PATH_KEY) || '';

export const clearLastPath = () => localStorage.removeItem(LAST_PATH_KEY);

export const setLastPath = (path) => {
  const normalized = normalizeTargetPath(path);

  if (normalized) {
    localStorage.setItem(LAST_PATH_KEY, normalized);
  } else {
    clearLastPath();
  }
};

export const withLastPathTracking = (navigateFn) => {
  if (!navigateFn) {
    throw new Error('navigateFn is required');
  }

  return (
    targetPath,
    { viewMode = 'folder', initialImage = null, replace = false, state } = {}
  ) => {
    setLastPath(targetPath);

    navigateToBrowsePath(navigateFn, targetPath, {
      viewMode,
      initialImage,
      replace,
      state
    });
  };
};
