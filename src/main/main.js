const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = require('electron-is-dev');
const { promisify } = require('util');
const http = require('http');
const sharp = require('sharp');
const crypto = require('crypto');
const url = require('url');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// 缩略图缓存目录
const THUMBNAIL_CACHE_DIR = path.join(app.getPath('userData'), 'thumbnail-cache');

// 支持的图片格式
const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

// 性能设置默认值
const DEFAULT_PERFORMANCE_SETTINGS = {
  concurrentTasks: 3, // 降低默认并发任务数量，减少冲突
  preloadDistance: 5,
  cacheTimeout: 60, // 分钟
  cacheEnabled: true,
  thumbnailResolution: 600 // 缩略图分辨率（宽度，高度会按比例调整）
};

// 当前性能设置
let performanceSettings = {...DEFAULT_PERFORMANCE_SETTINGS};

// 缩略图生成队列，限制并发任务数量
let CONCURRENT_THUMBNAIL_LIMIT = performanceSettings.concurrentTasks;
let thumbnailQueue = [];
let runningThumbnailTasks = 0;
let thumbnailServer = null;
let thumbnailServerPort = 0;

// 跟踪正在处理中的图片，防止同一图片被多个任务同时处理
const processingImages = new Map(); // 图片路径 -> Promise

// 队列处理函数
function processThumbnailQueue() {
  if (thumbnailQueue.length === 0 || runningThumbnailTasks >= CONCURRENT_THUMBNAIL_LIMIT) {
    return;
  }

  while (thumbnailQueue.length > 0 && runningThumbnailTasks < CONCURRENT_THUMBNAIL_LIMIT) {
    const task = thumbnailQueue.shift();
    runningThumbnailTasks++;

    // 处理任务
    generateThumbnail(task.imagePath, task.width, task.height, task.priority)
      .then(result => {
        task.resolve(result);
      })
      .catch(error => {
        task.reject(error);
      })
      .finally(() => {
        runningThumbnailTasks--;
        // 处理队列中的下一个任务
        processThumbnailQueue();
      });
  }
}

// 加入任务到队列
function enqueueThumbnailTask(imagePath, width, height, priority = 0) {
  return new Promise((resolve, reject) => {
    // 检查是否已经有相同的图片正在处理
    if (processingImages.has(imagePath)) {
      // console.log(`图片已在处理中，等待结果: ${imagePath}`);
      processingImages.get(imagePath)
        .then(resolve)
        .catch(reject);
      return;
    }
    
    // 优先级排序：高优先级任务(0)优先于低优先级任务(1)
    const task = { imagePath, width, height, priority, resolve, reject };
    
    // 根据优先级插入队列
    if (priority === 0 && thumbnailQueue.length > 0) {
      // 高优先级任务插入队列前面
      const insertIndex = thumbnailQueue.findIndex(item => item.priority > 0);
      if (insertIndex === -1) {
        thumbnailQueue.push(task);
      } else {
        thumbnailQueue.splice(insertIndex, 0, task);
      }
    } else {
      thumbnailQueue.push(task);
    }
    
    processThumbnailQueue();
  });
}

let mainWindow;
const windows = new Set(); // 存储所有窗口

// 确保缓存目录存在
async function ensureCacheDir() {
  try {
    await mkdir(THUMBNAIL_CACHE_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('创建缩略图缓存目录失败:', err);
    }
  }
}

// 生成缓存文件名
function generateCacheFilename(imagePath, width, height) {
  const hash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
  return path.join(THUMBNAIL_CACHE_DIR, `${hash}.webp`);
}

