const {
  getPortableRelativePath,
  resolvePortableRelativePath
} = require('./path-codec');

function createNavigationTargetFromAbsolutePath(sourceRoot, {
  absolutePath,
  viewMode = 'browse',
  initialMediaAbsolutePath = null
}) {
  if (!sourceRoot || !['browse', 'photoSet'].includes(viewMode)) return null;
  const relativePath = getPortableRelativePath(sourceRoot.rootPath, absolutePath);
  if (relativePath === null) return null;

  let initialMediaRelativePath = null;
  if (initialMediaAbsolutePath !== null) {
    const targetAbsolutePath = resolvePortableRelativePath(sourceRoot.rootPath, relativePath);
    if (getPortableRelativePath(targetAbsolutePath, initialMediaAbsolutePath) === null) {
      return null;
    }
    initialMediaRelativePath = getPortableRelativePath(
      sourceRoot.rootPath,
      initialMediaAbsolutePath
    );
  }

  return {
    sourceId: sourceRoot.sourceId,
    relativePath,
    viewMode,
    initialMediaRelativePath
  };
}

module.exports = { createNavigationTargetFromAbsolutePath };
