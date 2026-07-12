const fs = require('fs');
const path = require('path');

const LEGACY_NAVIGATION_FILES = Object.freeze([
  'library-sources.json',
  'approved-roots.json'
]);

async function resetLegacyNavigationFiles(userDataPath, fsApi = fs.promises) {
  const removed = [];
  const failed = [];

  for (const fileName of LEGACY_NAVIGATION_FILES) {
    try {
      await fsApi.rm(path.join(userDataPath, fileName), { force: true });
      removed.push(fileName);
    } catch (error) {
      failed.push({ fileName, error });
    }
  }

  return { removed, failed };
}

module.exports = {
  LEGACY_NAVIGATION_FILES,
  resetLegacyNavigationFiles
};
