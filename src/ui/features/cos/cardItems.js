import { describeSet } from '../../data/cos';
import { imageMeta } from '../../components/cardModel';

/**
 * Cos 数据 → 共用卡片模型。
 *
 * 卡片尺寸、文字层级、封面比例全由 components/GridCard + VirtualGrid 决定；
 * 这里只负责按 Cos 规则填 name / meta / cover 数据：
 * - 套图卡：丙方案文字（清理后的名字；次行作品/题材 · 张数）
 * - 角色/署名卡：名字 + 套数
 * - 照片卡：文件名 + 大小 · 日期（与文件夹照片层同一个 imageMeta）
 */
export function setCardItems(sets, context = {}) {
  return sets.map((set) => {
    const text = describeSet(set, context);
    return {
      key: set.id,
      name: text.name,
      meta: text.meta,
      coverMediaId: set.coverMediaId || null,
      payload: set
    };
  });
}

export function entityCardItems(entities) {
  return entities.map((entity) => ({
    key: entity.id,
    name: entity.name,
    meta: entity.id && entity.name === '其他'
      ? `${entity.coserCount || 0} 位 · ${entity.setCount} 套`
      : `${entity.setCount} 套`,
    coverMediaId: entity.coverMediaId || null,
    payload: entity
  }));
}

/**
 * Cos 套图 → 收藏记录（与文件夹页/收藏页同一份 favorites.json）。
 * 主进程在 favoriteTargets 里给出套图目录的绝对路径与封面；套图不可用时返回 null。
 */
export function setFavoriteEntry(set) {
  const target = (set?.favoriteTargets || []).find((item) => item && item.path);
  if (!target) return null;
  const preview = target.previewImagePath
    ? [{ path: target.previewImagePath, name: '' }]
    : [];
  return {
    path: target.path,
    name: set.displayName || set.originalName || '套图',
    kind: 'photoSet',
    imageCount: Number(set.imageCount) || 0,
    previewImages: preview,
    previewImagePath: target.previewImagePath || ''
  };
}

export function photoCardItems(images) {
  return images.map((image, index) => ({
    key: image.path,
    name: image.name,
    meta: imageMeta({ size: image.size, lastModified: image.lastModified }),
    payload: { image, index }
  }));
}
