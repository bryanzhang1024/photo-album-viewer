/**
 * 页面层级：返回当前位置的上一层，顶层返回 null。
 *
 * 「退一层」按页面层级（父级），不是浏览历史；⌘[ / ⌘] 才走标签历史。
 * Esc 与 ⌘↑ 共用这里的结果，保证两处去同一个地方。
 */

const ENTRANCE_KIND = {
  characters: 'cos-characters',
  cosers: 'cos-cosers'
};

/** 套图照片页的父级：由打开时的入口（origin）还原对应套图列表。 */
function cosSetParent(location) {
  const origin = location.origin || {};
  const viewKind = origin.viewKind || 'all';
  if ((viewKind === 'characters' || viewKind === 'cosers') && !origin.entityId) {
    return { kind: ENTRANCE_KIND[viewKind] };
  }
  return {
    kind: 'cos-sets',
    viewKind,
    entity: origin.entityId
      ? { id: origin.entityId, name: origin.entityName || '' }
      : null
  };
}

export default function parentLocation(location) {
  if (!location || typeof location.kind !== 'string') return null;
  switch (location.kind) {
    case 'folder': {
      const segments = String(location.relativePath || '').split('/').filter(Boolean);
      if (segments.length === 0) return { kind: 'roots' };
      return {
        kind: 'folder',
        sourceId: location.sourceId,
        relativePath: segments.slice(0, -1).join('/'),
        siblings: null
      };
    }
    case 'cos-set':
      return cosSetParent(location);
    case 'cos-sets':
      if (location.viewKind === 'characters' || location.viewKind === 'cosers') {
        return { kind: ENTRANCE_KIND[location.viewKind] };
      }
      return { kind: 'cos-home' };
    case 'cos-characters':
    case 'cos-cosers':
      return { kind: 'cos-home' };
    default:
      // roots / favorites / cos-home 是顶层
      return null;
  }
}
