import { describeSet } from '../../data/cos';
import { imageMeta } from '../../components/cardModel';

/** 「新」角标的时间窗：与 4.6.0「最近有变化」同一口径（最近 7 天）。 */
export const NEW_BADGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const NEW_BADGE_LABEL = '新';

/**
 * 套图是否算「刚入库」。
 *
 * 依据是套图目录的修改时间（索引随列表下发的 lastModified）：导入、改名、补元数据、
 * 搬图都会刷新它，所以它表示「最近被动过」，不等于严格的首次入库时间。
 */
export function isRecentlyAdded(lastModified, now = Date.now()) {
  const time = Number(lastModified);
  if (!Number.isFinite(time) || time <= 0) return false;
  return now - time < NEW_BADGE_WINDOW_MS;
}

/**
 * Cos 数据 → 共用卡片模型。
 *
 * 卡片尺寸、文字层级、封面比例全由 components/GridCard + VirtualGrid 决定；
 * 这里只负责按 Cos 规则填 name / meta / badge / cover 数据：
 * - 套图卡：丙方案文字（清理后的名字；次行作品/题材 · 张数）+ 最近 7 天动过的「新」角标
 * - 角色/署名卡：名字 + 套数
 * - 照片卡：文件名 + 大小 · 日期（与文件夹照片层同一个 imageMeta）
 */
export function setCardItems(sets, context = {}) {
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  return sets.map((set) => {
    const text = describeSet(set, context);
    return {
      key: set.id,
      name: text.name,
      meta: text.meta,
      badge: isRecentlyAdded(set.lastModified, now) ? NEW_BADGE_LABEL : null,
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