// 生成缩略图
async function generateThumbnail(imagePath, width = 300, height = 300, priority = 0) {
  try {
    // 检查是否已经有相同的图片正在处理
    if (processingImages.has(imagePath)) {
      // console.log(`图片已在处理中，等待结果: ${imagePath}`);
      return await processingImages.get(imagePath);
    }
    
    // 创建一个新的Promise来处理这个图片
    const processingPromise = (async () => {
      try {
        await ensureCacheDir();
        
        const cacheFilename = generateCacheFilename(imagePath, width, height);
        
        // 检查缓存是否存在 - 这里可能存在竞态条件
        // 如果多个任务同时检查到缓存不存在，都会尝试生成缩略图
        try {
          const cacheStats = await stat(cacheFilename);
          if (cacheStats.isFile() && cacheStats.size > 0) {
            // 缓存存在且有效，直接返回缩略图URL
            return getThumbnailUrl(cacheFilename);
          }
          // 如果缓存文件存在但大小为0，可能是之前的生成过程被中断，需要重新生成
          console.log(`缓存文件存在但可能无效，重新生成: ${cacheFilename}`);
        } catch (err) {
          // 缓存不存在，继续生成
        }
        
        // 检查源文件是否存在
        try {
          await stat(imagePath);
        } catch (err) {
          console.error(`源图片文件不存在: ${imagePath}`, err);
          return null;
        }
        
        try {
          // 创建sharp实例并获取元数据
          const image = sharp(imagePath, { failOnError: false });
          const metadata = await image.metadata();
          
          if (!metadata) {
            console.error(`无法获取图片元数据: ${imagePath}`);
            return null;
          }
          
          // 使用设置中的分辨率
          const targetWidth = width || performanceSettings.thumbnailResolution;
          const targetHeight = height || performanceSettings.thumbnailResolution * 1.5;
          
          // 创建一个临时文件名，避免多个进程同时写入同一文件
          const tempFilename = `${cacheFilename}.temp.${Date.now()}`;
          
          // 创建缩略图并保存到临时文件
          await image
            .resize({
              width: targetWidth,
              height: targetHeight,
              fit: sharp.fit.inside, // 使用inside而不是cover，保持原始宽高比
              withoutEnlargement: true // 避免放大小图片
            })
            .webp({ quality: 80 }) // 使用固定质量值
            .toFile(tempFilename);
          
          // 检查临时文件是否生成成功
          try {
            const tempStats = await stat(tempFilename);
            if (tempStats.size > 0) {
              // 原子性地将临时文件重命名为最终缓存文件
              try {
                // 如果目标文件已存在，先尝试删除
                try {
                  await fs.promises.unlink(cacheFilename).catch(() => {});
                } catch (err) {
                  // 忽略错误
                }
                
                // 重命名临时文件
                await fs.promises.rename(tempFilename, cacheFilename);
              } catch (renameErr) {
                console.error(`重命名临时文件失败: ${tempFilename} -> ${cacheFilename}`, renameErr);
                // 尝试复制文件内容而不是重命名
                try {
                  await fs.promises.copyFile(tempFilename, cacheFilename);
                  await fs.promises.unlink(tempFilename).catch(() => {});
                } catch (copyErr) {
                  console.error(`复制临时文件失败: ${tempFilename} -> ${cacheFilename}`, copyErr);
                }
              }
            }
          } catch (err) {
            console.error(`检查临时文件失败: ${tempFilename}`, err);
          }
          
          return getThumbnailUrl(cacheFilename);
        } catch (err) {
          console.error(`处理图片失败: ${imagePath}`, err);
          
          // 尝试使用备用方法处理图片
          try {
            console.log(`尝试使用备用方法处理图片: ${imagePath}`);
            const image = sharp(imagePath, { 
              failOnError: false,
              limitInputPixels: false // 不限制输入像素数
            });
            
            // 创建一个临时文件名
            const tempFilename = `${cacheFilename}.temp.${Date.now()}`;
            
            // 创建缩略图并保存到临时文件
            await image
              .resize({
                width: width || performanceSettings.thumbnailResolution,
                height: height || performanceSettings.thumbnailResolution * 1.5,
                fit: sharp.fit.inside,
                withoutEnlargement: true
              })
              .webp({ quality: 70 }) // 降低质量以提高兼容性
              .toFile(tempFilename);
            
            // 重命名临时文件
            try {
              // 如果目标文件已存在，先尝试删除
              try {
                await fs.promises.unlink(cacheFilename).catch(() => {});
              } catch (err) {
                // 忽略错误
              }
              
              await fs.promises.rename(tempFilename, cacheFilename);
            } catch (renameErr) {
              console.error(`重命名临时文件失败: ${tempFilename} -> ${cacheFilename}`, renameErr);
              // 尝试复制文件内容
              try {
                await fs.promises.copyFile(tempFilename, cacheFilename);
                await fs.promises.unlink(tempFilename).catch(() => {});
              } catch (copyErr) {
                console.error(`复制临时文件失败: ${tempFilename} -> ${cacheFilename}`, copyErr);
              }
            }
            
            return getThumbnailUrl(cacheFilename);
          } catch (backupErr) {
            console.error(`备用方法也失败: ${imagePath}`, backupErr);
            return null;
          }
        }
      } finally {
        // 处理完成后，从处理中的图片Map中移除
        processingImages.delete(imagePath);
      }
    })();
    
    // 将Promise添加到处理中的图片Map
    processingImages.set(imagePath, processingPromise);
    
    // 等待处理完成并返回结果
    return await processingPromise;
  } catch (err) {
    console.error('生成缩略图失败:', err);
    return null;
  }
}

