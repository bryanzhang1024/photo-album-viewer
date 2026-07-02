import {
  buildNodeFromScanResponse,
  canBrowseChildren,
  canViewAsPhotoSet,
  getContentKind,
  getPrimaryKind,
  getPrimaryView
} from '../../src/renderer/utils/nodeModel';

describe('nodeModel', () => {
  test('classifies pure photo set nodes', () => {
    const node = {
      directImageCount: 12,
      childFolders: 0,
      canViewAsPhotoSet: true,
      canBrowseChildren: false
    };

    expect(getContentKind(node)).toBe('photoSet');
    expect(getPrimaryKind(node)).toBe('album');
    expect(getPrimaryView(node)).toBe('album');
    expect(canViewAsPhotoSet(node)).toBe(true);
    expect(canBrowseChildren(node)).toBe(false);
  });

  test('classifies pure container nodes', () => {
    const node = {
      directImageCount: 0,
      childFolders: 8,
      canViewAsPhotoSet: false,
      canBrowseChildren: true
    };

    expect(getContentKind(node)).toBe('container');
    expect(getPrimaryKind(node)).toBe('folder');
    expect(getPrimaryView(node)).toBe('folder');
  });

  test('classifies hybrid nodes as folder-first browsing', () => {
    const node = {
      directImageCount: 55,
      childFolders: 73,
      canViewAsPhotoSet: true,
      canBrowseChildren: true,
      contentKind: 'hybrid'
    };

    expect(getContentKind(node)).toBe('hybrid');
    expect(getPrimaryKind(node)).toBe('folder');
    expect(getPrimaryView(node)).toBe('folder');
    expect(canViewAsPhotoSet(node)).toBe(true);
    expect(canBrowseChildren(node)).toBe(true);
  });

  test('classifies empty nodes', () => {
    const node = {
      directImageCount: 0,
      childFolders: 0
    };

    expect(getContentKind(node)).toBe('empty');
    expect(getPrimaryKind(node)).toBe('folder');
    expect(getPrimaryView(node)).toBe('folder');
  });

  test('falls back to legacy type fields when capability flags are missing', () => {
    const node = {
      type: 'album',
      canOpenAlbum: true,
      imageCount: 4,
      childFolders: 0
    };

    expect(canViewAsPhotoSet(node)).toBe(true);
    expect(getPrimaryView(node)).toBe('album');
  });

  test('buildNodeFromScanResponse derives capabilities from scan payload', () => {
    const node = buildNodeFromScanResponse({
      nodes: [{ path: '/a' }, { path: '/b' }],
      directImages: [{ path: '/cover.jpg' }]
    });

    expect(node).toEqual({
      directImageCount: 1,
      childFolders: 2,
      canViewAsPhotoSet: true,
      canBrowseChildren: true
    });
    expect(getPrimaryView(node)).toBe('folder');
  });
});
