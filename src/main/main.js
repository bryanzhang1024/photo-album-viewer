const { resolveBrowserImage } = require('./services/ImagePreviewService');
const { app, ipcMain, dialog, shell, session, Menu, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const isDev = require('electron-is-dev');
const { promisify } = require('util');
const http = require('http');
const sharp = require('sharp');
const crypto = require('crypto');
const { createWindow, getMainWindow, windows } = require('./services/WindowService');
const FileSystemService = require('./services/FileSystemService');
const DirectorySnapshotService = require('./services/DirectorySnapshotService');
const { resetLegacyNavigationFiles } = require('./services/NavigationStateCutover');
const ThumbnailService = require('./services/ThumbnailService');
const FavoritesService = require('./services/FavoritesService');
const {
  resolvePortableRelativePath
} = require('../common/path-codec');
const { createSourceRootService } = require('./services/SourceRootService');
const { createFolderCoverService } = require('./services/FolderCoverService');
const { createPathApprovalService, isFilesystemRootPath } = require('./services/PathApprovalService');
const { buildAppMenu } = require('./services/AppMenu');
const { CosLibraryService } = require('./services/CosLibraryService');
const { registerCosLibraryIpcHandlers } = require('./services/CosLibraryIpc');
const {
  createNavigationTargetForSource,
  createVirtualComputerRootResponse,
  ensureComputerRootSource
} = require('./services/ComputerRootNavigationService');
const CHANNELS = require(path.join(__dirname, '..', 'common', 'ipc-channels.js'));
const {
  createDirectoryErrorEnvelopeV1,
  createDirectorySuccessEnvelopeV1,
  validateDirectoryEnvelopeV1,
  validateDirectoryLevelRequestV1
} = require('../common/contracts/directory-contract-v1');
const {
  createNavigationErrorEnvelopeV1,
  createNavigationSuccessEnvelopeV1,
  validateLoadSourceRootsRequestV1,
  validateNavigationTargetV1,
  validateSaveSourceRootRequestV1,
  validateSourceRootsEnvelopeV1
} = require('../common/contracts/navigation-contract-v1');

const folderCoverService = createFolderCoverService();

const sourceRootService = createSourceRootService({
  registryPath: path.join(app.getPath('userData'), 'library-sources-v3.json')
});
FavoritesService.registerIpcHandlers({ sourceRootService });

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

// Cos 索引预热延迟。
//
// cos-library-catalog-v1.json 实测 105MB，readFile 后还要在主线程做 JSON.parse
// （实测 ~140ms 同步阻塞、堆 +235MB）。原先挂在 did-finish-load 上，正好和用户
// 第一次点击抢占主进程，于是首屏刚出来就卡一下。延后到首屏安静下来再预热，
// 用户在几秒内点进 Cos 图库时索引通常已就绪。
const COS_PREWARM_DELAY_MS = Number(process.env.COS_PREWARM_DELAY_MS || 5000);
let cosPrewarmTimer = null;

function scheduleCosPrewarm() {
  if (cosPrewarmTimer) {
    clearTimeout(cosPrewarmTimer);
  }

  cosPrewarmTimer = setTimeout(() => {
    cosPrewarmTimer = null;
    const startedAt = Date.now();
    cosLibraryService
      .initialize()
      .then(() => {
        console.log(`[Cos] 缓存预热完成，耗时 ${Date.now() - startedAt}ms（首屏后延迟 ${COS_PREWARM_DELAY_MS}ms 启动）`);
      })
      .catch(error => console.warn('[Cos] 缓存预热失败:', error?.message));
  }, COS_PREWARM_DELAY_MS);

  if (typeof cosPrewarmTimer.unref === 'function') {
    cosPrewarmTimer.unref();
  }
}

const cosLibraryService = new CosLibraryService({
  configPath: path.join(app.getPath('userData'), 'cos-library-roots-v1.json'),
  cachePath: path.join(app.getPath('userData'), 'cos-library-catalog-v1.json')
});
registerCosLibraryIpcHandlers({
  ipcMain,
  service: cosLibraryService,
  dialog,
  shell,
  thumbnailService: ThumbnailService,
  registerApprovedRoot,
  getMainWindow,
  thumbnailResolution: () => performanceSettings.thumbnailResolution,
  broadcast: (channel, payload) => {
    for (const window of windows) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload);
    }
  }
});

const thumbnailProtocolStats = {
  requestCount: 0,
  hitCount: 0,
  missCount: 0
};

