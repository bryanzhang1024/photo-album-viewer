const { app, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const isDev = require('electron-is-dev');
const { promisify } = require('util');
const http = require('http');
const sharp = require('sharp');
const crypto = require('crypto');
const url = require('url');
const { createWindow, getMainWindow, windows } = require('./services/WindowService');
const FileSystemService = require('./services/FileSystemService');
const ThumbnailService = require('./services/ThumbnailService');
const FavoritesService = require('./services/FavoritesService');

FavoritesService.registerIpcHandlers();

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// 性能设置默认值 - 基于 CPU 核心数优化
const DEFAULT_PERFORMANCE_SETTINGS = {
  concurrentTasks: Math.max(2, Math.min(6, os.cpus().length - 1)), // 动态设置并发数：2-6之间，基于CPU核心数
  preloadDistance: 5,
  cacheTimeout: 60, // 分钟
  cacheEnabled: true,
  thumbnailResolution: 600 // 缩略图分辨率（宽度，高度会按比例调整）
};

// 当前性能设置
let performanceSettings = {...DEFAULT_PERFORMANCE_SETTINGS};

// 单实例锁定 - 允许多窗口
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // 如果没有获得锁，说明已经有实例在运行
  // 在这种情况下，我们让第二个实例退出，但主实例会处理新窗口创建
  app.quit();
} else {
  // 主实例获得锁，监听第二个实例启动
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('检测到第二个实例启动，命令行:', commandLine);
    
    // 解析命令行参数中的文件夹路径
    let albumPath = null;
    for (const arg of commandLine) {
      if (arg.startsWith('--folder=')) {
        albumPath = decodeURIComponent(arg.substring(9));
        break;
      } else if (arg === '--folder' && commandLine.indexOf(arg) + 1 < commandLine.length) {
        albumPath = commandLine[commandLine.indexOf(arg) + 1];
        break;
      }
    }
    
    console.log('解析到的文件夹路径:', albumPath);
    
    // 创建新窗口
    const newWindow = createWindow(albumPath);
    
    // 激活新窗口
    if (newWindow.isMinimized()) newWindow.restore();
    newWindow.focus();
    
    // 确保窗口在最前 - 跨平台处理
    if (process.platform === 'darwin') {
      app.dock.show();
      app.dock.bounce('informational');
    } else if (process.platform === 'win32') {
      newWindow.setAlwaysOnTop(true);
      setTimeout(() => {
        newWindow.setAlwaysOnTop(false);
      }, 1000);
    } else if (process.platform === 'linux') {
      newWindow.maximize();
      newWindow.restore();
    }
  });
}

// 处理命令行参数
const handleCommandLine = () => {
  const commandLine = process.argv;
  console.log('命令行参数:', commandLine);
  
  let albumPath = null;
  
  // 查找 --folder 参数
  for (let i = 0; i < commandLine.length; i++) {
    const arg = commandLine[i];
    if (arg === '--folder') {
      // 下一个参数是路径
      if (i + 1 < commandLine.length) {
        albumPath = commandLine[i + 1];
        break;
      }
    } else if (arg.startsWith('--folder=')) {
      albumPath = decodeURIComponent(arg.substring(9));
      break;
    }
  }
  
  console.log('解析到的文件夹路径:', albumPath);
  return albumPath;
};

app.whenReady().then(async () => {
  await ThumbnailService.ensureCacheDir(); // 使用ThumbnailService
  await ThumbnailService.startThumbnailServer(); // 使用ThumbnailService
  
  // 处理命令行参数，使用指定的文件夹路径
  const initialPath = handleCommandLine();
  console.log('启动时的初始路径:', initialPath);
  
  createWindow(initialPath);
  
  // 启动收藏数据文件监听
  FavoritesService.startFavoritesWatcher();
});

// 应用退出时清理资源
app.on('before-quit', () => {
  FavoritesService.stopFavoritesWatcher();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (getMainWindow() === null) {
    createWindow();
  }
});


// 处理选择文件夹请求
ipcMain.handle('select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  } catch (error) {
    console.error('Error selecting directory:', error);
    return null;
  }
});