// 获取缩略图URL
function getThumbnailUrl(cacheFilename) {
  if (!thumbnailServer) {
    return null;
  }
  
  const relativePath = path.relative(THUMBNAIL_CACHE_DIR, cacheFilename);
  return `http://localhost:${thumbnailServerPort}/thumbnails/${encodeURIComponent(relativePath)}`;
}

// 启动缩略图HTTP服务器
function startThumbnailServer() {
  return new Promise((resolve, reject) => {
    if (thumbnailServer) {
      resolve(thumbnailServerPort);
      return;
    }
    
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = url.parse(req.url);
        
        // 只处理缩略图请求
        if (parsedUrl.pathname.startsWith('/thumbnails/')) {
          const relativePath = decodeURIComponent(parsedUrl.pathname.substring('/thumbnails/'.length));
          const filePath = path.join(THUMBNAIL_CACHE_DIR, relativePath);
          
          // 安全检查：确保请求的文件在缩略图目录内
          const normalizedFilePath = path.normalize(filePath);
          if (!normalizedFilePath.startsWith(THUMBNAIL_CACHE_DIR)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('访问被拒绝');
            return;
          }
          
          // 检查文件是否存在
          fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('文件未找到');
              return;
            }
            
            // 设置缓存头
            res.setHeader('Cache-Control', 'max-age=31536000'); // 1年缓存
            res.setHeader('Content-Type', 'image/webp');
            
            // 流式传输文件
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
          });
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('文件未找到');
        }
      } catch (err) {
        console.error('缩略图服务器错误:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('服务器错误');
      }
    });
    
    // 监听随机端口
    server.listen(0, 'localhost', () => {
      const address = server.address();
      thumbnailServerPort = address.port;
      thumbnailServer = server;
      console.log(`缩略图服务器启动在端口 ${thumbnailServerPort}`);
      resolve(thumbnailServerPort);
    });
    
    server.on('error', (err) => {
      console.error('缩略图服务器启动失败:', err);
      reject(err);
    });
  });
}

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
      webSecurity: !isDev,
      devTools: isDev,
      nodeIntegrationInWorker: true
    },
    show: false
  });

  // 存储窗口引用
  windows.add(newWindow);

  // 窗口完成加载后再显示
  newWindow.once('ready-to-show', () => {
    newWindow.show();
    newWindow.focus();
    
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
    : `file://${path.join(__dirname, '../build/index.html')}`;
  
  // 如果有指定的相簿路径，添加到URL参数
  let finalUrl = startUrl;
  if (albumPath) {
    const encodedPath = encodeURIComponent(albumPath);
    finalUrl = isDev 
      ? `http://localhost:3000/?initialPath=${encodedPath}`
      : `file://${path.join(__dirname, '../build/index.html')}?initialPath=${encodedPath}`;
    console.log('创建窗口的URL:', finalUrl);
  }

  if (isDev) {
    console.log('开发模式: 等待开发服务器启动...');
    waitForServer(startUrl, (err) => {
      if (err) {
        console.error('等待开发服务器超时:', err);
      } else {
        console.log('开发服务器准备就绪，加载应用...');
        newWindow.loadURL(finalUrl);
      }
    });
  } else {
    newWindow.loadURL(finalUrl);
  }

  // 窗口关闭时从集合中移除
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
  await ensureCacheDir(); // 确保缓存目录存在
  await startThumbnailServer(); // 启动缩略图服务器
  
  // 处理命令行参数，使用指定的文件夹路径
  const initialPath = handleCommandLine();
  console.log('启动时的初始路径:', initialPath);
  
  createWindow(initialPath);
  
  // 启动收藏数据文件监听
  startFavoritesWatcher();
});