const THUMBNAIL_PROTOCOL_PREFIX = 'thumbnail-protocol://';
const LOCAL_IMAGE_PROTOCOL_PREFIX = 'local-image-protocol://';
const LOCAL_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.jfif', '.tif', '.tiff', '.heic', '.heif', '.avif']);
const DELETE_IMAGE_EXTENSIONS = new Set(FileSystemService.SUPPORTED_FORMATS || ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']);
const APPROVED_ROOTS_FILE = path.join(app.getPath('userData'), 'approved-roots-v3.json');
// 仅当测试进程显式设置该变量时才注入；生产环境不会有这个变量
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
  const prefix = normalizedRootPath.endsWith(path.sep) ? normalizedRootPath : `${normalizedRootPath}${path.sep}`;
  return (
    normalizedTargetPath === normalizedRootPath
    || normalizedTargetPath.startsWith(prefix)
  );
}

const testApprovedRoots = process.env.PAV_TEST_APPROVED_ROOTS
  ? process.env.PAV_TEST_APPROVED_ROOTS.split(path.delimiter).filter(Boolean)
  : [];
const pathApproval = createPathApprovalService({
  rootsFilePath: APPROVED_ROOTS_FILE,
  extraRoots: testApprovedRoots
});

/** 登记一个允许访问的目录（用户主动选择目录、加载已有来源时调用）。 */
function registerApprovedRoot(candidatePath, options) {
  return pathApproval.register(candidatePath, options);
}

/** 移除一个允许访问的目录（来源被移除且没有其他来源复用同一根时调用）。 */
function unregisterApprovedRoot(candidatePath) {
  return pathApproval.unregister(candidatePath);
}

async function loadApprovedRoots() {
  await pathApproval.load();
}

/**
 * 读取/写入前的授权判断：目标必须落在已登记的根目录内（按 realpath 解析后比较）。
 * bootstrapWhenEmpty 只允许用户主动选择目录的入口使用。
 */
async function assertApprovedPath(targetPath, options) {
  return pathApproval.assert(targetPath, options);
}

