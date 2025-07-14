// 主入口点文件，引导到主进程
const { app } = require('electron');
const path = require('path');

// 在开发环境中设置electron热重载
try {
  if (process.env.NODE_ENV === 'development') {
    const electronReload = require('electron-reload');
    electronReload(__dirname, {
      electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
    });
  }
} catch (err) {
  console.log('Electron热重载不可用:', err.message);
}

// 导入主进程逻辑
require('./src/main/main');

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
}); 