// 应用退出时清理资源
app.on('before-quit', () => {
  stopFavoritesWatcher();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// 扫描文件夹，查找最底层含图片的文件夹
async function scanDirectories(rootPath) {
  const albums = [];
  
  async function processDirectory(dirPath, relativePath = '') {
    try {
      const entries = await readdir(dirPath);
      
      // 检查是否为空文件夹
      if (entries.length === 0) return;
      
      // 检查此文件夹是否包含图片和子文件夹
      let hasImages = false;
      let hasSubDirs = false;
      let imageFiles = [];
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        try {
          const entryStats = await stat(fullPath);
          
          if (entryStats.isDirectory()) {
            hasSubDirs = true;
          } else if (entryStats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
            hasImages = true;
            imageFiles.push({
              path: fullPath,
              name: entry,
              size: entryStats.size,
              lastModified: entryStats.mtime
            });
          }
        } catch (err) {
          console.error(`无法访问 ${fullPath}:`, err);
          // 跳过无法访问的文件或目录
          continue;
        }
      }
      
      // 如果有图片，则当前目录是一个相簿（无论是否有子目录）
      if (hasImages) {
        // 只获取前4张图片作为预览
        const previewImages = imageFiles.slice(0, 4);
        
        albums.push({
          name: path.basename(dirPath),
          path: dirPath,
          relativePath: relativePath || path.basename(dirPath),
          previewImages,
          imageCount: imageFiles.length
        });
      }
      
      // 如果有子目录，则递归处理子目录
      if (hasSubDirs) {
        // 并行处理子目录以提高性能
        const subdirPromises = [];
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry);
          try {
            const entryStats = await stat(fullPath);
            
            if (entryStats.isDirectory()) {
              subdirPromises.push(
                processDirectory(
                  fullPath,
                  relativePath ? path.join(relativePath, entry) : entry
                )
              );
            }
          } catch (err) {
            console.error(`无法访问 ${fullPath}:`, err);
            continue;
          }
        }
        
        // 等待所有子目录处理完成
        if (subdirPromises.length > 0) {
          await Promise.all(subdirPromises);
        }
      }
    } catch (error) {
      console.error(`Error processing directory ${dirPath}:`, error);
    }
  }
  
  await processDirectory(rootPath);
  return albums;
}

