import CHANNELS from '../../common/ipc-channels';

const ipcRenderer = typeof window !== 'undefined' ? (window.electronAPI || null) : null;

/**
 * 在独立窗口里打开设置。失败时返回 false，调用方可以退回同窗口路由。
 */
export async function openSettingsWindow() {
  if (!ipcRenderer) return false;
  try {
    const result = await ipcRenderer.invoke(CHANNELS.OPEN_SETTINGS_WINDOW);
    return Boolean(result?.success);
  } catch (_error) {
    return false;
  }
}
