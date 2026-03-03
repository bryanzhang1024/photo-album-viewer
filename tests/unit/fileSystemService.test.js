/** @jest-environment node */

const path = require('path');
const fs = require('fs');
const {
  scanNavigationLevel,
  scanDirectoryTree,
  createErrorResponse,
  SUPPORTED_FORMATS
} = require('../../src/main/services/FileSystemService');
const { createFsMock } = require('../helpers/fsMock');

describe('FileSystemService', () => {
  let mockFs;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (consoleLogSpy) {
      consoleLogSpy.mockRestore();
      consoleLogSpy = null;
    }
    if (consoleErrorSpy) {
      consoleErrorSpy.mockRestore();
      consoleErrorSpy = null;
    }
    if (mockFs && typeof mockFs.restore === 'function') {
      mockFs.restore();
      mockFs = null;
    }
  });

  test('createErrorResponse produces uniform payload', () => {
    const response = createErrorResponse('fail', '/tmp/photos');

    expect(response).toMatchObject({
      success: false,
      nodes: [],
      currentPath: '/tmp/photos',
      parentPath: '',
      breadcrumbs: [],
      error: {
        message: 'fail'
      },
      metadata: null
    });
    expect(typeof response.error.timestamp).toBe('number');
  });

  test('SUPPORTED_FORMATS lists common image extensions', () => {
    expect(SUPPORTED_FORMATS).toEqual(
      expect.arrayContaining(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])
    );
  });

  test('scanNavigationLevel returns empty nodes for empty directory', async () => {
    mockFs = createFsMock({
      '/photos': {
        empty: {}
      }
    });

    const result = await scanNavigationLevel('/photos/empty');

    expect(result.success).toBe(true);
    expect(result.nodes).toHaveLength(0);
    expect(result.metadata).toMatchObject({
      totalNodes: 0,
      folderCount: 0,
      albumCount: 0
    });
    expect(result.parentPath).toBe('/photos');
  });

  test('scanNavigationLevel classifies folders and albums correctly', async () => {
    mockFs = createFsMock({
      '/photos': {
        trip1: {
          'IMG_0001.jpg': Buffer.from('image'),
          'notes.txt': 'ignored'
        },
        family: {
          raw: {},
          'portrait.png': Buffer.from('image-data')
        },
        'cover.jpg': Buffer.from('root-image'),
        'document.pdf': 'ignored'
      }
    });

    const result = await scanNavigationLevel('/photos');

    expect(result.success).toBe(true);
    expect(result.nodes).toHaveLength(3);

    const folderNode = result.nodes.find((node) => node.type === 'folder');
    const albumNode = result.nodes.find(
      (node) => node.type === 'album' && node.name === 'trip1'
    );
    const selfAlbum = result.nodes.find(
      (node) => node.type === 'album' && node.name === 'photos'
    );

    expect(folderNode).toMatchObject({
      name: 'family',
      hasImages: false,
      type: 'folder'
    });
    expect(albumNode).toMatchObject({
      name: 'trip1',
      hasImages: true,
      type: 'album'
    });
    expect(selfAlbum).toBeDefined();
    expect(result.metadata).toMatchObject({
      totalNodes: 3,
      folderCount: 1,
      albumCount: 2
    });
    expect(result.breadcrumbs).toEqual([
      { name: 'photos', path: '/photos' }
    ]);
  });

  test('scanNavigationLevel uses first image by natural filename order for album preview', async () => {
    mockFs = createFsMock({
      '/photos': {
        numbered: {
          '1.jpg': Buffer.from('first'),
          '40.jpg': Buffer.from('last')
        }
      }
    });

    fs.utimesSync('/photos/numbered/1.jpg', new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'));
    fs.utimesSync('/photos/numbered/40.jpg', new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T00:00:00.000Z'));

    const result = await scanNavigationLevel('/photos');
    const albumNode = result.nodes.find(
      (node) => node.type === 'album' && node.name === 'numbered'
    );

    expect(albumNode).toBeDefined();
    expect(albumNode.previewImages[0]).toBe('/photos/numbered/1.jpg');
  });

  test('scanNavigationLevel returns error response when path missing', async () => {
    const result = await scanNavigationLevel('/does/not/exist');

    expect(result.success).toBe(false);
    expect(result.nodes).toHaveLength(0);
    expect(result.error).toBeDefined();
    expect(result.error.message).toBeTruthy();
  });

  test('scanDirectoryTree respects depth and skips empty folders', async () => {
    mockFs = createFsMock({
      '/gallery': {
        album1: {
          'img1.jpg': Buffer.from('image')
        },
        album2: {
          nested: {
            'img2.jpg': Buffer.from('image')
          }
        },
        empty: {}
      }
    });

    const tree = await scanDirectoryTree('/gallery', 0, 1);

    expect(Array.isArray(tree)).toBe(true);
    expect(tree).toHaveLength(2); // empty folder skipped
    const album1 = tree.find((node) => node.name === 'album1');
    const album2 = tree.find((node) => node.name === 'album2');

    expect(album1).toMatchObject({
      path: path.join('/gallery', 'album1'),
      type: 'folder',
      hasImages: true
    });
    expect(album2.children).toHaveLength(1);
  });
});
