const { app, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const isDev = require('electron-is-dev');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const http = require('http');
const sharp = require('sharp');
const crypto = require('crypto');
const { createWindow, getMainWindow, windows } = require('./services/WindowService');
const FileSystemService = require('./services/FileSystemService');
const ThumbnailService = require('./services/ThumbnailService');
const FavoritesService = require('./services/FavoritesService');
const CHANNELS = require(path.join(__dirname, '..', 'common', 'ipc-channels.js'));

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
ThumbnailService.setMaxWorkers(performanceSettings.concurrentTasks);

const thumbnailProtocolStats = {
  requestCount: 0,
  hitCount: 0,
  missCount: 0
};

const THUMBNAIL_PROTOCOL_PREFIX = 'thumbnail-protocol://';
const LOCAL_IMAGE_PROTOCOL_PREFIX = 'local-image-protocol://';
const LOCAL_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tif', '.tiff']);
const APPROVED_ROOTS_FILE = path.join(app.getPath('userData'), 'approved-roots.json');
const approvedRoots = new Set();
let approvedRootsLoaded = false;

function normalizeAbsolutePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }
  if (!path.isAbsolute(inputPath)) {
    return null;
  }
  return path.resolve(path.normalize(inputPath));
}

function isPathWithinRoot(targetPath, rootPath) {
  const normalizedTargetPath = normalizeAbsolutePath(targetPath);
  const normalizedRootPath = normalizeAbsolutePath(rootPath);
  if (!normalizedTargetPath || !normalizedRootPath) {
    return false;
  }
  return (
    normalizedTargetPath === normalizedRootPath
    || normalizedTargetPath.startsWith(`${normalizedRootPath}${path.sep}`)
  );
}

function isPathWithinApprovedRoots(targetPath) {
  for (const rootPath of approvedRoots) {
    if (isPathWithinRoot(targetPath, rootPath)) {
      return true;
    }
  }
  return false;
}