// 新的智能导航API
ipcMain.handle('scan-navigation-level', async (event, targetPath) => {
  try {
    console.log(`开始智能扫描: ${targetPath}`);
    const response = await FileSystemService.scanNavigationLevel(targetPath);
    console.log(`扫描完成: ${response.metadata ? `${response.metadata.totalNodes} 个节点，耗时 ${response.metadata.scanTime}ms` : '扫描失败'}`);
    return response;
  } catch (error) {
    console.error('智能扫描错误:', error);
    return FileSystemService.createErrorResponse(error.message, targetPath);
  }
});

// 处理扫描文件夹请求（兼容性保留）
ipcMain.handle('scan-directory', async (event, rootPath) => {
  try {
    console.log(`开始扫描文件夹: ${rootPath}（兼容模式）`);
    const startTime = Date.now();
    const albums = await FileSystemService.scanDirectories(rootPath);
    const endTime = Date.now();
    console.log(`扫描完成，找到 ${albums.length} 个相簿，耗时 ${endTime - startTime}ms`);
    return albums;
  } catch (error) {
    console.error('Error scanning directory:', error);
    return [];
  }
});

// 获取图片的缩略图 - 使用新的服务
ipcMain.handle('get-image-thumbnail', (event, imagePath, priority = 0) => {
    return ThumbnailService.generateThumbnail(imagePath, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5);
});

// 获取单个图片的缩略图 - 与get-image-thumbnail功能相同，但为了兼容性添加
ipcMain.handle('get-thumbnail', (event, imagePath, priority = 0) => {
    return ThumbnailService.generateThumbnail(imagePath, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5);
});

// 批量请求预览图 - 提高效率的新接口
ipcMain.handle('get-batch-thumbnails', async (event, imagePaths, priority = 0) => {
    const promises = imagePaths.map(p => ThumbnailService.generateThumbnail(p, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5).then(url => ({[p]: url})));
    const results = await Promise.all(promises);
    return Object.assign({}, ...results);
});

// 获取缩略图服务器端口
ipcMain.handle('get-thumbnail-server-port', () => {
  return ThumbnailService.getThumbnailUrl(''); // This is a bit of a hack, but it works for now
});

ipcMain.handle('get-album-images', async (event, albumPath) => {
    return FileSystemService.getAlbumImages(albumPath);
});

// 处理性能设置更新
ipcMain.handle('update-performance-settings', async (event, settings) => {
  try {
    console.log('更新性能设置:', settings);
    performanceSettings = {
      ...performanceSettings,
      ...settings
    };
    // Also pass the settings to the service if it needs to react instantly
    // ThumbnailService.init(performanceSettings);
    return { success: true };
  } catch (error) {
    console.error('更新性能设置失败:', error);
    return { success: false, error: error.message };
  }
});

 

// 清空缩略图缓存
ipcMain.handle('clear-thumbnail-cache', async () => {
  try {
    console.log('开始清空缩略图缓存...');
    
    // 确保缓存目录存在
    try {
      await ensureCacheDir();
    } catch (err) {
      console.error('访问缓存目录失败:', err);
      return { success: false, error: '访问缓存目录失败: ' + err.message };
    }
    
    // 读取缓存目录中的所有文件
    const files = await readdir(THUMBNAIL_CACHE_DIR);
    let deletedCount = 0;
    
    // 删除每个缓存文件
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      
      const filePath = path.join(THUMBNAIL_CACHE_DIR, file);
      try {
        await fs.promises.unlink(filePath);
        deletedCount++;
      } catch (err) {
        console.error(`删除缓存文件失败: ${filePath}`, err);
        // 继续删除其他文件
      }
    }
    
    // 清空处理中的图片映射
    processingImages.clear();
    // 重置缩略图队列
    thumbnailQueue = [];
    runningThumbnailTasks = 0;
    
    console.log(`缩略图缓存清理完成，删除了 ${deletedCount} 个文件`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('清空缩略图缓存失败:', error);
    return { success: false, error: error.message };
  }
}); 

