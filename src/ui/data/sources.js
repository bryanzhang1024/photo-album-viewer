import { invoke, CHANNELS } from './ipc';

/** 照片来源：根目录注册表。返回 [{ sourceId, label, rootPath, ... }] */
export async function listSourceRoots() {
  const response = await invoke(CHANNELS.LOAD_SOURCE_ROOTS_V1, { contractVersion: 1 });
  if (!response?.ok) {
    throw new Error(response?.error || '加载照片来源失败');
  }
  return Array.isArray(response.data?.sources) ? response.data.sources : [];
}
