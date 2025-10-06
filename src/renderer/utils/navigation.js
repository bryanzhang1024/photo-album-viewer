const LAST_PATH_KEY = 'lastPath';

export const normalizeTargetPath = (rawPath = '') => {
  if (!rawPath) return '';
  let normalized = rawPath.replace(/\\/g, '/');

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
