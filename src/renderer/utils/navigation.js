import { validateNavigationTargetV1 } from '../../common/contracts/navigation-contract-v1';

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

export const buildNavigationTargetUrl = (target) => {
  if (!validateNavigationTargetV1(target).valid) {
    throw new TypeError('Invalid NavigationTarget');
  }

  const params = new URLSearchParams();
  params.set('sourceId', target.sourceId);
  params.set('relativePath', target.relativePath);
  params.set('view', target.viewMode);

  if (target.initialMediaRelativePath !== null) {
    params.set('image', target.initialMediaRelativePath);
  }

  return `/browse?${params.toString()}`;
};

export const parseBrowseLocation = (pathname, search = '') => {
  if (pathname === '/') return { kind: 'landing' };
  if (pathname === '/favorites') return { kind: 'favorites' };

  const params = new URLSearchParams(search);
  if (pathname === '/browse') {
    if (params.has('sourceId') && params.has('relativePath')) {
      const viewMode = params.has('view') ? params.get('view') : 'browse';
      if (viewMode !== 'browse' && viewMode !== 'photoSet') return null;

      const target = {
        sourceId: params.get('sourceId'),
        relativePath: params.get('relativePath'),
        viewMode,
        initialMediaRelativePath: params.has('image') ? params.get('image') : null
      };
      if (!validateNavigationTargetV1(target).valid) return null;

      return { kind: 'directory', target };
    }

    return { kind: 'landing' };
  }

  if (pathname.startsWith('/browse/')) return { kind: 'landing' };
  return null;
};
