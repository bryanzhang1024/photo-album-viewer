const {
  findUniqueLongestSourceRoot,
  getPortableRelativePath,
  isPortableRelativePath,
  resolvePortableRelativePath
} = require('./path-codec');
const { sourceIdsEqualV1 } = require('./contracts/navigation-contract-v1');

const FAVORITE_COLLECTION_KEYS = ['folders', 'albums', 'images'];

function attachFavoriteLocator(item, sources) {
  if (!item || typeof item.path !== 'string') return item;

  const match = findUniqueLongestSourceRoot(sources, item.path);
  if (match.status !== 'resolved') return item;

  return {
    ...item,
    sourceId: match.source.sourceId,
    relativePath: match.relativePath
  };
}

function materializeFavoritePath(item, sources) {
  if (!item || typeof item.sourceId !== 'string'
      || !isPortableRelativePath(item.relativePath) || !Array.isArray(sources)) {
    return item;
  }

  const source = sources.find((candidate) => (
    sourceIdsEqualV1(candidate?.sourceId, item.sourceId)
  ));
  if (!source) return item;

  return {
    ...item,
    path: resolvePortableRelativePath(source.rootPath, item.relativePath)
  };
}

function collectAlbumPreviewPaths(album) {
  if (!album || typeof album !== 'object') return [];

  const candidates = [
    ...(Array.isArray(album.previewSamples) ? album.previewSamples : []),
    ...(Array.isArray(album.samples) ? album.samples : []),
    ...(Array.isArray(album.previewImages)
      ? album.previewImages.map((image) => (typeof image === 'string' ? image : image?.path))
      : []),
    album.previewImagePath
  ];

  return Array.from(new Set(candidates.filter((candidate) => (
    typeof candidate === 'string' && candidate.length > 0
  ))));
}

function attachAlbumPreviewLocators(album) {
  if (!album || typeof album.path !== 'string') return album;

  const relativePaths = collectAlbumPreviewPaths(album)
    .map((previewPath) => getPortableRelativePath(album.path, previewPath))
    .filter((relativePath) => relativePath !== null
      && relativePath !== ''
      && isPortableRelativePath(relativePath));

  if (relativePaths.length === 0) return album;
  return {
    ...album,
    previewRelativePaths: Array.from(new Set(relativePaths))
  };
}

function materializeAlbumPreviewPaths(album) {
  if (!album || typeof album.path !== 'string'
      || !Array.isArray(album.previewRelativePaths)) {
    return album;
  }

  const relativePaths = Array.from(new Set(album.previewRelativePaths.filter((relativePath) => (
    relativePath !== '' && isPortableRelativePath(relativePath)
  ))));
  if (relativePaths.length === 0) return album;

  const previewPaths = relativePaths.map((relativePath) => (
    resolvePortableRelativePath(album.path, relativePath)
  ));
  const existingPreviewImages = Array.isArray(album.previewImages) ? album.previewImages : [];

  return {
    ...album,
    previewRelativePaths: relativePaths,
    previewSamples: previewPaths,
    samples: previewPaths,
    previewImagePath: previewPaths[0],
    previewImages: previewPaths.map((previewPath, index) => ({
      ...(typeof existingPreviewImages[index] === 'object' ? existingPreviewImages[index] : {}),
      path: previewPath,
      name: previewPath.split('/').pop()
    }))
  };
}

function mapFavoriteCollections(data, mapper) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const mapped = { ...data };
  FAVORITE_COLLECTION_KEYS.forEach((key) => {
    if (Array.isArray(data[key])) {
      mapped[key] = data[key].map((item) => mapper(item, key));
    }
  });
  return mapped;
}

function attachFavoritesLocators(data, sources) {
  return mapFavoriteCollections(data, (item, collection) => {
    const located = attachFavoriteLocator(item, sources);
    return collection === 'albums' ? attachAlbumPreviewLocators(located) : located;
  });
}

function materializeFavoritesData(data, sources) {
  return mapFavoriteCollections(data, (item, collection) => {
    const materialized = materializeFavoritePath(item, sources);
    return collection === 'albums'
      ? materializeAlbumPreviewPaths(materialized)
      : materialized;
  });
}

module.exports = {
  attachFavoriteLocator,
  attachAlbumPreviewLocators,
  attachFavoritesLocators,
  collectAlbumPreviewPaths,
  materializeAlbumPreviewPaths,
  materializeFavoritePath,
  materializeFavoritesData
};