async function persistApprovedRoots() {
  const payload = {
    roots: Array.from(approvedRoots)
  };
  await writeFile(APPROVED_ROOTS_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

async function registerApprovedRoot(candidatePath, { persist = true } = {}) {
  const normalizedCandidate = normalizeAbsolutePath(candidatePath);
  if (!normalizedCandidate) {
    return false;
  }

  try {
    const stats = await fs.promises.stat(normalizedCandidate);
    const rootPath = stats.isDirectory() ? normalizedCandidate : path.dirname(normalizedCandidate);
    if (!approvedRoots.has(rootPath)) {
      approvedRoots.add(rootPath);
      if (persist) {
        await persistApprovedRoots();
      }
      console.log(`[Security] 注册允许访问目录: ${rootPath}`);
    }
    return true;
  } catch (error) {
    console.warn(`[Security] 注册目录失败: ${normalizedCandidate}`, error?.message || error);
    return false;
  }
}

async function loadApprovedRoots() {
  if (approvedRootsLoaded) {
    return;
  }

  approvedRootsLoaded = true;

  try {
    const content = await readFile(APPROVED_ROOTS_FILE, 'utf8');
    const parsed = JSON.parse(content);
    const roots = Array.isArray(parsed?.roots) ? parsed.roots : [];
    for (const rootPath of roots) {
      await registerApprovedRoot(rootPath, { persist: false });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[Security] 加载允许目录失败:', error?.message || error);
    }
  }
}

async function assertApprovedPath(targetPath, { bootstrapWhenEmpty = false } = {}) {
  const normalizedTargetPath = normalizeAbsolutePath(targetPath);
  if (!normalizedTargetPath) {
    return false;
  }

  if (isPathWithinApprovedRoots(normalizedTargetPath)) {
    return true;
  }

  if (bootstrapWhenEmpty && approvedRoots.size === 0) {
    const registered = await registerApprovedRoot(normalizedTargetPath);
    return registered && isPathWithinApprovedRoots(normalizedTargetPath);
  }

  return false;
}

function normalizePerformanceSettings(settings = {}, fallback = DEFAULT_PERFORMANCE_SETTINGS) {
  const resolved = { ...fallback };

  if (settings && typeof settings === 'object') {
    if (typeof settings.concurrentTasks !== 'undefined') {
      const numeric = Number(settings.concurrentTasks);
      if (Number.isFinite(numeric)) {
        resolved.concurrentTasks = Math.max(1, Math.min(8, Math.floor(numeric)));
      }
    }

    if (typeof settings.preloadDistance !== 'undefined') {
      const numeric = Number(settings.preloadDistance);
      if (Number.isFinite(numeric)) {
        resolved.preloadDistance = Math.max(0, Math.min(20, Math.floor(numeric)));
      }
    }

    if (typeof settings.cacheTimeout !== 'undefined') {
      const numeric = Number(settings.cacheTimeout);
      if (Number.isFinite(numeric)) {
        resolved.cacheTimeout = Math.max(1, Math.min(24 * 60, Math.floor(numeric)));
      }
    }

    if (typeof settings.cacheEnabled === 'boolean') {
      resolved.cacheEnabled = settings.cacheEnabled;
    }

    if (typeof settings.thumbnailResolution !== 'undefined') {
      const numeric = Number(settings.thumbnailResolution);
      if (Number.isFinite(numeric)) {
        resolved.thumbnailResolution = Math.max(100, Math.min(3000, Math.floor(numeric)));
      }
    }
  }

  return resolved;
}

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
    if (albumPath) {
      registerApprovedRoot(albumPath).catch((error) => {
        console.warn('[Security] second-instance 注册目录失败:', error?.message || error);
      });
    }
    
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
  await loadApprovedRoots();
  await ThumbnailService.ensureCacheDir(); // 使用ThumbnailService

  // 注册一个安全的自定义文件协议来提供缩略图
  session.defaultSession.protocol.registerFileProtocol('thumbnail-protocol', (request, callback) => {
    thumbnailProtocolStats.requestCount++;

    const encodedPath = request.url.startsWith(THUMBNAIL_PROTOCOL_PREFIX)
      ? request.url.slice(THUMBNAIL_PROTOCOL_PREFIX.length)
      : request.url;
    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(encodedPath);
    } catch (error) {
      thumbnailProtocolStats.missCount++;
      callback(-10); // ACCESS_DENIED
      return;
    }

    const cacheRoot = path.resolve(ThumbnailService.THUMBNAIL_CACHE_DIR);
    const resolvedPath = path.resolve(cacheRoot, decodedPath);
    const isInsideCache = resolvedPath === cacheRoot || resolvedPath.startsWith(`${cacheRoot}${path.sep}`);

    if (!isInsideCache) {
      thumbnailProtocolStats.missCount++;
      callback(-10); // ACCESS_DENIED
      return;
    }

    fs.promises.access(resolvedPath, fs.constants.F_OK)
      .then(() => {
        thumbnailProtocolStats.hitCount++;
        callback({ path: path.normalize(resolvedPath) });
      })
      .catch(() => {
        thumbnailProtocolStats.missCount++;
        callback(-6); // FILE_NOT_FOUND
      });
  });

  // 注册安全的本地图片协议，用于查看器加载原图（替代 file://）
  session.defaultSession.protocol.registerFileProtocol('local-image-protocol', (request, callback) => {
    const encodedPath = request.url.startsWith(LOCAL_IMAGE_PROTOCOL_PREFIX)
      ? request.url.slice(LOCAL_IMAGE_PROTOCOL_PREFIX.length)
      : request.url;

    let decodedPath = '';
    try {
      decodedPath = decodeURIComponent(encodedPath);
    } catch (error) {
      callback(-10); // ACCESS_DENIED
      return;
    }

    if (!decodedPath || !path.isAbsolute(decodedPath)) {
      callback(-10); // ACCESS_DENIED
      return;
    }

    const normalizedPath = path.normalize(decodedPath);
    const extension = path.extname(normalizedPath).toLowerCase();
    if (!LOCAL_IMAGE_EXTENSIONS.has(extension)) {
      callback(-10); // ACCESS_DENIED
      return;
    }

    if (!isPathWithinApprovedRoots(normalizedPath)) {
      callback(-10); // ACCESS_DENIED
      return;
    }

    fs.promises.stat(normalizedPath)
      .then((stats) => {
        if (!stats.isFile()) {
          callback(-6); // FILE_NOT_FOUND
          return;
        }
        callback({ path: normalizedPath });
      })
      .catch(() => {
        callback(-6); // FILE_NOT_FOUND
      });
  });
  
  // 处理命令行参数，使用指定的文件夹路径
  const initialPath = handleCommandLine();
  console.log('启动时的初始路径:', initialPath);
  if (initialPath) {
    await registerApprovedRoot(initialPath);
  }
  
  createWindow(initialPath);
  
  // 启动收藏数据文件监听
  await FavoritesService.startFavoritesWatcher();
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
ipcMain.handle(CHANNELS.SELECT_DIRECTORY, async () => {
  try {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory']
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const selectedDirectory = result.filePaths[0];
      await registerApprovedRoot(selectedDirectory);
      return selectedDirectory;
    }
    return null;
  } catch (error) {
    console.error('Error selecting directory:', error);
    return null;
  }
});