async function isPathWithinApprovedRoots(targetPath) {
  return pathApproval.isWithin(targetPath);
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

function escapePlistString(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createPlistArray(values) {
  const items = values
    .map((value) => `\t<string>${escapePlistString(value)}</string>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<array>',
    items,
    '</array>',
    '</plist>',
    ''
  ].join('\n');
}

// 单实例锁定 - 允许多窗口
const gotTheLock = app.requestSingleInstanceLock();

function createRootNavigationTarget(source) {
  return {
    sourceId: source.sourceId,
    relativePath: '',
    viewMode: 'browse',
    initialMediaRelativePath: null
  };
}

let computerRootSource = null;

async function getComputerRootSource() {
  if (process.platform !== 'darwin') return null;
  if (!computerRootSource) {
    computerRootSource = await ensureComputerRootSource(sourceRootService);
  }
  return computerRootSource;
}

async function createFolderLaunchTarget(folderPath) {
  let launchTarget = null;
  try {
    const source = await getComputerRootSource();
    if (source) {
      launchTarget = createNavigationTargetForSource(source, {
        absolutePath: folderPath,
        viewMode: 'browse'
      });
    } else {
      const result = await sourceRootService.saveSourceRoot({
        sourceId: null,
        rootPath: folderPath,
        label: null
      });
      launchTarget = createRootNavigationTarget(result.source);
    }
  } catch (error) {
    console.warn('[SourceRoot] 创建来源失败:', error?.message || error);
  }
  const registered = await registerApprovedRoot(folderPath);
  return registered ? launchTarget : null;
}

if (!gotTheLock) {
  // 如果没有获得锁，说明已经有实例在运行
  // 在这种情况下，我们让第二个实例退出，但主实例会处理新窗口创建
  app.quit();
} else {
  // 主实例获得锁，监听第二个实例启动
  app.on('second-instance', async (event, commandLine, workingDirectory) => {
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
    const launchTarget = albumPath
      ? await createFolderLaunchTarget(albumPath)
      : null;

    if (albumPath && !launchTarget) {
      dialog.showErrorBox?.('打开来源失败', '无法建立照片来源，请检查目录是否可访问。');
      return;
    }

    // 创建新窗口
    const newWindow = createWindow(launchTarget);
    
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
  // 先换掉 Electron 默认菜单，避免 ⌘W/⌘R/⌘+/⌘C 被系统菜单抢走
  Menu.setApplicationMenu(buildAppMenu({
    send: (command) => {
      const focused = BrowserWindow.getFocusedWindow() || getMainWindow();
      focused?.webContents?.send(CHANNELS.MENU_COMMAND, { command });
    }
  }));

  const cleanup = await resetLegacyNavigationFiles(app.getPath('userData'));
  for (const { fileName, error } of cleanup.failed) {
    console.warn(`[Navigation v3] 清理旧导航文件失败: ${fileName}`, error?.message || error);
  }
  // 说明：以前启动时自动创建「电脑」来源（根目录 /），这等于默认授权整盘。
  // 现在改为只在用户主动打开（--folder）或自己添加来源时才建立，
  // 已有来源的机器不受影响。
  await loadApprovedRoots();
  // 把来源注册表里的根补登记到访问白名单，老用户升级后不用重新选目录
  try {
    const existingSources = await sourceRootService.listSourceRoots();
    const unsafeSources = [];
    for (const source of (Array.isArray(existingSources) ? existingSources : [])) {
      if (!source?.rootPath) continue;
      if (isFilesystemRootPath(source.rootPath)) {
        // 整盘根目录等于默认授权一切，不再作为合法来源
        unsafeSources.push(source);
        continue;
      }
      await registerApprovedRoot(source.rootPath, { persist: false });
    }
    for (const source of unsafeSources) {
      try {
        await sourceRootService.removeSourceRoot(source.sourceId);
        console.warn('[Security] 已移除整盘根来源:', source.rootPath);
      } catch (error) {
        console.warn('[Security] 移除整盘根来源失败:', error?.message || error);
      }
    }
  } catch (error) {
    console.warn('[Security] 补登记来源目录失败:', error?.message || error);
  }
  // Cos 图库根目录同样要进白名单（它可能不在任何照片来源之下）
  try {
    const cosRootsFile = path.join(app.getPath('userData'), 'cos-library-roots-v1.json');
    const raw = await fs.promises.readFile(cosRootsFile, 'utf8');
    const parsed = JSON.parse(raw);
    for (const root of Array.isArray(parsed?.roots) ? parsed.roots : []) {
      if (root?.path) await registerApprovedRoot(root.path, { persist: false });
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[Security] 补登记 Cos 图库目录失败:', error?.message || error);
    }
  }
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

    Promise.resolve(isPathWithinApprovedRoots(normalizedPath)).then((allowed) => {
      if (!allowed) {
        callback(-10); // ACCESS_DENIED
        return;
      }
      fs.promises.stat(normalizedPath)
      .then(async (stats) => {
        if (!stats.isFile()) {
          callback(-6); // FILE_NOT_FOUND
          return;
        }
        const previewPath = await resolveBrowserImage(normalizedPath, path.join(app.getPath('userData'), 'thumbnail-cache', 'full-preview'));
        callback({ path: previewPath });
      })
      .catch(() => {
        callback(-6); // FILE_NOT_FOUND
      });
    });
  });
  
  // 处理命令行参数，使用指定的文件夹路径
  const initialPath = handleCommandLine();
  console.log('启动时的初始路径:', initialPath);
  const launchTarget = initialPath
    ? await createFolderLaunchTarget(initialPath)
    : null;
  if (initialPath && !launchTarget) {
    dialog.showErrorBox?.('打开来源失败', '无法建立照片来源，应用将打开空白主页。');
  }

  const initialWindow = createWindow(launchTarget);
  initialWindow.webContents.once('did-finish-load', scheduleCosPrewarm);
  
  // 启动收藏数据文件监听
  await FavoritesService.startFavoritesWatcher();
});

// 应用退出时清理资源
app.on('before-quit', () => {
  if (cosPrewarmTimer) {
    clearTimeout(cosPrewarmTimer);
    cosPrewarmTimer = null;
  }
  FavoritesService.stopFavoritesWatcher();
});

app.on('window-all-closed', () => {
  // macOS 默认是留在 Dock 里，但用户要求「点关闭就彻底退出、不留看不见的后台进程」，
  // 所以所有平台在最后一个窗口关闭后都退出应用。
  app.quit();
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
      const registered = await registerApprovedRoot(selectedDirectory);
      return registered ? selectedDirectory : null;
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
    const isAllowed = await assertApprovedPath(targetPath);
    if (!isAllowed) {
      return FileSystemService.createErrorResponse('访问路径不在已授权照片目录范围内', targetPath);
    }

    const scanId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sender = event.sender;
    const concurrencyLimit = Math.max(
      1,
      Math.min(8, Number(performanceSettings.concurrentTasks) || 5)
    );

    const sendProgress = (payload) => {
      if (sender.isDestroyed()) {
        return;
      }
      sender.send(CHANNELS.SCAN_NAVIGATION_PROGRESS, {
        scanId,
        targetPath,
        ...payload
      });
    };

    console.log(`开始智能扫描: ${targetPath}`);
    const virtualRootResponse = createVirtualComputerRootResponse(targetPath);
    const response = virtualRootResponse || await FileSystemService.scanNavigationLevel(
      targetPath,
      {
        concurrencyLimit,
        onProgress: (progress) => {
          sendProgress({
            done: false,
            processed: progress.processed,
            total: progress.total,
            phase: progress.phase
          });
        }
      }
    );

    sendProgress({
      done: true,
      processed: response.metadata?.totalNodes || 0,
      total: response.metadata?.totalNodes || 0,
      phase: 'done'
    });

    console.log(`扫描完成: ${response.metadata ? `${response.metadata.totalNodes} 个节点，耗时 ${response.metadata.scanTime}ms` : '扫描失败'}`);
    return response;
  } catch (error) {
    console.error('智能扫描错误:', error);
    return FileSystemService.createErrorResponse(error.message, targetPath);
  }
});

function finalizeDirectoryEnvelopeV1(envelope) {
  const validation = validateDirectoryEnvelopeV1(envelope);
  if (validation.valid) {
    return envelope;
  }

  return createDirectoryErrorEnvelopeV1(
    'INVALID_RESPONSE',
    'Invalid directory response',
    {
      retryable: false,
      details: { issues: validation.issues }
    }
  );
}

function finalizeNavigationEnvelopeV1(envelope) {
  const validation = validateSourceRootsEnvelopeV1(envelope);
  if (validation.valid) {
    return envelope;
  }

  return createNavigationErrorEnvelopeV1(
    'INVALID_RESPONSE',
    'Invalid SourceRoot response',
    { retryable: false }
  );
}

function createNavigationRequestErrorEnvelope(validation) {
  const versionIssue = validation.issues.find(
    (issue) => issue.path === '$.contractVersion' && issue.code === 'enum'
  );
  const selectedIssue = versionIssue || validation.issues[0];
  return finalizeNavigationEnvelopeV1(createNavigationErrorEnvelopeV1(
    versionIssue ? 'UNSUPPORTED_CONTRACT_VERSION' : 'INVALID_REQUEST',
    versionIssue ? 'Unsupported contract version' : (selectedIssue?.message || 'Invalid request'),
    { retryable: false }
  ));
}

const SOURCE_ROOT_SERVICE_ERROR_RETRYABILITY = new Map([
  ['SOURCE_ROOT_REGISTRY_READ_FAILED', true],
  ['SOURCE_ROOT_REGISTRY_CORRUPT', false],
  ['SOURCE_ROOT_PERSIST_FAILED', true],
  ['INVALID_SOURCE_ROOT_REQUEST', false],
  ['SOURCE_ROOT_MISSING', false],
  ['SOURCE_ROOT_UNAVAILABLE', true],
  ['SOURCE_ROOT_NOT_DIRECTORY', false],
  ['SOURCE_ROOT_ID_UNAVAILABLE', true],
  ['SOURCE_ROOT_NOT_FOUND', false],
  ['SOURCE_ROOT_CONFLICT', false],
  ['SOURCE_ROOT_GENERATION_EXHAUSTED', false],
  ['SOURCE_ROOT_SERVICE_NOT_INITIALIZED', true]
]);

function createSourceRootServiceErrorEnvelope(error) {
  if (SOURCE_ROOT_SERVICE_ERROR_RETRYABILITY.has(error?.code)
      && typeof error?.message === 'string' && error.message.length > 0) {
    return finalizeNavigationEnvelopeV1(createNavigationErrorEnvelopeV1(
      error.code,
      error.message,
      { retryable: SOURCE_ROOT_SERVICE_ERROR_RETRYABILITY.get(error.code) }
    ));
  }

  return finalizeNavigationEnvelopeV1(createNavigationErrorEnvelopeV1(
    'INTERNAL_ERROR',
    'SourceRoot operation failed',
    { retryable: false }
  ));
}

ipcMain.handle(CHANNELS.LOAD_SOURCE_ROOTS_V1, async (event, request) => {
  const validation = validateLoadSourceRootsRequestV1(request);
  if (!validation.valid) {
    return createNavigationRequestErrorEnvelope(validation);
  }

  try {
    const sources = await sourceRootService.listSourceRoots();
    return finalizeNavigationEnvelopeV1(createNavigationSuccessEnvelopeV1({ sources }));
  } catch (error) {
    return createSourceRootServiceErrorEnvelope(error);
  }
});

ipcMain.handle(CHANNELS.SAVE_SOURCE_ROOT_V1, async (event, request) => {
  const validation = validateSaveSourceRootRequestV1(request);
  if (!validation.valid) {
    return createNavigationRequestErrorEnvelope(validation);
  }

  try {
    const realRequestRoot = await fs.promises.realpath(request.rootPath).catch(() => null);
    if (isFilesystemRootPath(request.rootPath)
      || (realRequestRoot && isFilesystemRootPath(realRequestRoot))) {
      return createSourceRootServiceErrorEnvelope(Object.assign(
        new Error('不支持把整盘根目录加为照片来源，请选择具体文件夹'),
        { code: 'UNSAFE_SOURCE_ROOT' }
      ));
    }
    const result = await sourceRootService.saveSourceRoot({
      sourceId: request.sourceId,
      rootPath: request.rootPath,
      label: request.label
    });
    await registerApprovedRoot(result.source.rootPath);
    return finalizeNavigationEnvelopeV1(createNavigationSuccessEnvelopeV1(result));
  } catch (error) {
    return createSourceRootServiceErrorEnvelope(error);
  }
});

ipcMain.handle(CHANNELS.REORDER_SOURCE_ROOTS_V1, async (event, request) => {
  if (!request || typeof request !== 'object' || request.contractVersion !== 1
    || !Array.isArray(request.sourceIds)) {
    return createNavigationRequestErrorEnvelope({
      valid: false,
      issues: [{ path: '$.sourceIds', code: 'invalid', message: 'sourceIds is required' }]
    });
  }
  try {
    const result = await sourceRootService.reorderSourceRoots(request.sourceIds);
    return finalizeNavigationEnvelopeV1(createNavigationSuccessEnvelopeV1({ sources: result.sources }));
  } catch (error) {
    return createSourceRootServiceErrorEnvelope(error);
  }
});

ipcMain.handle(CHANNELS.REMOVE_SOURCE_ROOT_V1, async (event, request) => {
  const sourceId = request && typeof request.sourceId === 'string' ? request.sourceId : null;
  if (sourceId === null) {
    return createNavigationRequestErrorEnvelope({
      valid: false,
      issues: [{ path: '$.sourceId', code: 'type', message: 'sourceId must be a string' }]
    });
  }

  try {
    const result = await sourceRootService.removeSourceRoot(sourceId);
    // 没有其他来源复用同一根时，把它从访问白名单里撤掉
    try {
      const remaining = await sourceRootService.listSourceRoots();
      const stillUsed = remaining.some((item) => item.rootPath === result.source.rootPath);
      if (!stillUsed) await unregisterApprovedRoot(result.source.rootPath);
    } catch (error) {
      console.warn('[Security] 撤销来源目录失败:', error?.message || error);
    }
    // 复用 save 的成功数据契约：{ source, created }。删除没有创建，created 固定 false。
    return finalizeNavigationEnvelopeV1(createNavigationSuccessEnvelopeV1({
      source: result.source,
      created: false
    }));
  } catch (error) {
    return createSourceRootServiceErrorEnvelope(error);
  }
});

ipcMain.handle(CHANNELS.GET_DIRECTORY_LEVEL_V1, async (event, request) => {
  const validation = validateDirectoryLevelRequestV1(request);
  if (!validation.valid) {
    const versionIssue = validation.issues.find(
      (issue) => issue.path === '$.contractVersion' && issue.code === 'enum'
    );
    const sourceIssue = validation.issues.find(
      (issue) => issue.path === '$.ref.sourceId' && issue.code === 'invariant'
    );
    const selectedIssue = versionIssue || sourceIssue || validation.issues[0];
    const code = versionIssue
      ? 'UNSUPPORTED_CONTRACT_VERSION'
      : (sourceIssue ? 'SOURCE_ID_MISMATCH' : 'INVALID_REQUEST');
    return finalizeDirectoryEnvelopeV1(
      createDirectoryErrorEnvelopeV1(code, selectedIssue?.message || 'Invalid request', {
        retryable: false,
        details: { issues: validation.issues }
      })
    );
  }

  try {
    const source = await sourceRootService.getSourceRoot(request.ref.sourceId);
    if (!source) {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('SOURCE_NOT_FOUND', 'Source root not found', {
          retryable: false
        })
      );
    }
    const authoritativeRequest = {
      contractVersion: request.contractVersion,
      runtimeSource: { sourceId: request.ref.sourceId, rootPath: source.rootPath },
      ref: request.ref
    };
    const locator = DirectorySnapshotService.resolveDirectoryLocatorV1(authoritativeRequest);
    const isAllowed = await assertApprovedPath(locator.absolutePath);
    if (!isAllowed) {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('PATH_NOT_APPROVED', 'Path not approved', {
          retryable: false
        })
      );
    }
    const concurrencyLimit = Math.max(
      1,
      Math.min(8, Number(performanceSettings.concurrentTasks) || 5)
    );
    const snapshot = await DirectorySnapshotService.scanDirectorySnapshot(locator, {
      concurrencyLimit
    });
    return finalizeDirectoryEnvelopeV1(createDirectorySuccessEnvelopeV1(snapshot));
  } catch (error) {
    const sourceCode = error?.code;
    if (sourceCode === 'INVALID_RESPONSE') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1(
          'INVALID_RESPONSE',
          'Invalid directory response',
          { retryable: false }
        )
      );
    }
    if (sourceCode === 'ENOENT' || sourceCode === 'ENOTDIR') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1(sourceCode, error.message, { retryable: false })
      );
    }
    if (sourceCode === 'EACCES' || sourceCode === 'EPERM') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('EACCES', error.message, { retryable: false })
      );
    }
    if (sourceCode === 'EIO' || sourceCode === 'ESTALE' || sourceCode === 'ETIMEDOUT') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1('IO_ERROR', error.message, { retryable: true })
      );
    }
    if (sourceCode === 'PATH_OUTSIDE_SOURCE' || sourceCode === 'INVALID_REQUEST') {
      return finalizeDirectoryEnvelopeV1(
        createDirectoryErrorEnvelopeV1(sourceCode, error.message, { retryable: false })
      );
    }
    return finalizeDirectoryEnvelopeV1(
      createDirectoryErrorEnvelopeV1('INTERNAL_ERROR', 'Directory scan failed', {
        retryable: false
      })
    );
  }
});

ipcMain.handle(CHANNELS.RESOLVE_DROPPED_FOLDERS, async (event, droppedPaths) => {
  const folders = [];
  const rejected = [];
  const candidates = Array.isArray(droppedPaths) ? droppedPaths : [];

  for (const candidatePath of candidates) {
    const normalizedPath = normalizeAbsolutePath(candidatePath);
    if (!normalizedPath) {
      rejected.push(candidatePath);
      continue;
    }

    try {
      const stats = await fs.promises.stat(normalizedPath);
      if (!stats.isDirectory()) {
        rejected.push(normalizedPath);
        continue;
      }

      const registered = await registerApprovedRoot(normalizedPath);
      if (registered) {
        folders.push(normalizedPath);
      } else {
        rejected.push(normalizedPath);
      }
    } catch (error) {
      rejected.push(normalizedPath);
    }
  }

  return { folders, rejected };
});

// 获取图片的缩略图 - 使用新的服务
ipcMain.handle(CHANNELS.GET_IMAGE_THUMBNAIL, async (event, imagePath, priority = 0) => {
    const isAllowed = await assertApprovedPath(imagePath);
    if (!isAllowed) {
      return null;
    }
    return ThumbnailService.generateThumbnail(imagePath, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5, priority);
});

// 获取单个图片的缩略图 - 与get-image-thumbnail功能相同，但为了兼容性添加
ipcMain.handle(CHANNELS.GET_THUMBNAIL, async (event, imagePath, priority = 0) => {
    const isAllowed = await assertApprovedPath(imagePath);
    if (!isAllowed) {
      return null;
    }
    return ThumbnailService.generateThumbnail(imagePath, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5, priority);
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

    const promises = approvedPaths.map(p => ThumbnailService.generateThumbnail(p, performanceSettings.thumbnailResolution, performanceSettings.thumbnailResolution * 1.5, priority).then(url => ({[p]: url})));
    const results = await Promise.all(promises);
    return Object.assign({}, ...results);
});

// 取消尚未开始的缩略图请求（用户已经划走的图块）
//
// 这是纯减法操作：只从队列里摘掉还没开始的任务，不读取任何文件。
// 因此这里不做 assertApprovedPath 逐路径审批 —— 那会给滚动热路径引入
// 与路径数成正比的串行 IO，且取消行为本身不会扩大任何访问权限。
ipcMain.handle(CHANNELS.CANCEL_THUMBNAILS, async (event, imagePaths) => {
    if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
      return { requested: 0, cancelled: 0, inFlight: 0 };
    }

    const normalizedPaths = [];
    for (const imagePath of imagePaths) {
      const normalized = normalizeAbsolutePath(imagePath);
      if (normalized) {
        normalizedPaths.push(normalized);
      }
    }

    return ThumbnailService.cancelPending(normalizedPaths);
});



ipcMain.handle(CHANNELS.GET_ALBUM_IMAGES, async (event, albumPath, options) => {
    const isAllowed = await assertApprovedPath(albumPath);
    if (!isAllowed) {
      if (options && typeof options === 'object') {
        return {
          success: false,
          albumPath,
          images: [],
          totalCount: 0,
          offset: 0,
          limit: FileSystemService.DEFAULT_ALBUM_PAGE_SIZE,
          hasMore: false,
          globalIndex: null,
          error: 'Path not approved'
        };
      }
      return [];
    }

    if (options && typeof options === 'object') {
      return FileSystemService.getAlbumImagesPage(albumPath, options);
    }

    return FileSystemService.getAlbumImages(albumPath);
});

ipcMain.handle(CHANNELS.GET_ALBUM_IMAGE_COUNT, async (event, albumPath) => {
    const isAllowed = await assertApprovedPath(albumPath);
    if (!isAllowed) {
      return { success: false, count: 0, error: 'Path not approved' };
    }
    return FileSystemService.getAlbumImageCount(albumPath);
});

// 列出当前目录的非图片文件（视频、压缩包等），供列表视图显示
ipcMain.handle(CHANNELS.GET_FOLDER_COVER_V1, async (event, request) => {
  const rootPath = request && typeof request.rootPath === 'string' ? request.rootPath : '';
  const relativePath = request && typeof request.relativePath === 'string' ? request.relativePath : '';
  if (!rootPath) {
    return { success: false, error: '缺少来源根目录', samples: [] };
  }
  try {
    const normalizedRoot = normalizeAbsolutePath(rootPath);
    if (!normalizedRoot) {
      return { success: false, error: '来源根目录不可用', samples: [] };
    }
    // 根目录 / 不当作照片来源：否则任何路径都算「在其之下」
    if (normalizedRoot === path.parse(normalizedRoot).root) {
      return { success: false, error: '根目录不能作为封面来源', samples: [] };
    }

    // 只接受「注册过的照片来源根」，而不是任意位于白名单内的目录：
    // 否则调用方可以拿 /tmp 之类被上层根覆盖的路径来枚举。
    const sources = await sourceRootService.listSourceRoots();
    const realRoot = await fs.promises.realpath(normalizedRoot).catch(() => normalizedRoot);
    const isRegisteredSource = sources.some((source) => {
      const sourceRoot = normalizeAbsolutePath(source?.rootPath);
      return sourceRoot === null ? false : sourceRoot === normalizedRoot || source.rootPath === realRoot;
    });
    if (!isRegisteredSource) {
      return { success: false, error: '不是已注册的照片来源', samples: [] };
    }

    const absolute = resolvePortableRelativePath(normalizedRoot, relativePath);
    const isAllowed = await assertApprovedPath(absolute);
    if (!isAllowed) {
      return { success: false, error: '路径不在已授权目录范围内', samples: [] };
    }
    const result = await folderCoverService.findCover(normalizedRoot, relativePath);
    return { success: true, samples: result.samples, truncated: result.truncated };
  } catch (error) {
    return { success: false, error: error?.message || '读取封面失败', samples: [] };
  }
});

ipcMain.handle(CHANNELS.LIST_DIRECTORY_FILES_V1, async (event, directoryPath) => {
  const isAllowed = await assertApprovedPath(directoryPath);
  if (!isAllowed) {
    return { success: false, files: [], error: '访问路径不在已授权照片目录范围内' };
  }
  try {
    const files = await FileSystemService.listDirectoryFiles(directoryPath);
    return { success: true, files };
  } catch (error) {
    return { success: false, files: [], error: error?.message || '读取目录文件失败' };
  }
});

// 用系统默认程序打开文件（视频、压缩包等）；只允许已授权根内的路径
ipcMain.handle(CHANNELS.OPEN_PATH_EXTERNAL, async (event, filePath) => {
  const isAllowed = await assertApprovedPath(filePath);
  if (!isAllowed) {
    return { success: false, error: '访问路径不在已授权照片目录范围内' };
  }
  try {
    const errorMessage = await shell.openPath(filePath);
    return errorMessage ? { success: false, error: errorMessage } : { success: true };
  } catch (error) {
    return { success: false, error: error?.message || '打开文件失败' };
  }
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

// 将图片移到系统废纸篓
ipcMain.handle(CHANNELS.TRASH_IMAGE, async (event, filePath) => {
  try {
    const normalizedPath = normalizeAbsolutePath(filePath);
    if (!normalizedPath) {
      return { success: false, error: '无效的图片路径' };
    }

    const isAllowed = await assertApprovedPath(normalizedPath);
    if (!isAllowed) {
      return { success: false, error: '访问路径不在已授权照片目录范围内' };
    }

    const stats = await fs.promises.stat(normalizedPath).catch(() => {
      throw new Error('图片文件不存在');
    });

    if (!stats.isFile()) {
      return { success: false, error: '目标不是图片文件' };
    }

    const extension = path.extname(normalizedPath).toLowerCase();
    if (!DELETE_IMAGE_EXTENSIONS.has(extension)) {
      return { success: false, error: '不支持删除此文件类型' };
    }

    await shell.trashItem(normalizedPath);
    FileSystemService.clearAlbumImageMetadataCache(path.dirname(normalizedPath));
    return { success: true, filePath: normalizedPath };
  } catch (error) {
    console.error('移动图片到废纸篓失败:', error);
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
        clipboard.clear();

        // Match macOS file pasteboard data closely so web upload targets treat it as a file.
        const fileReferenceFormats = [
          ['NSFilenamesPboardType', Buffer.from(createPlistArray([filePath]), 'utf8')]
        ];

        for (const [format, buffer] of fileReferenceFormats) {
          try {
            clipboard.writeBuffer(format, buffer);
          } catch (error) {
            console.warn(`写入 ${format} 失败:`, error?.message || error);
          }
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

function invalidWindowLaunchTarget() {
  return new TypeError('Invalid window launch target');
}

function parseWindowLaunchPayload(payload, { allowEmpty = false } = {}) {
  if (payload === null || typeof payload === 'undefined') {
    if (allowEmpty) return { kind: 'empty', launchTarget: null };
    throw invalidWindowLaunchTarget();
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw invalidWindowLaunchTarget();
  }

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(payload);
    keys = Reflect.ownKeys(payload);
  } catch (_error) {
    throw invalidWindowLaunchTarget();
  }
  if ((prototype !== Object.prototype && prototype !== null)
      || keys.length !== 2
      || !keys.includes('contractVersion')
      || !keys.includes('target')) {
    throw invalidWindowLaunchTarget();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key);
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw invalidWindowLaunchTarget();
    }
  }
  if (payload.contractVersion !== 1 || !validateNavigationTargetV1(payload.target).valid) {
    throw invalidWindowLaunchTarget();
  }
  return { kind: 'canonical', launchTarget: payload.target };
}

async function resolveWindowLaunchPayload(payload, options) {
  const parsed = parseWindowLaunchPayload(payload, options);
  if (parsed.kind === 'empty') {
    return null;
  }

  const resolved = await sourceRootService.resolveNavigationTarget(parsed.launchTarget);
  const isAllowed = await assertApprovedPath(resolved.absolutePath);
  if (!isAllowed) {
    throw new Error('访问路径不在已授权照片目录范围内');
  }
  return parsed.launchTarget;
}

ipcMain.handle(CHANNELS.VALIDATE_NAVIGATION_TARGET_V1, async (event, payload) => {
  try {
    const parsed = parseWindowLaunchPayload(payload);
    const resolved = await sourceRootService.resolveNavigationTarget(parsed.launchTarget);
    const stats = await stat(resolved.absolutePath);
    if (!stats.isDirectory()) throw new Error('Navigation target is not a directory');
    if (!(process.platform === 'darwin' && resolved.absolutePath === '/')) {
      await readdir(resolved.absolutePath);
    }
    return { success: true };
  } catch (_error) {
    return { success: false, error: '目录不存在或不可访问' };
  }
});

// 创建新窗口查看文件夹
ipcMain.handle(CHANNELS.OPEN_SETTINGS_WINDOW, async () => {
  try {
    const settingsWindow = createWindow(null, {
      width: 760,
      height: 560,
      minWidth: 720,
      minHeight: 480,
      hashUrl: '#/settings'
    });
    return { success: true, windowId: settingsWindow.id };
  } catch (error) {
    console.error('打开设置窗口失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle(CHANNELS.CREATE_NEW_WINDOW, async (event, payload) => {
  try {
    const launchTarget = await resolveWindowLaunchPayload(payload, { allowEmpty: true });
    console.log('创建新窗口查看文件夹:', launchTarget);
    const newWindow = createWindow(launchTarget);
    return { success: true, windowId: newWindow.id };
  } catch (error) {
    console.error('创建新窗口失败:', error);
    return { success: false, error: error.message };
  }
});

// 创建新实例并选择文件夹
ipcMain.handle(CHANNELS.CREATE_NEW_INSTANCE, async (event, payload) => {
  try {
    const launchTarget = await resolveWindowLaunchPayload(payload);

    console.log('=== 创建新实例开始 ===');
    console.log('窗口启动目标:', launchTarget);
    
    // 作为替代方案，直接使用现有的createWindow函数创建新窗口
    // 这会在同一个进程中创建新窗口，而不是新进程
    console.log('使用现有进程创建新窗口作为替代方案');
    const newWindow = createWindow(launchTarget);
    
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
    const safePath = launchTarget;
    
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
    const isAllowed = await assertApprovedPath(rootPath);
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
