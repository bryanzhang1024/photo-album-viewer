import { invoke, CHANNELS } from './ipc';

/** 读取一层目录快照（v1 契约）。返回 snapshot，字段见 directory-contract-v1。 */
export async function getDirectoryLevel(source, relativePath = '') {
  const response = await invoke(CHANNELS.GET_DIRECTORY_LEVEL_V1, {
    contractVersion: 1,
    runtimeSource: { sourceId: source.sourceId, rootPath: source.rootPath },
    ref: { sourceId: source.sourceId, relativePath }
  });
  if (!response?.ok) {
    throw new Error(response?.error?.message || '目录扫描失败');
  }
  const snapshot = response.data;
  if (!snapshot || !Array.isArray(snapshot.directMedia) || !Array.isArray(snapshot.children)) {
    throw new Error('目录扫描返回无效数据');
  }
  return snapshot;
}

/** 把快照摊平成卡片列表：子文件夹 + 当前层图片。 */
export function toFolderItems(snapshot) {
  const folders = snapshot.children.map((child) => ({
    kind: 'folder',
    key: `folder:${child.ref.relativePath}`,
    name: child.name,
    relativePath: child.ref.relativePath,
    status: child.status,
    imageCount: child.facts?.directMediaCount ?? 0,
    childCount: child.facts?.childDirectoryCount ?? 0,
    mtimeMs: Number.isFinite(child.mtimeMs) ? child.mtimeMs : 0,
    coverSamples: child.approximate?.coverSamples || []
  }));
  const images = snapshot.directMedia.map((media) => ({
    kind: 'image',
    key: `image:${media.relativePath}`,
    name: media.name,
    relativePath: media.relativePath,
    size: media.size,
    mtimeMs: media.mtimeMs
  }));
  return [...folders, ...images];
}
