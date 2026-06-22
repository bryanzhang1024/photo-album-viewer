import {
  DEFAULT_DUAL_PAGE_GAP,
  canShowDualPage,
  getNextPageIndex,
  getPreviousPageIndex,
  getVisibleImageIndices
} from '../../src/renderer/utils/viewerPages';

const images = [
  { path: '/photos/1.jpg' },
  { path: '/photos/2.jpg' },
  { path: '/photos/3.jpg' },
  { path: '/photos/4.jpg' }
];

const portrait = { width: 2000, height: 3000 };
const landscape = { width: 3000, height: 2000 };
const viewport16By9 = { width: 1600, height: 900 };

describe('viewerPages', () => {
  test('uses no fixed gap between dual pages by default', () => {
    expect(DEFAULT_DUAL_PAGE_GAP).toBe(0);
  });

  test('allows two portrait images on a 16:9 viewport', () => {
    expect(canShowDualPage(portrait, portrait, viewport16By9)).toBe(true);
  });

  test('rejects a portrait and a landscape image on a 16:9 viewport', () => {
    expect(canShowDualPage(portrait, landscape, viewport16By9)).toBe(false);
  });

  test('uses single, single, pair sequence when only the third and fourth images fit together', () => {
    const dimensionsByIndex = new Map([
      [0, portrait],
      [1, landscape],
      [2, portrait],
      [3, portrait]
    ]);

    expect(getVisibleImageIndices({
      images,
      currentIndex: 0,
      dimensionsByIndex,
      viewport: viewport16By9,
      dualPageEnabled: true
    })).toEqual([0]);
    expect(getNextPageIndex({
      images,
      currentIndex: 0,
      dimensionsByIndex,
      viewport: viewport16By9,
      dualPageEnabled: true
    })).toBe(1);
    expect(getNextPageIndex({
      images,
      currentIndex: 1,
      dimensionsByIndex,
      viewport: viewport16By9,
      dualPageEnabled: true
    })).toBe(2);
    expect(getVisibleImageIndices({
      images,
      currentIndex: 2,
      dimensionsByIndex,
      viewport: viewport16By9,
      dualPageEnabled: true
    })).toEqual([2, 3]);
    expect(getPreviousPageIndex({
      images,
      currentIndex: 2,
      dimensionsByIndex,
      viewport: viewport16By9,
      dualPageEnabled: true
    })).toBe(1);
  });

  test('falls back to single-page display while dimensions are unavailable', () => {
    expect(getVisibleImageIndices({
      images,
      currentIndex: 0,
      dimensionsByIndex: new Map(),
      viewport: viewport16By9,
      dualPageEnabled: true
    })).toEqual([0]);
  });

  test('keeps single-page behavior when dual-page mode is disabled', () => {
    const dimensionsByIndex = new Map([
      [0, portrait],
      [1, portrait]
    ]);

    expect(getVisibleImageIndices({
      images,
      currentIndex: 0,
      dimensionsByIndex,
      viewport: viewport16By9,
      dualPageEnabled: false
    })).toEqual([0]);
  });
});
