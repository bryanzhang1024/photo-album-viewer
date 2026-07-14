#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  applyReconciliationPlan,
  createReconciliationPlan
} = require('../src/main/services/FavoritesReconciliation');

const SCAN_ROOTS = [
  '/Volumes/Collection/300-Cosplayer',
  '/Volumes/1TB/Collection/400-Cos Album',
  '/Volumes/1TB/Collection/500-Cos专题',
  '/Volumes/1TB/Collection/600-Cos Weibo',
  '/Volumes/1TB/Collection/兴趣'
];

function createCommandConfig(argv, cwd = process.cwd(), homeDir = os.homedir()) {
  const userDataDir = path.join(homeDir, 'Library', 'Application Support', 'photo-album-viewer');
  return {
    apply: argv.includes('--apply'),
    favoritesPath: path.join(userDataDir, 'favorites.json'),
    sourcesPath: path.join(userDataDir, 'library-sources-v3.json'),
    backupRoot: path.join(cwd, '.codex', 'backups'),
    scanRoots: SCAN_ROOTS
  };
}

function run(argv = process.argv.slice(2)) {
  const config = createCommandConfig(argv);
  const favorites = JSON.parse(fs.readFileSync(config.favoritesPath, 'utf8'));
  const sourceRegistry = JSON.parse(fs.readFileSync(config.sourcesPath, 'utf8'));
  const plan = createReconciliationPlan({
    favorites,
    sources: sourceRegistry.sources,
    scanRoots: config.scanRoots
  });

  const output = {
    mode: config.apply ? 'apply' : 'dry-run',
    summary: plan.summary,
    unresolved: plan.unresolved,
    albumPreviewUnresolved: plan.albumPreviewUnresolved
  };

  if (config.apply) {
    const result = applyReconciliationPlan({
      favoritesPath: config.favoritesPath,
      plan,
      backupRoot: config.backupRoot
    });
    output.backupDir = result.backupDir;
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SCAN_ROOTS,
  createCommandConfig,
  run
};
