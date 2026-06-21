const DEFAULT_DUAL_PAGE_GAP = 24;

function getDimension(dimensionsByIndex, index) {
  if (!dimensionsByIndex || index < 0) {
    return null;
  }

  if (dimensionsByIndex instanceof Map) {
    return dimensionsByIndex.get(index) || null;
  }

  return dimensionsByIndex[index] || null;
}

function isValidDimension(dimensions) {
  return (
    dimensions &&
    Number.isFinite(dimensions.width) &&
    Number.isFinite(dimensions.height) &&
    dimensions.width > 0 &&
    dimensions.height > 0
  );
}

function canShowDualPage(firstDimensions, secondDimensions, viewport, gap = DEFAULT_DUAL_PAGE_GAP) {
  if (!isValidDimension(firstDimensions) || !isValidDimension(secondDimensions)) {
    return false;
  }

  if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) {
    return false;
  }

  if (viewport.width <= gap || viewport.height <= 0) {
    return false;
  }

  const firstAspectRatio = firstDimensions.width / firstDimensions.height;
  const secondAspectRatio = secondDimensions.width / secondDimensions.height;
  const availableAspectRatio = (viewport.width - gap) / viewport.height;

  return firstAspectRatio + secondAspectRatio <= availableAspectRatio;
}

function getVisibleImageIndices({
  images,
  currentIndex,
  dimensionsByIndex,
  viewport,
  dualPageEnabled,
  gap = DEFAULT_DUAL_PAGE_GAP
}) {
  if (!Array.isArray(images) || images.length === 0 || !images[currentIndex]) {
    return [];
  }

  if (!dualPageEnabled || currentIndex >= images.length - 1) {
    return [currentIndex];
  }

  const currentDimensions = getDimension(dimensionsByIndex, currentIndex);
  const nextDimensions = getDimension(dimensionsByIndex, currentIndex + 1);

  return canShowDualPage(currentDimensions, nextDimensions, viewport, gap)
    ? [currentIndex, currentIndex + 1]
    : [currentIndex];
}

function buildPageStarts({
  images,
  dimensionsByIndex,
  viewport,
  dualPageEnabled,
  gap = DEFAULT_DUAL_PAGE_GAP
}) {
  if (!Array.isArray(images) || images.length === 0) {
    return [];
  }

  const starts = [];
  let index = 0;

  while (index < images.length) {
    starts.push(index);
    const visibleIndices = getVisibleImageIndices({
      images,
      currentIndex: index,
      dimensionsByIndex,
      viewport,
      dualPageEnabled,
      gap
    });
    index += Math.max(visibleIndices.length, 1);
  }

  return starts;
}

function getNextPageIndex({
  images,
  currentIndex,
  dimensionsByIndex,
  viewport,
  dualPageEnabled,
  gap = DEFAULT_DUAL_PAGE_GAP
}) {
  if (!Array.isArray(images) || images.length === 0) {
    return 0;
  }

  const visibleIndices = getVisibleImageIndices({
    images,
    currentIndex,
    dimensionsByIndex,
    viewport,
    dualPageEnabled,
    gap
  });
  const nextIndex = currentIndex + Math.max(visibleIndices.length, 1);

  return nextIndex >= images.length ? 0 : nextIndex;
}

function getPreviousPageIndex({
  images,
  currentIndex,
  dimensionsByIndex,
  viewport,
  dualPageEnabled,
  gap = DEFAULT_DUAL_PAGE_GAP
}) {
  if (!Array.isArray(images) || images.length === 0) {
    return 0;
  }

  const starts = buildPageStarts({
    images,
    dimensionsByIndex,
    viewport,
    dualPageEnabled,
    gap
  });
  const previousStart = [...starts].reverse().find((start) => start < currentIndex);

  return typeof previousStart === 'number' ? previousStart : starts[starts.length - 1] || 0;
}

export {
  DEFAULT_DUAL_PAGE_GAP,
  canShowDualPage,
  getVisibleImageIndices,
  getNextPageIndex,
  getPreviousPageIndex
};