// 在文件管理器中显示图片
ipcMain.handle('show-in-folder', async (event, filePath) => {
  try {
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('在文件管理器中显示文件失败:', error);
    return { success: false, error: error.message };
  }
});

// 复制图片到剪贴板
ipcMain.handle('copy-image-to-clipboard', async (event, filePath) => {
  try {
    const { clipboard, nativeImage } = require('electron');
    
    if (!fs.existsSync(filePath)) {
      throw new Error('图片文件不存在');
    }
    
    // 读取图片文件并创建nativeImage
    const image = nativeImage.createFromPath(filePath);
    
    if (image.isEmpty()) {
      throw new Error('无法读取图片文件');
    }
    
    // 复制到剪贴板
    clipboard.writeImage(image);
    
    return { success: true };
  } catch (error) {
    console.error('复制图片到剪贴板失败:', error);
    return { success: false, error: error.message };
  }
});

// 显示右键菜单
ipcMain.handle('show-context-menu', async (event, menuItems) => {
  try {
    console.log('=== 显示右键菜单开始 ===');
    
    // 获取当前窗口
    const window = BrowserWindow.fromWebContents(event.sender);
    
    if (!window) {
      console.error('无法获取当前窗口');
      return { success: false, error: '无法获取窗口' };
    }
    
    console.log('当前窗口ID:', window.id);
    
    // 获取鼠标位置
    const { screen } = require('electron');
    const cursorPos = screen.getCursorScreenPoint();
    
    console.log('鼠标位置:', cursorPos.x, cursorPos.y);
    
    // 创建菜单模板
    const menuTemplate = [
      {
        label: '在新实例中查看此文件夹',
        click: () => {
          // 直接调用创建新实例的逻辑
          console.log('右键菜单：创建新实例');
          event.sender.send('menu-action', 'create-new-instance');
        }
      },
      { type: 'separator' },
      {
        label: '收藏相簿',
        click: () => {
          event.sender.send('menu-action', 'toggle-favorite');
        }
      },
      {
        label: '在文件管理器中打开',
        click: () => {
          event.sender.send('menu-action', 'show-in-folder');
        }
      }
    ];
    
    const menu = Menu.buildFromTemplate(menuTemplate);
    
    // 显示菜单
    menu.popup({
      window: window,
      x: cursorPos.x,
      y: cursorPos.y
    });
    
    return { success: true };
  } catch (error) {
    console.error('显示右键菜单失败:', error);
    return { success: false, error: error.message };
  }
});

// 创建新窗口查看文件夹
ipcMain.handle('create-new-window', async (event, albumPath) => {
  try {
    console.log('创建新窗口查看文件夹:', albumPath);
    const newWindow = createWindow(albumPath);
    return { success: true, windowId: newWindow.id };
  } catch (error) {
    console.error('创建新窗口失败:', error);
    return { success: false, error: error.message };
  }
});

