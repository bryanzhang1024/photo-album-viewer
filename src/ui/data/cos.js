import { invoke, CHANNELS } from './ipc';

export const getStatus = () => invoke(CHANNELS.COS_GET_STATUS);
export const refresh = () => invoke(CHANNELS.COS_REFRESH);
export const selectRoot = () => invoke(CHANNELS.COS_SELECT_ROOT);
export const removeRoot = (rootId) => invoke(CHANNELS.COS_REMOVE_ROOT, rootId);

export const listCharacters = (options) => invoke(CHANNELS.COS_LIST_CHARACTERS, options);
export const listCosers = (options) => invoke(CHANNELS.COS_LIST_COSERS, options);
export const listLooks = (options) => invoke(CHANNELS.COS_LIST_LOOKS, options);
export const listSets = (options) => invoke(CHANNELS.COS_LIST_SETS, options);
export const listSetIds = (options) => invoke(CHANNELS.COS_LIST_SET_IDS, options);
export const listRandomSetIds = (options) => invoke(CHANNELS.COS_LIST_RANDOM_SET_IDS, options);

export const getSet = (setId) => invoke(CHANNELS.COS_GET_SET, setId);
export const getSetImages = (setId, options) => invoke(CHANNELS.COS_GET_SET_IMAGES, setId, options);
export const getMediaThumbnail = (mediaId) => invoke(CHANNELS.COS_GET_MEDIA_THUMBNAIL, mediaId);
export const getMediaPath = (mediaId) => invoke(CHANNELS.COS_GET_MEDIA_PATH, mediaId);
export const showSetInFolder = (setId) => invoke(CHANNELS.COS_SHOW_SET_IN_FOLDER, setId);

const mediaThumbnailCache = new Map();

/** 套图封面缩略图（按 mediaId 缓存，避免重复请求）。 */
export async function loadMediaThumbnail(mediaId) {
  if (!mediaId) return '';
  if (mediaThumbnailCache.has(mediaId)) return mediaThumbnailCache.get(mediaId);
  const url = await getMediaThumbnail(mediaId).catch(() => null);
  if (url) mediaThumbnailCache.set(mediaId, url);
  return url || '';
}

/** 卡片主行：去掉当前署名前缀与末尾作品括号。次行给作品与张数。 */
export function describeSet(set, context = {}) {
  let name = String(set.displayName || set.originalName || '');
  const coser = context.coserName;
  if (coser && name.startsWith(coser)) {
    name = name.slice(coser.length).replace(/^[\s｜|·-]+/, '');
  }
  name = name.replace(/[（(][^（）()]*[）)]\s*$/, '').trim();
  if (!name) name = set.displayName || '';
  const secondaryParts = [];
  const work = Array.isArray(set.works) && set.works.length > 0 ? set.works[0] : '';
  if (work) secondaryParts.push(work);
  else if (set.type) secondaryParts.push(set.type);
  if (Number.isFinite(set.imageCount)) secondaryParts.push(`${set.imageCount} 张`);
  return { name, meta: secondaryParts.join(' · ') };
}

/** 实体卡（角色 / 署名）：名称 + 套数。 */
export function describeEntity(entity, kind) {
  if (kind === 'cosers') return { name: entity.name, meta: `${entity.setCount} 套` };
  return { name: entity.name, meta: `${entity.setCount} 套` };
}
