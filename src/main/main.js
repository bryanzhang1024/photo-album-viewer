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

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const mkdir = promisify(fs.mkdir);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// 缩略图缓存目录
const THUMBNAIL_CACHE_DIR = path.join(app.getPath('userData'), 'thumbnail-cache');

// 支持的图片格式
const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

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
  if (getMainWindow() === null) {
    createWindow();
  }
});

// 新的智能导航扫描系统
const SCAN_CONFIG = {
  SAMPLE_LIMIT: 20,      // 采样文件限制
  MAX_PREVIEW_SAMPLES: 4, // 最大预览样本
  MAX_CHILD_SCAN: 10,    // 最大子目录扫描
  TIMEOUT_MS: 2000,      // 超时时间
  PARALLEL_LIMIT: 5      // 并行限制
};

const NODE_TYPES = {
  FOLDER: 'folder',
  ALBUM: 'album', 
  EMPTY: 'empty'
};

/**
 * 智能扫描单层目录，返回导航节点
 * @param {string} targetPath - 目标路径
 * @returns {Promise<Object>} 导航响应
 */
async function scanNavigationLevel(targetPath) {
  const startTime = Date.now();
  
  try {
    const entries = await readdir(targetPath);
    if (entries.length === 0) {
      return createNavigationResponse([], targetPath, path.dirname(targetPath), []);
    }

    const directoryEntries = [];
    const imageFiles = [];

    // 1. 分离文件和目录
    for (const entry of entries) {
      try {
        const fullPath = path.join(targetPath, entry);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          directoryEntries.push(entry);
        } else if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
          imageFiles.push({ path: fullPath, name: entry, stats });
        }
      } catch (err) {
        // 忽略无法访问的条目
        continue;
      }
    }

    // 2. 处理所有子目录
    const nodePromises = directoryEntries.map(entry => processNavigationEntry(targetPath, entry));
    const nodes = (await Promise.all(nodePromises)).filter(Boolean);

    // 3. 如果当前目录有图片，则创建一个“同名相簿”节点
    if (imageFiles.length > 0) {
      imageFiles.sort((a, b) => b.stats.mtime.getTime() - a.stats.mtime.getTime());
      const albumStats = {
        imageCount: imageFiles.length,
        previewImages: imageFiles.slice(0, SCAN_CONFIG.MAX_PREVIEW_SAMPLES).map(f => f.path),
        lastModified: imageFiles.length > 0 ? imageFiles[0].stats.mtime : new Date(),
        firstImageDate: imageFiles.length > 0 ? imageFiles[imageFiles.length - 1].stats.mtime : null,
        totalSize: imageFiles.reduce((sum, img) => sum + img.stats.size, 0),
      };
      const selfAlbumNode = createAlbumNode(targetPath, path.basename(targetPath), albumStats);
      nodes.push(selfAlbumNode);
    }
    
    // 按类型和名称排序：文件夹在前，相册在后
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === NODE_TYPES.FOLDER ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    const parentPath = path.dirname(targetPath);
    const breadcrumbs = generateBreadcrumbs(targetPath);
    
    const response = createNavigationResponse(nodes, targetPath, parentPath, breadcrumbs);
    response.metadata.scanTime = Date.now() - startTime;
    
    console.log(`智能扫描完成: ${targetPath}, 耗时: ${response.metadata.scanTime}ms, 节点: ${nodes.length}`);
    return response;
    
  } catch (error) {
    console.error(`扫描失败 ${targetPath}:`, error);
    return createErrorResponse(error.message, targetPath);
  }
}

/**
 * 处理单个目录项，返回导航节点
 */
async function processNavigationEntry(parentPath, entry) {
  const fullPath = path.join(parentPath, entry);
  
  try {
    const stats = await stat(fullPath);
    
    if (stats.isFile()) {
      return null; // 跳过文件
    }
    
    if (!stats.isDirectory()) {
      return null; // 跳过其他类型
    }
    
    // 检查目录类型
    const nodeType = await determineNodeType(fullPath);
    
    if (nodeType === NODE_TYPES.ALBUM) {
      return createAlbumNode(fullPath, entry, await getAlbumStats(fullPath));
    } else if (nodeType === NODE_TYPES.FOLDER) {
      return createFolderNode(fullPath, entry, await getFolderStats(fullPath));
    }
    
    return null;
    
  } catch (error) {
    console.warn(`跳过无法访问的项目 ${fullPath}:`, error.message);
    return null;
  }
}

/**
 * 确定节点类型：文件夹还是相册
 */
