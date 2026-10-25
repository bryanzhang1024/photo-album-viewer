import { invoke, CHANNELS } from './ipc';

/** IPC 错误既可能是字符串，也可能是 { code, message }；统一成可读文案。 */
function messageOf(error, fallback) {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

/** 照片来源：根目录注册表。返回 [{ sourceId, label, rootPath, ... }] */
export async function listSourceRoots() {
  const response = await invoke(CHANNELS.LOAD_SOURCE_ROOTS_V1, { contractVersion: 1 });
  if (!response?.ok) {
    throw new Error(messageOf(response?.error, '加载照片来源失败'));
  }
  return Array.isArray(response.data?.sources) ? response.data.sources : [];
}

/** 弹系统目录选择框。返回绝对路径或 null（用户取消）。 */
export async function selectDirectory() {
  const selected = await invoke(CHANNELS.SELECT_DIRECTORY);
  return typeof selected === 'string' && selected.length > 0 ? selected : null;
}

/**
 * 把目录注册为照片来源。已注册的目录直接返回已有来源。
 * 返回 { sourceId, label, rootPath, ... }
 */
export async function saveSourceRoot(rootPath) {
  const response = await invoke(CHANNELS.SAVE_SOURCE_ROOT_V1, {
    contractVersion: 1,
    sourceId: null,
    rootPath,
    label: null
  });
  if (!response?.ok) {
    throw new Error(messageOf(response?.error, '注册照片来源失败'));
  }
  const source = response.data?.source;
  if (!source?.sourceId) {
    throw new Error('注册照片来源失败：返回数据不完整');
  }
  return source;
}

/** 只移除注册记录，不触碰磁盘内容。 */
export async function removeSourceRoot(sourceId) {
  const response = await invoke(CHANNELS.REMOVE_SOURCE_ROOT_V1, { contractVersion: 1, sourceId });
  if (!response?.ok) {
    throw new Error(messageOf(response?.error, '移除照片来源失败'));
  }
  return response.data?.source || null;
}

/** 在同一个进程里开一个新窗口，定位到指定来源的某个相对路径。 */
export async function openInNewWindow({ sourceId, relativePath = '' }) {
  const response = await invoke(CHANNELS.CREATE_NEW_INSTANCE, {
    contractVersion: 1,
    target: { sourceId, relativePath, initialMediaRelativePath: null }
  });
  if (response && response.success === false) {
    throw new Error(response.error || '创建新窗口失败');
  }
  return response;
}

/** 拖入的路径里挑出文件夹并完成授权；返回 { folders, rejected }。 */
export async function resolveDroppedFolders(paths) {
  const response = await invoke(CHANNELS.RESOLVE_DROPPED_FOLDERS, paths);
  return {
    folders: Array.isArray(response?.folders) ? response.folders : [],
    rejected: Array.isArray(response?.rejected) ? response.rejected : []
  };
}
