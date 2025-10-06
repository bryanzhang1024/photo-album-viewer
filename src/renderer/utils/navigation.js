export const normalizeTargetPath = (rawPath = '') => {
  if (!rawPath) return '';
  let normalized = rawPath.replace(/\\/g, '/');

  // Windows drive letters: keep "C:/" form intact
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized;
  }

  // POSIX paths: ensure leading slash
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
