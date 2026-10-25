import { resolvePortableRelativePath } from '../../common/path-codec';
import { invoke, CHANNELS } from './ipc';

/** 当前目录的非图片文件（视频、压缩包等），只读当前层。 */
export async function listDirectoryFiles(source, relativePath) {
  const absolutePath = resolvePortableRelativePath(source.rootPath, relativePath);
  const response = await invoke(CHANNELS.LIST_DIRECTORY_FILES_V1, absolutePath);
  if (!response?.success) {
    throw new Error(response?.error || '读取文件列表失败');
  }
  return Array.isArray(response.files) ? response.files : [];
}

/** 用系统默认程序打开文件。 */
export async function openExternal(absolutePath) {
  const response = await invoke(CHANNELS.OPEN_PATH_EXTERNAL, absolutePath);
  if (!response?.success) throw new Error(response?.error || '打开文件失败');
  return true;
}

const KIND_LABELS = {
  video: '视频',
  archive: '压缩包',
  document: '文稿',
  audio: '音频',
  installer: '安装包',
  image: '图片文件',
  other: '其他'
};

export function fileKindLabel(file) {
  const label = KIND_LABELS[file.kind] || KIND_LABELS.other;
  const extension = String(file.ext || '').replace('.', '').toUpperCase();
  return extension ? `${label} · ${extension}` : label;
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