async function determineNodeType(dirPath) {
  try {
    const entries = await readdir(dirPath);
    if (entries.length === 0) return NODE_TYPES.EMPTY;

    let hasSubdirectories = false;
    let hasImages = false;

    // 遍历所有条目来确定是否存在子目录和图片
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const stats = await stat(entryPath);
        if (stats.isDirectory()) {
          hasSubdirectories = true;
          // 发现子目录，可以立即确定是文件夹类型，中断循环
          break;
        } else if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
          hasImages = true;
        }
      } catch {
        // 跳过无法访问的文件或目录
        continue;
      }
    }

    // 核心逻辑：只要有子目录，就一定是文件夹
    if (hasSubdirectories) {
      return NODE_TYPES.FOLDER;
    }

    // 没有子目录，但有图片，是相册
    if (hasImages) {
      return NODE_TYPES.ALBUM;
    }

    // 没有子目录，也没有图片，视为空文件夹
    return NODE_TYPES.EMPTY;

  } catch (error) {
    console.warn(`检查节点类型失败 ${dirPath}:`, error.message);
    return NODE_TYPES.EMPTY;
  }
}

/**
 * 获取相册统计信息
 */
async function getAlbumStats(dirPath) {
  try {
    const entries = await readdir(dirPath);
    const imageFiles = [];
    
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const stats = await stat(entryPath);
        
        if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
          imageFiles.push({
            path: entryPath,
            name: entry,
            size: stats.size,
            lastModified: stats.mtime
          });
        }
      } catch {
        continue; // 跳过无法访问的文件
      }
    }
    
    // 按修改时间排序，取前4张作为预览
    imageFiles.sort((a, b) => b.lastModified - a.lastModified);
    const previewImages = imageFiles.slice(0, SCAN_CONFIG.MAX_PREVIEW_SAMPLES);
    
    return {
      imageCount: imageFiles.length,
      previewImages: previewImages.map(img => img.path),
      firstImageDate: imageFiles.length > 0 ? imageFiles[imageFiles.length - 1].lastModified : null,
      lastImageDate: imageFiles.length > 0 ? imageFiles[0].lastModified : null,
      totalSize: imageFiles.reduce((sum, img) => sum + img.size, 0),
      lastModified: imageFiles.length > 0 ? imageFiles[0].lastModified : new Date()
    };
    
  } catch (error) {
    console.warn(`获取相册统计失败 ${dirPath}:`, error.message);
    return {
      imageCount: 0,
      previewImages: [],
      firstImageDate: null,
      lastImageDate: null,
      totalSize: 0,
      lastModified: new Date()
    };
  }
}

/**
 * 获取文件夹统计信息（采样估算）
 */
async function getFolderStats(dirPath) {
  try {
    const entries = await readdir(dirPath);
    const sampleSize = Math.min(entries.length, SCAN_CONFIG.MAX_CHILD_SCAN);
    const sampleEntries = entries.slice(0, sampleSize);
    
    let folderCount = 0;
    let estimatedImages = 0;
    let previewSamples = [];
    let hasSubAlbums = false;
    let lastModified = new Date(0);
    
    // 并行处理样本
    const promises = sampleEntries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry);
      try {
        const stats = await stat(entryPath);
        
        if (stats.isDirectory()) {
          folderCount++;
          
          // 快速检查子目录是否包含图片
          const quickCheck = await quickScanForImages(entryPath);
          if (quickCheck.hasImages) {
            hasSubAlbums = true;
            estimatedImages += quickCheck.imageCount;
            previewSamples.push(...quickCheck.samples.slice(0, 2));
          }
          
          if (stats.mtime > lastModified) {
            lastModified = stats.mtime;
          }
        }
      } catch {
        // 跳过无法访问的目录
      }
    });
    
    await Promise.all(promises);
    
    // 基于采样估算总数
    if (folderCount > 0 && sampleSize < entries.length) {
      const ratio = entries.length / sampleSize;
      estimatedImages = Math.round(estimatedImages * ratio);
    }
    
    return {
      childFolders: entries.filter(entry => {
        try {
          return require('fs').statSync(path.join(dirPath, entry)).isDirectory();
        } catch {
          return false;
        }
      }).length,
      estimatedImages,
      previewSamples: previewSamples.slice(0, SCAN_CONFIG.MAX_PREVIEW_SAMPLES),
      hasSubAlbums,
      hasMore: entries.length > sampleSize,
      sampleSize,
      lastModified
    };
    
  } catch (error) {
    console.warn(`获取文件夹统计失败 ${dirPath}:`, error.message);
    return {
      childFolders: 0,
      estimatedImages: 0,
      previewSamples: [],
      hasSubAlbums: false,
      hasMore: false,
      sampleSize: 0,
      lastModified: new Date()
    };
  }
}

