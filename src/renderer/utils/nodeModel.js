export function getDirectImageCount(node) {
  if (!node) return 0;
  if (typeof node.directImageCount === 'number') return node.directImageCount;
  if (typeof node.imageCount === 'number') return node.imageCount;
  return 0;
}

export function getChildDirCount(node) {
  if (!node) return 0;
  return node.childFolders || 0;
}

export function canViewAsPhotoSet(node) {
  if (!node) return false;
  if (typeof node.canViewAsPhotoSet === 'boolean') return node.canViewAsPhotoSet;
  if (typeof node.canOpenAlbum === 'boolean') return node.canOpenAlbum;
  return getDirectImageCount(node) > 0;
}

export function canBrowseChildren(node) {
  if (!node) return false;
  if (typeof node.canBrowseChildren === 'boolean') return node.canBrowseChildren;
  return getChildDirCount(node) > 0;
}

export function getContentKind(node) {
  const hasPhotos = canViewAsPhotoSet(node);
  const hasChildren = canBrowseChildren(node);

  if (hasPhotos && hasChildren) return 'hybrid';
  if (hasPhotos) return 'photoSet';
  if (hasChildren) return 'container';
  return 'empty';
}

export function getPrimaryKind(node) {
  return canViewAsPhotoSet(node) ? 'album' : 'folder';
}

export function getPrimaryView(node) {
  return canViewAsPhotoSet(node) ? 'album' : 'folder';
}

export function buildNodeFromScanResponse(response) {
  if (!response) {
    return {
      directImageCount: 0,
      childFolders: 0,
      canViewAsPhotoSet: false,
      canBrowseChildren: false
    };
  }

  const directImageCount = response.directImages?.length || 0;
  const childFolders = response.nodes?.length || 0;

  return {
    directImageCount,
    childFolders,
    canViewAsPhotoSet: directImageCount > 0,
    canBrowseChildren: childFolders > 0
  };
}
