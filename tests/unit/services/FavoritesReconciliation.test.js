/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const { createFsMock } = require('../../helpers/fsMock');
const {
  applyReconciliationPlan,
  createFavoritesDigest,
  createReconciliationPlan
} = require('../../../src/main/services/FavoritesReconciliation');
const {
  SCAN_ROOTS,
  createCommandConfig
} = require('../../../scripts/reconcile-favorites');

const SOURCE_ID = 'src_22222222-2222-4222-8222-222222222222';
const roots = ['/library'];
const sources = [{ sourceId: SOURCE_ID, rootPath: '/library', label: 'library' }];

function createFavorites() {
  return {
    folders: [],
    albums: [
      {
        id: 'album-unique',
        path: '/old/lunananya/set-037',
        name: 'set-037',
        previewImages: [{
          path: '/old/lunananya/set-037/cover.jpg',
          name: 'cover.jpg',
          size: 5
        }],
        previewImagePath: '/old/lunananya/set-037/cover.jpg',
        addedAt: 1
      },
      {
        id: 'album-child',
        path: '/old/Misswarm/set/02_Foot',
        name: '02_Foot',
        addedAt: 2
      },
      {
        id: 'album-empty',
        path: '/library/empty-album',
        name: 'empty-album',
        addedAt: 8
      }
    ],
    images: [
      {
        id: 'image-album',
        path: '/old/lunananya/set-037/cover.jpg',
        albumPath: '/old/lunananya/set-037',
        name: 'cover.jpg',
        size: 5,
        addedAt: 3
      },
      {
        id: 'image-size',
        path: '/old/elsewhere/shared.jpg',
        albumPath: '/old/elsewhere',
        name: 'shared.jpg',
        size: 7,
        addedAt: 4
      },
      {
        id: 'image-date',
        path: '/old/weibo@2025-04-27/post.jpg',
        albumPath: '/old/weibo@2025-04-27',
        name: 'post.jpg',
        addedAt: 5
      },
      {
        id: 'image-generic',
        path: '/old/015 - 可畏礼服/3.jpg',
        albumPath: '/old/015 - 可畏礼服',
        name: '3.jpg',
        addedAt: 6
      },
      {
        id: 'image-missing',
        path: '/old/missing/absent.jpg',
        albumPath: '/old/missing',
        name: 'absent.jpg',
        addedAt: 7
      }
    ],
    collections: [{ id: 'collection-1', items: ['image-album'] }],
    version: 9,
    lastModified: 100
  };
}