// 创建新实例并选择文件夹
ipcMain.handle('create-new-instance', async (event, folderPath) => {
  try {
    console.log('=== 创建新实例开始 ===');
    console.log('文件夹路径:', folderPath);
    
    // 作为替代方案，直接使用现有的createWindow函数创建新窗口
    // 这会在同一个进程中创建新窗口，而不是新进程
    console.log('使用现有进程创建新窗口作为替代方案');
    const newWindow = createWindow(folderPath);
    
    // 确保窗口在最前
    if (newWindow) {
      newWindow.show();
      newWindow.focus();
      
      if (process.platform === 'darwin') {
        app.dock.show();
        app.dock.bounce('informational');
      }
      
      console.log('新窗口创建成功，窗口ID:', newWindow.id);
      return { success: true, message: '已创建新窗口', windowId: newWindow.id };
    }
    
    // 如果需要真正的独立进程，使用下面的代码
    /*
    const { spawn } = require('child_process');
    
    // 获取应用路径和参数
    const appPath = process.execPath;
    const isDevMode = process.env.NODE_ENV === 'development' || isDev;
    
    console.log('当前环境:', isDevMode ? '开发' : '生产');
    console.log('应用路径:', appPath);
    console.log('平台:', process.platform);
    
    let command, args;
    
    // 正确处理路径中的空格和特殊字符
    const safePath = folderPath;
    
    // 开发模式下的特殊处理
    if (isDevMode) {
      // 开发模式下使用Electron CLI
      if (process.platform === 'darwin' || process.platform === 'linux') {
        command = 'npx';
        args = ['electron', '.', '--folder', safePath];
      } else if (process.platform === 'win32') {
        command = 'npx.cmd';
        args = ['electron', '.', '--folder', safePath];
      }
    } else {
      // 生产模式
      if (process.platform === 'darwin') {
        // macOS - 使用open命令启动新实例
        command = 'open';
        args = ['-n', '-a', appPath, '--args', '--folder', safePath];
      } else if (process.platform === 'win32') {
        // Windows - 使用cmd启动新实例
        command = 'cmd';
        args = ['/c', 'start', '', appPath, '--folder', safePath];
      } else {
        // Linux - 直接启动可执行文件
        command = appPath;
        args = ['--folder', safePath];
      }
    }
    
    console.log(`执行命令: ${command} ${args.join(' ')}`);
    
    // 使用spawn以获得更好的跨平台兼容性和路径处理
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: process.platform === 'win32' // Windows需要shell来处理路径
    });
    
    child.on('error', (err) => {
      console.error('进程启动错误:', err);
    });
    
    child.unref();
    
    console.log('新实例启动成功');
    */
    
  } catch (error) {
    console.error('创建新实例失败:', error);
    return { success: false, error: error.message };
  }
});

// 获取所有窗口信息
ipcMain.handle('get-windows-info', async () => {
  try {
    const windowsInfo = Array.from(windows).map(window => ({
      id: window.id,
      title: window.getTitle()
    }));
    return { success: true, windows: windowsInfo };
  } catch (error) {
    console.error('获取窗口信息失败:', error);
    return { success: false, error: error.message };
  }
});

// 扫描目录树 - 用于导航面板
async function scanDirectoryTree(rootPath, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return [];
  
  try {
    const entries = await readdir(rootPath);
    const items = [];
    
    for (const entry of entries) {
      const fullPath = path.join(rootPath, entry);
      try {
        const entryStats = await stat(fullPath);
        
        if (entryStats.isDirectory()) {
          // 检查目录是否包含图片或子目录
          let hasImages = false;
          let hasSubDirs = false;
          
          try {
            const subEntries = await readdir(fullPath);
            for (const subEntry of subEntries) {
              const subFullPath = path.join(fullPath, subEntry);
              try {
                const subStats = await stat(subFullPath);
                if (subStats.isDirectory()) {
                  hasSubDirs = true;
                } else if (subStats.isFile() && SUPPORTED_FORMATS.includes(path.extname(subEntry).toLowerCase())) {
                  hasImages = true;
                }
                if (hasImages && hasSubDirs) break; // 找到两种类型就可以停止
              } catch (err) {
                // 跳过无法访问的文件
                continue;
              }
            }
          } catch (err) {
            // 无法读取目录，跳过
            continue;
          }
          
          // 只包含有内容的目录
          if (hasImages || hasSubDirs) {
            const item = {
              name: entry,
              path: fullPath,
              type: 'folder',
              hasImages,
              children: depth < maxDepth ? await scanDirectoryTree(fullPath, depth + 1, maxDepth) : []
            };
            items.push(item);
          }
        }
      } catch (err) {
        // 跳过无法访问的文件或目录
        continue;
      }
    }
    
    return items.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.error(`扫描目录树失败 ${rootPath}:`, error);
    return [];
  }
}

// 处理扫描目录树请求
ipcMain.handle('scan-directory-tree', async (event, rootPath) => {
  try {
    console.log(`开始扫描目录树: ${rootPath}`);
    const tree = await scanDirectoryTree(rootPath);
    console.log(`目录树扫描完成，找到 ${tree.length} 个顶级目录`);
    return tree;
  } catch (error) {
    console.error('扫描目录树失败:', error);
    return [];
  }
}); 