/**
 * 快速扫描检查目录是否包含图片
 */
async function quickScanForImages(dirPath) {
  try {
    const entries = await readdir(dirPath);
    const sampleEntries = entries.slice(0, 10); // 只检查前10个
    
    const samples = [];
    let imageCount = 0;
    
    for (const entry of sampleEntries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const stats = await stat(entryPath);
        
        if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
          samples.push(entryPath);
          imageCount++;
          
          if (samples.length >= 2) break; // 只需要2个样本
        }
      } catch {
        continue;
      }
    }
    
    // 如果样本不足，估算总数
    if (imageCount > 0 && sampleEntries.length === 10 && entries.length > 10) {
      imageCount = Math.round(imageCount * (entries.length / 10));
    }
    
    return {
      hasImages: samples.length > 0,
      imageCount,
      samples
    };
    
  } catch {
    return {
      hasImages: false,
      imageCount: 0,
      samples: []
    };
  }
}

/**
 * 生成面包屑导航
 */
function generateBreadcrumbs(currentPath) {
  const breadcrumbs = [];
  const parts = currentPath.split(path.sep).filter(Boolean);
  
  let buildPath = '';
  for (let i = 0; i < parts.length; i++) {
    buildPath = path.join(buildPath, parts[i]);
    if (buildPath === '') buildPath = path.sep; // 处理根路径
    
    breadcrumbs.push({
      name: parts[i],
      path: buildPath
    });
  }
  
  return breadcrumbs;
}

/**
 * 创建导航响应
 */
function createNavigationResponse(nodes, currentPath, parentPath, breadcrumbs) {
  return {
    success: true,
    nodes,
    currentPath,
    parentPath,
    breadcrumbs,
    error: null,
    metadata: {
      totalNodes: nodes.length,
      folderCount: nodes.filter(n => n.type === NODE_TYPES.FOLDER).length,
      albumCount: nodes.filter(n => n.type === NODE_TYPES.ALBUM).length,
      totalImages: nodes.reduce((sum, n) => sum + (n.imageCount || 0), 0),
      scanTime: 0 // 将在调用处设置
    }
  };
}

/**
 * 创建错误响应
 */
function createErrorResponse(message, currentPath) {
  return {
    success: false,
    nodes: [],
    currentPath,
    parentPath: '',
    breadcrumbs: [],
    error: {
      message,
      timestamp: Date.now()
    },
    metadata: null
  };
}

/**
 * 创建文件夹节点
 */
function createFolderNode(path, name, stats) {
  return {
    path,
    name,
    type: NODE_TYPES.FOLDER,
    hasImages: false,
    imageCount: stats.estimatedImages || 0,
    childFolders: stats.childFolders || 0,
    samples: stats.previewSamples || [],
    lastModified: stats.lastModified || new Date(),
    // 文件夹特有属性
    estimatedImages: stats.estimatedImages || 0,
    previewSamples: stats.previewSamples || [],
    hasSubAlbums: stats.hasSubAlbums || false,
    quickStats: {
      hasMore: stats.hasMore || false,
      sampleSize: stats.sampleSize || 0
    }
  };
}

/**
 * 创建相册节点
 */
function createAlbumNode(path, name, stats) {
  return {
    path,
    name,
    type: NODE_TYPES.ALBUM,
    hasImages: true,
    imageCount: stats.imageCount || 0,
    childFolders: 0,
    samples: stats.previewImages || [],
    lastModified: stats.lastModified || new Date(),
    // 相册特有属性
    previewImages: stats.previewImages || [],
    firstImageDate: stats.firstImageDate || null,
    lastImageDate: stats.lastImageDate || null,
    totalSize: stats.totalSize || 0
  };
}

// 保留旧的扫描函数用于兼容性，标记为已废弃
async function scanDirectories(rootPath) {
  console.warn('scanDirectories 已废弃，请使用 scanNavigationLevel');
  const response = await scanNavigationLevel(rootPath);
  // 转换为旧格式以保持兼容性
  return response.nodes.filter(node => node.type === NODE_TYPES.ALBUM);
}

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
    const response = await scanNavigationLevel(targetPath);
    console.log(`扫描完成: ${response.metadata ? `${response.metadata.totalNodes} 个节点，耗时 ${response.metadata.scanTime}ms` : '扫描失败'}`);
    return response;
  } catch (error) {
    console.error('智能扫描错误:', error);
    return createErrorResponse(error.message, targetPath);
  }
});

// 处理扫描文件夹请求（兼容性保留）
ipcMain.handle('scan-directory', async (event, rootPath) => {
  try {
    console.log(`开始扫描文件夹: ${rootPath}（兼容模式）`);
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