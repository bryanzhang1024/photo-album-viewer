const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');
const http = require('http');
const url = require('url');

let mainWindow;
const windows = new Set();

// 检查服务器是否准备好
const waitForServer = (url, callback) => {
  const startTime = Date.now();
  const timeout = 30000; // 30秒超时
  const checkInterval = 100; // 每100毫秒检查一次

  const check = () => {
    const urlObj = new URL(url);
    const req = http.get({
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
    }, (res) => {
      if (res.statusCode === 200) {
        callback(null);
      } else {
        if (Date.now() - startTime > timeout) {
          callback(new Error('Server timeout'));
        } else {
          setTimeout(check, checkInterval);
        }
      }
    });

    req.on('error', (err) => {
      if (Date.now() - startTime > timeout) {
        callback(new Error('Server timeout'));
      } else {
        setTimeout(check, checkInterval);
      }
    });

    req.end();
  };

  check();
};

function createWindow(albumPath = null) {
  // 创建一个新的BrowserWindow实例
  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      webSecurity: false, // 禁用webSecurity以支持file://协议
      allowRunningInsecureContent: true, // 允许加载本地文件
      devTools: isDev,
      nodeIntegrationInWorker: true
    },
    show: false
  });

  // 存储窗口引用
  windows.add(newWindow);

  // 窗口完成加载后再显示
  newWindow.once('ready-to-show', () => {
    console.log('窗口ready-to-show事件触发');
    newWindow.show();
    newWindow.focus();
    console.log('窗口已显示并聚焦');
    
    // 确保窗口在最前 - 跨平台处理
    if (process.platform === 'darwin') {
      app.dock.show();
      app.dock.bounce('informational');
      // macOS 强制激活应用
      setTimeout(() => {
        app.focus({ steal: true });
        newWindow.focus();
        newWindow.moveTop();
      }, 100);
    } else if (process.platform === 'win32') {
      // Windows 特定处理
      newWindow.setAlwaysOnTop(true);
      newWindow.focus();
      setTimeout(() => {
        newWindow.setAlwaysOnTop(false);
      }, 1000);
    } else if (process.platform === 'linux') {
      // Linux 特定处理
      newWindow.maximize();
      newWindow.restore();
      newWindow.focus();
    }
    
    if (isDev) {
      newWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  const startUrl = isDev
    ? 'http://localhost:3000'
    : `file://${path.join(__dirname, '../../../build/index.html')}`;
  
  // 如果有指定的相簿路径，添加到URL参数
  let finalUrl = startUrl;
  if (albumPath) {
    const encodedPath = encodeURIComponent(albumPath);
    finalUrl = isDev 
      ? `http://localhost:3000/?initialPath=${encodedPath}`
      : `file://${path.join(__dirname, '../../../build/index.html')}?initialPath=${encodedPath}`;
    console.log('创建窗口的URL:', finalUrl);
  }

  if (isDev) {
    console.log('开发模式: 等待开发服务器启动...');
    waitForServer(startUrl, (err) => {
      if (err) {
        console.error('等待开发服务器超时:', err);
        // 如果开发服务器超时，显示错误页面
        newWindow.loadURL(`data:text/html,
          <html><body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h1>开发服务器连接失败</h1>
            <p>请检查webpack开发服务器是否正常运行</p>
            <p>错误: ${err.message}</p>
            <button onclick="location.href='http://localhost:3000/test.html'" style="padding: 10px 20px; margin: 10px;">测试页面</button>
            <button onclick="location.reload()" style="padding: 10px 20px; margin: 10px;">重试</button>
          </body></html>`);
      } else {
        console.log('开发服务器准备就绪，加载应用...');
        newWindow.loadURL(finalUrl);
      }
    });
  } else {
    newWindow.loadURL(finalUrl);
  }

  // 强制显示窗口的保险机制
  setTimeout(() => {
    if (!newWindow.isVisible()) {
      console.log('强制显示窗口');
      newWindow.show();
      newWindow.focus();
    }
  }, 5000); // 5秒后强制显示

  // 监听加载失败事件
  newWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('页面加载失败:', errorCode, errorDescription);
    newWindow.loadURL(`data:text/html,
      <html><body style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
        <h1>页面加载失败</h1>
        <p>错误代码: ${errorCode}</p>
        <p>错误描述: ${errorDescription}</p>
        <button onclick="location.reload()" style="padding: 10px 20px; margin: 10px;">重试</button>
      </body></html>`);
  });

  // 监听DOM就绪事件
  newWindow.webContents.on('dom-ready', () => {
    console.log('DOM已就绪');
  });
  newWindow.on('closed', () => {
    windows.delete(newWindow);
    if (newWindow === mainWindow) {
      mainWindow = null;
    }
    // 如果这是最后一个窗口，退出应用
    if (windows.size === 0) {
      app.quit();
    }
  });

  // 如果是第一个窗口，设为mainWindow
  if (!mainWindow) {
    mainWindow = newWindow;
  }

  return newWindow;
}

function getMainWindow() {
    return mainWindow;
}

module.exports = { createWindow, getMainWindow, windows };