// 新的智能导航API
ipcMain.handle(CHANNELS.SCAN_NAVIGATION_LEVEL, async (event, targetPath) => {
  try {
    const isAllowed = await assertApprovedPath(targetPath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return FileSystemService.createErrorResponse('访问路径不在已授权照片目录范围内', targetPath);
    }

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
ipcMain.handle(CHANNELS.SCAN_DIRECTORY, async (event, rootPath) => {
  try {
    const isAllowed = await assertApprovedPath(rootPath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return [];
    }

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
ipcMain.handle(CHANNELS.GET_IMAGE_THUMBNAIL, async (event, imagePath, priority = 0) => {
    const isAllowed = await assertApprovedPath(imagePath);
    if (!isAllowed) {
      return null;
    }
    return ThumbnailService.generateThumbnail(imagePath, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5);
});

// 获取单个图片的缩略图 - 与get-image-thumbnail功能相同，但为了兼容性添加
ipcMain.handle(CHANNELS.GET_THUMBNAIL, async (event, imagePath, priority = 0) => {
    const isAllowed = await assertApprovedPath(imagePath);
    if (!isAllowed) {
      return null;
    }
    return ThumbnailService.generateThumbnail(imagePath, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5);
});

// 批量请求预览图 - 提高效率的新接口
ipcMain.handle(CHANNELS.GET_BATCH_THUMBNAILS, async (event, imagePaths, priority = 0) => {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      return {};
    }

    const approvedPaths = [];
    for (const imagePath of imagePaths) {
      if (await assertApprovedPath(imagePath)) {
        approvedPaths.push(imagePath);
      }
    }

    const promises = approvedPaths.map(p => ThumbnailService.generateThumbnail(p, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5).then(url => ({[p]: url})));
    const results = await Promise.all(promises);
    return Object.assign({}, ...results);
});



ipcMain.handle(CHANNELS.GET_ALBUM_IMAGES, async (event, albumPath) => {
    const isAllowed = await assertApprovedPath(albumPath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return [];
    }
    return FileSystemService.getAlbumImages(albumPath);
});

// 处理性能设置更新
ipcMain.handle(CHANNELS.UPDATE_PERFORMANCE_SETTINGS, async (event, settings) => {
  try {
    console.log('更新性能设置:', settings);
    performanceSettings = normalizePerformanceSettings(
      { ...performanceSettings, ...(settings || {}) },
      DEFAULT_PERFORMANCE_SETTINGS
    );
    ThumbnailService.setMaxWorkers(performanceSettings.concurrentTasks);
    // Also pass the settings to the service if it needs to react instantly
    // ThumbnailService.init(performanceSettings);
    return { success: true, settings: performanceSettings };
  } catch (error) {
    console.error('更新性能设置失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(CHANNELS.GET_CACHE_STATS, async () => {
  try {
    const diskStats = await ThumbnailService.thumbnailService.getCacheStats();
    const runtimeStats = ThumbnailService.thumbnailService.getRuntimeStats();
    const protocolHitRate = thumbnailProtocolStats.requestCount > 0
      ? Number(((thumbnailProtocolStats.hitCount / thumbnailProtocolStats.requestCount) * 100).toFixed(2))
      : 0;

    return {
      success: true,
      timestamp: Date.now(),
      performanceSettings,
      protocol: {
        ...thumbnailProtocolStats,
        hitRate: protocolHitRate
      },
      thumbnailService: {
        disk: diskStats,
        runtime: runtimeStats
      }
    };
  } catch (error) {
    console.error('获取缓存统计失败:', error);
    return { success: false, error: error.message };
  }
});

 

// 清空缩略图缓存
ipcMain.handle(CHANNELS.CLEAR_THUMBNAIL_CACHE, async () => {
  try {
    console.log('开始清空缩略图缓存...');
    
    // 确保缓存目录存在
    try {
      await ThumbnailService.ensureCacheDir();
    } catch (err) {
      console.error('访问缓存目录失败:', err);
      return { success: false, error: '访问缓存目录失败: ' + err.message };
    }
    
    // 读取缓存目录中的所有文件
    const files = await readdir(ThumbnailService.THUMBNAIL_CACHE_DIR);
    let deletedCount = 0;
    
    // 删除每个缓存文件
    for (const file of files) {
      if (file === '.' || file === '..') continue;
      
      const filePath = path.join(ThumbnailService.THUMBNAIL_CACHE_DIR, file);
      try {
        await fs.promises.unlink(filePath);
        deletedCount++;
      } catch (err) {
        console.error(`删除缓存文件失败: ${filePath}`, err);
        // 继续删除其他文件
      }
    }
        
    console.log(`缩略图缓存清理完成，删除了 ${deletedCount} 个文件`);
    return { success: true, deletedCount };
  } catch (error) {
    console.error('清空缩略图缓存失败:', error);
    return { success: false, error: error.message };
  }
}); 

// 在文件管理器中显示图片
ipcMain.handle(CHANNELS.SHOW_IN_FOLDER, async (event, filePath) => {
  try {
    const isAllowed = await assertApprovedPath(filePath);
    if (!isAllowed) {
      return { success: false, error: '访问路径不在已授权照片目录范围内' };
    }
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('在文件管理器中显示文件失败:', error);
    return { success: false, error: error.message };
  }
});

// 复制图片到剪贴板
ipcMain.handle(CHANNELS.COPY_IMAGE_TO_CLIPBOARD, async (event, filePath, mode = 'image') => {
  try {
    const { clipboard, nativeImage } = require('electron');

    const isAllowed = await assertApprovedPath(filePath);
    if (!isAllowed) {
      throw new Error('访问路径不在已授权照片目录范围内');
    }

    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch (error) {
      throw new Error('图片文件不存在');
    }
    
    // 读取图片文件并创建nativeImage
    const image = nativeImage.createFromPath(filePath);
    
    if (image.isEmpty()) {
      throw new Error('无法读取图片文件');
    }

    const normalizedMode = mode === 'file' ? 'file' : 'image';

    if (normalizedMode === 'file') {
      // 写入文件引用，便于聊天工具保留原始文件名和后缀
      if (process.platform === 'darwin') {
        const fileUrl = pathToFileURL(filePath).toString();
        const fileName = path.basename(filePath);
        clipboard.clear();

        // Finder 常见文件复制类型：多写几种以提升第三方聊天软件识别率
        const fileReferenceFormats = [
          ['NSFilenamesPboardType', Buffer.from(JSON.stringify([filePath]), 'utf8')],
          ['public.file-url', Buffer.from(fileUrl, 'utf8')],
          ['public.url', Buffer.from(fileUrl, 'utf8')],
          ['text/uri-list', Buffer.from(fileUrl, 'utf8')]
        ];

        for (const [format, buffer] of fileReferenceFormats) {
          try {
            clipboard.writeBuffer(format, buffer);
          } catch (error) {
            console.warn(`写入 ${format} 失败:`, error?.message || error);
          }
        }

        try {
          clipboard.writeBookmark(fileName, fileUrl);
        } catch (error) {
          console.warn('写入 bookmark 失败:', error?.message || error);
        }
      } else {
        clipboard.clear();
        clipboard.writeText(filePath);
      }

      return {
        success: true,
        filePath,
        mode: normalizedMode,
        platform: process.platform,
        formats: clipboard.availableFormats()
      };
    }

    const pngBuffer = image.toPNG();
    const pngImage = nativeImage.createFromBuffer(pngBuffer);

    if (!pngImage || pngImage.isEmpty()) {
      throw new Error('图片转换为 PNG 失败');
    }

    // 仅写入图片数据，优先兼容聊天框粘贴图片
    clipboard.clear();
    clipboard.writeImage(pngImage);

    return {
      success: true,
      filePath,
      mode: normalizedMode,
      platform: process.platform,
      formats: clipboard.availableFormats(),
      hasImage: !clipboard.readImage().isEmpty()
    };
  } catch (error) {
    console.error('复制图片到剪贴板失败:', error);
    return { success: false, error: error.message };
  }
});

// 创建新窗口查看文件夹
ipcMain.handle(CHANNELS.CREATE_NEW_WINDOW, async (event, albumPath) => {
  try {
    if (albumPath) {
      const isAllowed = await assertApprovedPath(albumPath, { bootstrapWhenEmpty: true });
      if (!isAllowed) {
        return { success: false, error: '访问路径不在已授权照片目录范围内' };
      }
    }

    if (albumPath) {
      await registerApprovedRoot(albumPath);
    }

    if (albumPath && !isPathWithinApprovedRoots(albumPath)) {
      return { success: false, error: '访问路径不在已授权照片目录范围内' };
    }

    console.log('创建新窗口查看文件夹:', albumPath);
    const newWindow = createWindow(albumPath);
    return { success: true, windowId: newWindow.id };
  } catch (error) {
    console.error('创建新窗口失败:', error);
    return { success: false, error: error.message };
  }
});

// 创建新实例并选择文件夹
ipcMain.handle(CHANNELS.CREATE_NEW_INSTANCE, async (event, folderPath) => {
  try {
    const isAllowed = await assertApprovedPath(folderPath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return { success: false, error: '访问路径不在已授权照片目录范围内' };
    }
    await registerApprovedRoot(folderPath);

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
ipcMain.handle(CHANNELS.GET_WINDOWS_INFO, async () => {
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

// 处理扫描目录树请求 - 委托给 FileSystemService
ipcMain.handle(CHANNELS.SCAN_DIRECTORY_TREE, async (event, rootPath) => {
  try {
    const isAllowed = await assertApprovedPath(rootPath, { bootstrapWhenEmpty: true });
    if (!isAllowed) {
      return [];
    }

    console.log(`开始扫描目录树: ${rootPath}`);
    const tree = await FileSystemService.scanDirectoryTree(rootPath);
    console.log(`目录树扫描完成，找到 ${tree.length} 个顶级目录`);
    return tree;
  } catch (error) {
    console.error('扫描目录树失败:', error);
    return [];
  }
}); 
