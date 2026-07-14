const {
  attachFavoriteLocator,
  attachFavoritesLocators,
  materializeFavoritePath,
  materializeFavoritesData
} = require('../../src/common/favorite-locator');

const ROOT_SOURCE_ID = 'src_11111111-1111-4111-8111-111111111111';
const NESTED_SOURCE_ID = 'src_22222222-2222-4222-8222-222222222222';

const sources = [
  {
    sourceId: ROOT_SOURCE_ID,
    rootPath: '/',
    label: '电脑'
  },
  {
    sourceId: NESTED_SOURCE_ID,
    rootPath: '/Volumes/1TB/Collection',
    label: 'Collection'
  }
];

describe('favorite locator', () => {
  test('attaches the unique longest SourceRoot location', () => {
    expect(attachFavoriteLocator({
      id: 'image_1',
      path: '/Volumes/1TB/Collection/album/a.jpg'
    }, sources)).toEqual({
      id: 'image_1',
      path: '/Volumes/1TB/Collection/album/a.jpg',
      sourceId: NESTED_SOURCE_ID,
      relativePath: 'album/a.jpg'
    });
  });

  test('materializes a favorite against the current SourceRoot path', () => {
    expect(materializeFavoritePath({
      id: 'image_1',
      path: '/Volumes/Old/album/a.jpg',
      sourceId: NESTED_SOURCE_ID.toUpperCase(),
      relativePath: 'album/a.jpg'
    }, [{
      sourceId: NESTED_SOURCE_ID,
      rootPath: '/Volumes/NewCollection',
      label: 'Collection'
    }])).toEqual({
      id: 'image_1',
      path: '/Volumes/NewCollection/album/a.jpg',
      sourceId: NESTED_SOURCE_ID.toUpperCase(),
      relativePath: 'album/a.jpg'
    });
  });

  test('preserves legacy or unresolved favorites', () => {
    const legacy = { id: 'album_1', path: '/legacy/album' };
    const unresolved = {
      id: 'album_2',
      path: '/old/album',
      sourceId: 'src_33333333-3333-4333-8333-333333333333',
      relativePath: 'album'
    };

    expect(materializeFavoritePath(legacy, sources)).toBe(legacy);
    expect(materializeFavoritePath(unresolved, sources)).toBe(unresolved);
  });

  test('maps only favorite item collections and preserves metadata', () => {
    const data = {
      folders: [{ path: '/Volumes/1TB/Collection/folder' }],
      albums: [{ path: '/Volumes/1TB/Collection/album' }],
      images: [{ path: '/Volumes/1TB/Collection/album/a.jpg' }],
      collections: [{ id: 'collection_1', items: [] }],
      version: 8,
      lastModified: 123
    };

    const attached = attachFavoritesLocators(data, sources);
    expect(attached.folders[0]).toMatchObject({ sourceId: NESTED_SOURCE_ID, relativePath: 'folder' });
    expect(attached.albums[0]).toMatchObject({ sourceId: NESTED_SOURCE_ID, relativePath: 'album' });
    expect(attached.images[0]).toMatchObject({ sourceId: NESTED_SOURCE_ID, relativePath: 'album/a.jpg' });
    expect(attached.collections).toBe(data.collections);
    expect(attached.version).toBe(8);

    const materialized = materializeFavoritesData(attached, [{
      sourceId: NESTED_SOURCE_ID,
      rootPath: '/Volumes/Rebased',
      label: 'Collection'
    }]);
    expect(materialized.images[0].path).toBe('/Volumes/Rebased/album/a.jpg');
    expect(materialized.collections).toBe(data.collections);
  });

  test('stores album previews relative to the album and rebases them with the SourceRoot', () => {
    const data = {
      folders: [],
      albums: [{
        id: 'album_1',
        path: '/Volumes/1TB/Collection/album',
        previewImages: [{
          path: '/Volumes/1TB/Collection/album/nested/cover.jpg',
          name: 'cover.jpg'
        }]
      }],
      images: [],
      collections: []
    };

    const attached = attachFavoritesLocators(data, sources);
    expect(attached.albums[0].previewRelativePaths).toEqual(['nested/cover.jpg']);

    const materialized = materializeFavoritesData(attached, [{
      sourceId: NESTED_SOURCE_ID,
      rootPath: '/Volumes/Rebased',
      label: 'Collection'
    }]);
    expect(materialized.albums[0]).toMatchObject({
      path: '/Volumes/Rebased/album',
      previewRelativePaths: ['nested/cover.jpg'],
      previewSamples: ['/Volumes/Rebased/album/nested/cover.jpg'],
      samples: ['/Volumes/Rebased/album/nested/cover.jpg'],
      previewImagePath: '/Volumes/Rebased/album/nested/cover.jpg',
      previewImages: [{
        path: '/Volumes/Rebased/album/nested/cover.jpg',
        name: 'cover.jpg'
      }]
    });
  });

  test('ignores album preview paths outside the album or with invalid portable segments', () => {
    const attached = attachFavoritesLocators({
      albums: [{
        path: '/Volumes/1TB/Collection/album',
        previewSamples: [
          '/Volumes/1TB/Collection/other/cover.jpg',
          '/Volumes/1TB/Collection/album/valid.jpg'
        ]
      }]
    }, sources);
    expect(attached.albums[0].previewRelativePaths).toEqual(['valid.jpg']);

    const materialized = materializeFavoritesData({
      albums: [{
        path: '/old/album',
        sourceId: NESTED_SOURCE_ID,
        relativePath: 'album',
        previewRelativePaths: ['../outside.jpg', '/absolute.jpg', 'valid.jpg']
      }]
    }, [{
      sourceId: NESTED_SOURCE_ID,
      rootPath: '/Volumes/Rebased',
      label: 'Collection'
    }]);
    expect(materialized.albums[0].previewSamples).toEqual([
      '/Volumes/Rebased/album/valid.jpg'
    ]);
  });
});