// 处理选择文件夹请求
ipcMain.handle('select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
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

// 处理扫描文件夹请求
ipcMain.handle('scan-directory', async (event, rootPath) => {
  try {
    console.log(`开始扫描文件夹: ${rootPath}`);
    const startTime = Date.now();
    const albums = await scanDirectories(rootPath);
    const endTime = Date.now();
    console.log(`扫描完成，找到 ${albums.length} 个相簿，耗时 ${endTime - startTime}ms`);
    return albums;
  } catch (error) {
    console.error('Error scanning directory:', error);
    return [];
  }
});

// 获取图片的缩略图 - 使用队列和优先级
ipcMain.handle('get-image-thumbnail', async (event, imagePath, priority = 0) => {
  try {
    // 使用队列系统处理请求，使用设置中的分辨率
    const thumbnailUrl = await enqueueThumbnailTask(
      imagePath, 
      performanceSettings.thumbnailResolution, 
      performanceSettings.thumbnailResolution * 1.5, 
      priority
    );
    return thumbnailUrl || null;
  } catch (error) {
    console.error('Error getting thumbnail:', error);
    return null;
  }
});

// 获取单个图片的缩略图 - 与get-image-thumbnail功能相同，但为了兼容性添加
ipcMain.handle('get-thumbnail', async (event, imagePath, priority = 0) => {
  try {
    // 使用队列系统处理请求，使用设置中的分辨率
    const thumbnailUrl = await enqueueThumbnailTask(
      imagePath, 
      performanceSettings.thumbnailResolution, 
      performanceSettings.thumbnailResolution * 1.5, 
      priority
    );
    return thumbnailUrl || null;
  } catch (error) {
    console.error('Error getting thumbnail:', error);
    return null;
  }
});

// 批量请求预览图 - 提高效率的新接口
ipcMain.handle('get-batch-thumbnails', async (event, imagePaths, priority = 0) => {
  try {
    const results = {};
    
    // 使用队列系统处理请求，使用设置中的分辨率
    const promises = imagePaths.map(path => 
      enqueueThumbnailTask(
        path, 
        performanceSettings.thumbnailResolution, 
        performanceSettings.thumbnailResolution * 1.5, 
        priority
      )
        .then(url => {
          results[path] = url;
        })
        .catch(err => {
          console.error(`获取缩略图失败: ${path}`, err);
          results[path] = null;
        })
    );
    
    await Promise.all(promises);
    return results;
  } catch (error) {
    console.error('批量获取缩略图失败:', error);
    return {};
  }
});

// 获取缩略图服务器端口
ipcMain.handle('get-thumbnail-server-port', () => {
  return thumbnailServerPort;
});

// 获取相簿中的所有图片
ipcMain.handle('get-album-images', async (event, albumPath) => {
  try {
    const entries = await readdir(albumPath);
    const images = [];
    
    for (const entry of entries) {
      const fullPath = path.join(albumPath, entry);
      try {
        const entryStats = await stat(fullPath);
        
        if (entryStats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
          images.push({
            path: fullPath,
            name: entry,
            size: entryStats.size,
            lastModified: entryStats.mtime
          });
        }
      } catch (err) {
        console.error(`无法访问 ${fullPath}:`, err);
        continue;
      }
    }
    
    return images;
  } catch (error) {
    console.error('Error getting album images:', error);
    return [];
  }
});

// 处理性能设置更新
ipcMain.handle('update-performance-settings', async (event, settings) => {
  try {
    console.log('更新性能设置:', settings);
    
    // 更新并发限制
    CONCURRENT_THUMBNAIL_LIMIT = settings.concurrentTasks || DEFAULT_PERFORMANCE_SETTINGS.concurrentTasks;
    
    // 更新其他设置
    performanceSettings = {
      ...performanceSettings,
      ...settings
    };
    
    return { success: true };
  } catch (error) {
    console.error('更新性能设置失败:', error);
    return { success: false, error: error.message };
  }
});

// 收藏数据文件路径
const FAVORITES_FILE_PATH = path.join(app.getPath('userData'), 'favorites.json');

// 文件监听器
let favoritesWatcher = null;

// 启动文件监听
function startFavoritesWatcher() {
  try {
    if (favoritesWatcher) {
      favoritesWatcher.close();
    }
    
    favoritesWatcher = fs.watch(FAVORITES_FILE_PATH, (eventType, filename) => {
      if (eventType === 'change') {
        // 延迟处理，避免文件写入过程中的竞态条件
        setTimeout(async () => {
          try {
            const favoritesData = await loadFavoritesInternal();
            
            // 广播更新给所有渲染进程
            BrowserWindow.getAllWindows().forEach(window => {
              if (window.webContents && !window.webContents.isDestroyed()) {
                window.webContents.send('favorites-updated', favoritesData);
              }
            });
          } catch (error) {
            console.error('文件监听处理失败:', error);
          }
        }, 100);
      }
    });
  } catch (error) {
    console.error('启动文件监听失败:', error);
  }
}

// 停止文件监听
function stopFavoritesWatcher() {
  if (favoritesWatcher) {
    favoritesWatcher.close();
    favoritesWatcher = null;
  }
}

// 内部加载收藏数据的方法
async function loadFavoritesInternal() {
  try {
    // 检查文件是否存在
    try {
      await stat(FAVORITES_FILE_PATH);
    } catch (err) {
      // 文件不存在，创建默认结构
      const defaultData = {
        albums: [],
        images: [],
        collections: [],
        version: 1,
        lastModified: Date.now()
      };
      await writeFile(FAVORITES_FILE_PATH, JSON.stringify(defaultData, null, 2));
      return defaultData;
    }
    
    // 读取文件
    const data = await readFile(FAVORITES_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('加载收藏数据失败:', error);
    // 返回空的默认结构
    return {
      albums: [],
      images: [],
      collections: [],
      version: 1,
      lastModified: Date.now()
    };
  }
}

// 保存收藏数据 - 带冲突检测的乐观锁机制
ipcMain.handle('save-favorites', async (event, favoritesData, expectedVersion) => {
  try {
    console.log('保存收藏数据');
    
    // 读取当前文件版本
    const currentData = await loadFavoritesInternal();
    
    // 版本冲突检测
    if (expectedVersion !== undefined && currentData.version !== expectedVersion) {
      console.warn('版本冲突检测，当前版本:', currentData.version, '期望版本:', expectedVersion);
      return { 
        success: false, 
        error: '版本冲突，请刷新后重试',
        currentVersion: currentData.version,
        expectedVersion: expectedVersion
      };
    }
    
    // 添加版本控制和元数据
    const enhancedData = {
      ...favoritesData,
      version: (currentData.version || 1) + 1,
      lastModified: Date.now()
    };
    
    await writeFile(FAVORITES_FILE_PATH, JSON.stringify(enhancedData, null, 2));
    
    // 广播更新事件给所有渲染进程（包括发送者，用于确认更新）
    BrowserWindow.getAllWindows().forEach(window => {
      if (window.webContents && !window.webContents.isDestroyed()) {
        window.webContents.send('favorites-updated', enhancedData);
      }
    });
    
    return { success: true, version: enhancedData.version };
  } catch (error) {
    console.error('保存收藏数据失败:', error);
    return { success: false, error: error.message };
  }
});

// 加载收藏数据
ipcMain.handle('load-favorites', async () => {
  return await loadFavoritesInternal();
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