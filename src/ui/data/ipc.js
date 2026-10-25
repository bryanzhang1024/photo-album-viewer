import CHANNELS from '../../common/ipc-channels';

/**
 * 新界面唯一的 IPC 入口。组件不允许直接调用 invoke，必须经过 data/ 里的模块。
 */
export function invoke(channel, ...args) {
  if (!window.electronAPI?.invoke) {
    return Promise.reject(new Error('IPC 不可用：请在 Electron 窗口里打开'));
  }
  return window.electronAPI.invoke(channel, ...args);
}

export { CHANNELS };
