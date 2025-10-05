// Shared utilities for computing virtualized grid layouts.
// Keeps density configuration and column calculations in one place so HomePage,
// FavoritesPage, and AlbumPage remain consistent.

export const GRID_CONFIG = {
  compact: {
    itemWidth: 180,
    aspectRatio: 1.5,
    gap: 8
  },
  standard: {
    itemWidth: 220,
    aspectRatio: 1.5,
    gap: 10
  },
  comfortable: {
    itemWidth: 280,
    aspectRatio: 1.5,
    gap: 12
  }
};

export const DEFAULT_DENSITY = 'standard';

export function getGridConfig(density) {
  return GRID_CONFIG[density] || GRID_CONFIG[DEFAULT_DENSITY];
}

export function computeGridColumns(windowWidth, density, options = {}) {
  const { isSmallScreen = false, minimumColumns = 1, smallScreenPadding = 16, largeScreenPadding = 24 } = options;
  const config = getGridConfig(density);
  const containerPadding = isSmallScreen ? smallScreenPadding : largeScreenPadding;
  const availableWidth = Math.max(0, windowWidth - containerPadding * 2);
  return Math.max(minimumColumns, Math.floor((availableWidth + config.gap) / (config.itemWidth + config.gap)));
}

export function chunkIntoRows(items, columns) {
  if (!Array.isArray(items) || columns <= 0) {
    return [];
  }

  const rows = [];
  for (let index = 0; index < items.length; index += columns) {
    rows.push(items.slice(index, index + columns));
  }
  return rows;
}
