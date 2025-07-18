// 窗口管理工具
const electron = window.require ? window.require('electron') : null;
const ipcRenderer = electron ? electron.ipcRenderer : null;

class WindowManager {
  // 创建新窗口查看文件夹
  static async createNewWindow(albumPath = null) {
    if (!ipcRenderer) {
      console.error('无法访问ipcRenderer');
      return false;
    }

    try {
      const result = await ipcRenderer.invoke('create-new-window', albumPath);
      return result.success;
    } catch (error) {
      console.error('创建新窗口失败:', error);
      return false;
    }
  }

  // 获取所有窗口信息
  static async getWindowsInfo() {
    if (!ipcRenderer) {
      return [];
    }

    try {
      const result = await ipcRenderer.invoke('get-windows-info');
      return result.success ? result.windows : [];
    } catch (error) {
      console.error('获取窗口信息失败:', error);
      return [];
    }
  }

  // 使用命令行参数创建新窗口
  static async openFolderInNewWindow(albumPath) {
    if (!albumPath) return false;

    if (!ipcRenderer) {
      console.error('无法访问ipcRenderer');
      return false;
    }

    try {
      const result = await ipcRenderer.invoke('create-new-instance', albumPath);
      return result.success;
    } catch (error) {
      console.error('创建新实例失败:', error);
      return false;
    }
  }
}

export default WindowManager;