const {
  findUniqueLongestSourceRoot,
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

function mapFavoriteCollections(data, mapper) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;

  const mapped = { ...data };
  FAVORITE_COLLECTION_KEYS.forEach((key) => {
    if (Array.isArray(data[key])) {
      mapped[key] = data[key].map(mapper);
    }
  });
  return mapped;
}

function attachFavoritesLocators(data, sources) {
  return mapFavoriteCollections(data, (item) => attachFavoriteLocator(item, sources));
}

function materializeFavoritesData(data, sources) {
  return mapFavoriteCollections(data, (item) => materializeFavoritePath(item, sources));
}

module.exports = {
  attachFavoriteLocator,
  attachFavoritesLocators,
  materializeFavoritePath,
  materializeFavoritesData
};
