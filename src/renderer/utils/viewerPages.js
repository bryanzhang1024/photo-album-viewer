const DEFAULT_DUAL_PAGE_GAP = 0;

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

  const safeCurrentIndex = Number.isFinite(currentIndex)
    ? Math.min(Math.max(currentIndex, 0), images.length - 1)
    : 0;

  if (!dualPageEnabled) {
    return safeCurrentIndex <= 0 ? images.length - 1 : safeCurrentIndex - 1;
  }

  if (safeCurrentIndex <= 0) {
    const tailPairStart = images.length - 2;

    if (
      tailPairStart >= 0 &&
      canShowDualPage(
        getDimension(dimensionsByIndex, tailPairStart),
        getDimension(dimensionsByIndex, tailPairStart + 1),
        viewport,
        gap
      )
    ) {
      return tailPairStart;
    }

    return images.length - 1;
  }

  const previousPairStart = safeCurrentIndex - 2;
  if (previousPairStart >= 0) {
    const firstPreviousDimensions = getDimension(dimensionsByIndex, previousPairStart);
    const secondPreviousDimensions = getDimension(dimensionsByIndex, previousPairStart + 1);

    if (!isValidDimension(firstPreviousDimensions) || !isValidDimension(secondPreviousDimensions)) {
      return previousPairStart;
    }

    if (canShowDualPage(firstPreviousDimensions, secondPreviousDimensions, viewport, gap)) {
      return previousPairStart;
    }
  }

  return safeCurrentIndex - 1;
}

export {
  DEFAULT_DUAL_PAGE_GAP,
  canShowDualPage,
  getVisibleImageIndices,
  getNextPageIndex,
  getPreviousPageIndex
};