describe('FavoritesReconciliation', () => {
  let mockFs;

  beforeEach(() => {
    mockFs = createFsMock({
      '/library': {
        'empty-album': {},
        '500-Cos专题': {
          'set-037': { 'cover.jpg': '12345' },
          Misswarm: {
            set: {
              '02_Foot': { 'C (1).jpg': 'foot' }
            }
          },
          duplicate: {
            '02_Foot': { 'C (2).jpg': 'other' }
          },
          A: { 'shared.jpg': '1234' },
          B: { 'shared.jpg': '1234567' },
          '015 - 可畏礼服 renamed': { '3.jpg': 'first' },
          another: { '3.jpg': 'second' }
        },
        '600-Cos Weibo': {
          'weibo@20250427': { 'post.jpg': 'dated' },
          'weibo@20251003': { 'post.jpg': 'duplicate' }
        }
      },
      '/old': {
        Misswarm: { set: {} }
      },
      '/backups': {},
      '/data': {}
    });
  });

  afterEach(() => {
    mockFs.restore();
  });

  test('resolves albums and photos using hierarchy, size and normalized dates', () => {
    const plan = createReconciliationPlan({
      favorites: createFavorites(),
      sources,
      scanRoots: roots
    });

    expect(plan.summary).toEqual({
      albumsResolved: 2,
      imagesResolved: 3,
      albumPreviewsResolved: 2,
      albumPreviewsUnresolved: 1,
      unresolved: 2
    });
    expect(plan.albumPreviewChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'album-unique',
        albumPath: '/library/500-Cos专题/set-037',
        previewPath: '/library/500-Cos专题/set-037/cover.jpg',
        previewRelativePath: 'cover.jpg',
        reason: 'albumRelativePath'
      }),
      expect.objectContaining({
        id: 'album-child',
        previewPath: '/library/500-Cos专题/Misswarm/set/02_Foot/C (1).jpg',
        previewRelativePath: 'C (1).jpg',
        reason: 'albumFirstMedia'
      })
    ]));
    expect(plan.albumPreviewUnresolved).toEqual([
      expect.objectContaining({
        id: 'album-empty',
        albumPath: '/library/empty-album',
        reason: 'noMedia'
      })
    ]);
    expect(plan.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'album-child',
        newPath: '/library/500-Cos专题/Misswarm/set/02_Foot',
        reason: 'parentPath'
      }),
      expect.objectContaining({
        id: 'image-album',
        newPath: '/library/500-Cos专题/set-037/cover.jpg',
        reason: 'albumRelativePath'
      }),
      expect.objectContaining({
        id: 'image-size',
        newPath: '/library/500-Cos专题/B/shared.jpg',
        reason: 'filenameAndSize'
      }),
      expect.objectContaining({
        id: 'image-date',
        newPath: '/library/600-Cos Weibo/weibo@20250427/post.jpg',
        reason: 'normalizedParentDate'
      })
    ]));
    expect(plan.changes.find((change) => change.id === 'image-generic')).toBeUndefined();
    expect(plan.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'image-generic', reason: 'ambiguous' }),
      expect.objectContaining({ id: 'image-missing', reason: 'notFound' })
    ]));
    plan.changes.forEach((change) => {
      expect(change).toMatchObject({
        sourceId: SOURCE_ID,
        relativePath: expect.any(String)
      });
    });
  });

  test('rejects apply when favorites changed after planning', () => {
    const favorites = createFavorites();
    const plan = createReconciliationPlan({ favorites, sources, scanRoots: roots });
    const favoritesPath = '/data/favorites.json';
    fs.writeFileSync(favoritesPath, JSON.stringify({ ...favorites, version: 10 }, null, 2));

    expect(() => applyReconciliationPlan({
      favoritesPath,
      plan,
      backupRoot: '/backups'
    })).toThrow('收藏数据已变化');
    expect(fs.readdirSync('/backups')).toEqual([]);
  });

  test('backs up and atomically applies only fixed changes', () => {
    const favorites = createFavorites();
    const favoritesPath = '/data/favorites.json';
    fs.writeFileSync(favoritesPath, JSON.stringify(favorites, null, 2));
    const plan = createReconciliationPlan({ favorites, sources, scanRoots: roots });

    const result = applyReconciliationPlan({
      favoritesPath,
      plan,
      backupRoot: '/backups',
      now: () => new Date('2026-07-13T03:00:00.000Z')
    });

    const stored = JSON.parse(fs.readFileSync(favoritesPath, 'utf8'));
    expect(stored.albums).toHaveLength(favorites.albums.length);
    expect(stored.images).toHaveLength(favorites.images.length);
    expect(stored.collections).toEqual(favorites.collections);
    expect(stored.images.find((item) => item.id === 'image-album')).toMatchObject({
      path: '/library/500-Cos专题/set-037/cover.jpg',
      addedAt: 3,
      sourceId: SOURCE_ID,
      relativePath: '500-Cos专题/set-037/cover.jpg'
    });
    expect(stored.images.find((item) => item.id === 'image-generic').path)
      .toBe('/old/015 - 可畏礼服/3.jpg');
    expect(stored.albums.find((item) => item.id === 'album-unique')).toMatchObject({
      path: '/library/500-Cos专题/set-037',
      previewRelativePaths: ['cover.jpg'],
      previewSamples: ['/library/500-Cos专题/set-037/cover.jpg'],
      samples: ['/library/500-Cos专题/set-037/cover.jpg'],
      previewImagePath: '/library/500-Cos专题/set-037/cover.jpg',
      previewImages: [{
        path: '/library/500-Cos专题/set-037/cover.jpg',
        name: 'cover.jpg',
        size: 5
      }],
      addedAt: 1
    });
    expect(stored.albums.find((item) => item.id === 'album-empty')).toEqual(
      favorites.albums.find((item) => item.id === 'album-empty')
    );
    expect(stored.version).toBe(10);

    const repeatedPlan = createReconciliationPlan({
      favorites: stored,
      sources,
      scanRoots: roots
    });
    expect(repeatedPlan.summary).toMatchObject({
      albumsResolved: 0,
      imagesResolved: 0,
      albumPreviewsResolved: 0,
      albumPreviewsUnresolved: 1
    });

    const backup = fs.readFileSync(result.backupPath, 'utf8');
    expect(createFavoritesDigest(JSON.parse(backup))).toBe(plan.sourceDigest);
    const manifest = JSON.parse(fs.readFileSync(path.join(result.backupDir, 'manifest.json'), 'utf8'));
    expect(manifest.items[0]).toMatchObject({
      original_path: favoritesPath,
      backup_path: result.backupPath,
      cleanup_allowed: false
    });
  });

  test('uses the approved roots and only applies with an explicit flag', () => {
    expect(SCAN_ROOTS).toEqual([
      '/Volumes/Collection/300-Cosplayer',
      '/Volumes/1TB/Collection/400-Cos Album',
      '/Volumes/1TB/Collection/500-Cos专题',
      '/Volumes/1TB/Collection/600-Cos Weibo',
      '/Volumes/1TB/Collection/兴趣'
    ]);
    expect(createCommandConfig([]).apply).toBe(false);
    expect(createCommandConfig(['--apply']).apply).toBe(true);
  });
});
