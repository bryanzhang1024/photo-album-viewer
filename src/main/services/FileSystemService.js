const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

// 新的智能导航扫描系统
const SCAN_CONFIG = {
  SAMPLE_LIMIT: 20,      // 采样文件限制
  MAX_PREVIEW_SAMPLES: 4, // 最大预览样本
  MAX_CHILD_SCAN: 10,    // 最大子目录扫描
  TIMEOUT_MS: 2000,      // 超时时间
  PARALLEL_LIMIT: 5      // 并行限制
};

const DEEP_SCAN_CONFIG = {
  MAX_DEPTH: 3,             // 最大递归深度
  MAX_VISITED_DIRS: 40,     // 最大遍历目录数
  MAX_PREVIEW_SAMPLES: 4,   // 需要的样本数量
  MAX_ENTRIES_PER_DIR: 20   // 每个目录检查的最大条目数
};

const NODE_TYPES = {
  FOLDER: 'folder',
  ALBUM: 'album', 
  EMPTY: 'empty'
};

function compareImageNameNaturalAsc(left, right) {
  const leftName = left?.name || path.basename(left?.path || '');
  const rightName = right?.name || path.basename(right?.path || '');
  return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
}

function buildPreviewImagesByName(imageFiles = []) {
  return [...imageFiles]
    .sort(compareImageNameNaturalAsc)
    .slice(0, SCAN_CONFIG.MAX_PREVIEW_SAMPLES);
}

function resolveImageDateStats(imageFiles = [], dateGetter) {
  let minTimestamp = null;
  let maxTimestamp = null;

  imageFiles.forEach((file) => {
    const rawDate = dateGetter(file);
    if (!rawDate) return;

    const timestamp = rawDate instanceof Date
      ? rawDate.getTime()
      : new Date(rawDate).getTime();

    if (!Number.isFinite(timestamp)) return;

    if (minTimestamp === null || timestamp < minTimestamp) {
      minTimestamp = timestamp;
    }
    if (maxTimestamp === null || timestamp > maxTimestamp) {
      maxTimestamp = timestamp;
    }
  });

  return {
    firstImageDate: minTimestamp === null ? null : new Date(minTimestamp),
    lastImageDate: maxTimestamp === null ? null : new Date(maxTimestamp),
    lastModified: maxTimestamp === null ? new Date() : new Date(maxTimestamp)
  };
}

function compareNameNaturalAsc(left, right) {
  return String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function pickEvenlySpacedItems(items = [], limit = 0) {
  if (!Array.isArray(items) || items.length === 0 || limit <= 0) {
    return [];
  }

  if (items.length <= limit) {
    return [...items];
  }

  if (limit === 1) {
    return [items[0]];
  }

  const sampled = [];
  const usedIndices = new Set();

  for (let i = 0; i < limit; i++) {
    const index = Math.round((i * (items.length - 1)) / (limit - 1));
    if (usedIndices.has(index)) {
      continue;
    }
    usedIndices.add(index);
    sampled.push({ index, value: items[index] });
  }

  if (sampled.length < limit) {
    for (let i = 0; i < items.length && sampled.length < limit; i++) {
      if (usedIndices.has(i)) {
        continue;
      }
      usedIndices.add(i);
      sampled.push({ index: i, value: items[i] });
    }
  }

  sampled.sort((a, b) => a.index - b.index);
  return sampled.map(item => item.value);
}

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
      const previewImages = buildPreviewImagesByName(imageFiles);
      const dateStats = resolveImageDateStats(imageFiles, (file) => file.stats?.mtime);
      const albumStats = {
        imageCount: imageFiles.length,
        previewImages: previewImages.map((file) => file.path),
        lastModified: dateStats.lastModified,
        firstImageDate: dateStats.firstImageDate,
        lastImageDate: dateStats.lastImageDate,
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
    
    // 预览图按文件名自然正序，优先使用“第一张”（例如 1.jpg）
    const previewImages = buildPreviewImagesByName(imageFiles);
    const dateStats = resolveImageDateStats(imageFiles, (file) => file.lastModified);
    
    return {
      imageCount: imageFiles.length,
      previewImages: previewImages.map(img => img.path),
      firstImageDate: dateStats.firstImageDate,
      lastImageDate: dateStats.lastImageDate,
      totalSize: imageFiles.reduce((sum, img) => sum + img.size, 0),
      lastModified: dateStats.lastModified
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
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const allChildDirectories = dirents
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort(compareNameNaturalAsc);
    const sampleEntries = pickEvenlySpacedItems(allChildDirectories, SCAN_CONFIG.MAX_CHILD_SCAN);
    const sampledEntrySet = new Set(sampleEntries);
    
    const folderCount = allChildDirectories.length;
    let previewSamples = [];
    let hasSubAlbums = false;
    let lastModified = new Date(0);
    const nestedScanCandidates = [];
    
    // 并行处理样本
    const promises = sampleEntries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry);
      try {
        const stats = await stat(entryPath);
        
        if (stats.isDirectory()) {
          // 快速检查子目录是否包含图片
          const quickCheck = await quickScanForImages(entryPath);
          if (quickCheck.hasImages) {
            hasSubAlbums = true;
            previewSamples.push(...quickCheck.samples.slice(0, 2));
          } else {
            nestedScanCandidates.push(entryPath);
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

    if (previewSamples.length < SCAN_CONFIG.MAX_PREVIEW_SAMPLES && nestedScanCandidates.length > 0) {
      const remaining = SCAN_CONFIG.MAX_PREVIEW_SAMPLES - previewSamples.length;
      const deepSamples = await collectNestedImageSamples(
        nestedScanCandidates,
        remaining,
        {
          maxDepth: DEEP_SCAN_CONFIG.MAX_DEPTH,
          maxVisited: DEEP_SCAN_CONFIG.MAX_VISITED_DIRS,
          maxEntriesPerDir: DEEP_SCAN_CONFIG.MAX_ENTRIES_PER_DIR
        }
      );

      if (deepSamples.length > 0) {
        hasSubAlbums = true;
        previewSamples.push(...deepSamples);
      }
    }

    // 首轮采样无结果时，对未采样目录进行一次均匀兜底，避免“前N个目录恰好无图”导致空预览。
    if (previewSamples.length === 0 && allChildDirectories.length > sampleEntries.length) {
      const unsampledDirectories = allChildDirectories.filter(name => !sampledEntrySet.has(name));
      const fallbackRoots = pickEvenlySpacedItems(
        unsampledDirectories,
        Math.min(unsampledDirectories.length, DEEP_SCAN_CONFIG.MAX_VISITED_DIRS)
      ).map(name => path.join(dirPath, name));

      if (fallbackRoots.length > 0) {
        const deepFallbackSamples = await collectNestedImageSamples(
          fallbackRoots,
          SCAN_CONFIG.MAX_PREVIEW_SAMPLES,
          {
            maxDepth: DEEP_SCAN_CONFIG.MAX_DEPTH,
            maxVisited: DEEP_SCAN_CONFIG.MAX_VISITED_DIRS,
            maxEntriesPerDir: DEEP_SCAN_CONFIG.MAX_ENTRIES_PER_DIR
          }
        );

        if (deepFallbackSamples.length > 0) {
          hasSubAlbums = true;
          previewSamples.push(...deepFallbackSamples);
        }
      }
    }

    if (previewSamples.length > 0) {
      const uniqueSamples = Array.from(new Set(previewSamples));
      previewSamples = uniqueSamples.slice(0, SCAN_CONFIG.MAX_PREVIEW_SAMPLES);
    }

    return {
      childFolders: folderCount,
      previewSamples: previewSamples.slice(0, SCAN_CONFIG.MAX_PREVIEW_SAMPLES),
      hasSubAlbums,
      hasMore: allChildDirectories.length > sampleEntries.length,
      sampleSize: sampleEntries.length,
      lastModified
    };
    
  } catch (error) {
    console.warn(`获取文件夹统计失败 ${dirPath}:`, error.message);
    return {
      childFolders: 0,
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
    
    for (const entry of sampleEntries) {
      const entryPath = path.join(dirPath, entry);
      try {
        const stats = await stat(entryPath);
        
        if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
          samples.push(entryPath);
          
          if (samples.length >= 2) break; // 只需要2个样本
        }
      } catch {
        continue;
      }
    }
    
    return {
      hasImages: samples.length > 0,
      samples
    };
    
  } catch {
    return {
      hasImages: false,
      samples: []
    };
  }
}

async function collectNestedImageSamples(rootDirs, maxSamples, options = {}) {
  const maxDepth = options.maxDepth ?? DEEP_SCAN_CONFIG.MAX_DEPTH;
  const maxVisited = options.maxVisited ?? DEEP_SCAN_CONFIG.MAX_VISITED_DIRS;
  const maxEntriesPerDir = options.maxEntriesPerDir ?? DEEP_SCAN_CONFIG.MAX_ENTRIES_PER_DIR;
  const targetSamples = Math.min(maxSamples, DEEP_SCAN_CONFIG.MAX_PREVIEW_SAMPLES);

  const queue = rootDirs.map(dir => ({ dir, depth: 1 }));
  const samples = [];
  const visited = new Set();

  while (queue.length > 0 && samples.length < targetSamples && visited.size < maxVisited) {
    const { dir, depth } = queue.shift();
    if (visited.has(dir) || depth > maxDepth) {
      continue;
    }

    visited.add(dir);

    let entries;
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    const limitedEntries = entries.slice(0, maxEntriesPerDir);

    for (const entry of limitedEntries) {
      const entryPath = path.join(dir, entry);
      let stats;

      try {
        stats = await stat(entryPath);
      } catch {
        continue;
      }

      if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
        samples.push(entryPath);
        if (samples.length >= targetSamples) {
          break;
        }
      } else if (stats.isDirectory() && depth < maxDepth) {
        queue.push({ dir: entryPath, depth: depth + 1 });
      }
    }
  }

  return samples;
}

/**
 * 生成面包屑导航
 */
function generateBreadcrumbs(currentPath) {
  if (!currentPath) {
    return [];
  }

  const resolvedPath = path.resolve(currentPath);
  const root = path.parse(resolvedPath).root;
  const parts = resolvedPath.slice(root.length).split(path.sep).filter(Boolean);
  const breadcrumbs = [];
  let buildPath = root;

  for (const part of parts) {
    buildPath = buildPath ? path.join(buildPath, part) : part;
    breadcrumbs.push({
      name: part,
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
    imageCount: 0,
    childFolders: stats.childFolders || 0,
    samples: stats.previewSamples || [],
    lastModified: stats.lastModified || new Date(),
    // 文件夹特有属性
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

async function getAlbumImages(albumPath) {
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
}

/**
 * 扫描目录树 - 用于导航面板（递归扫描）
 * @param {string} rootPath - 根路径
 * @param {number} depth - 当前深度
 * @param {number} maxDepth - 最大深度
 * @returns {Promise<Array>} 目录树结构
 */
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

module.exports = {
    scanNavigationLevel,
    scanDirectories,
    getAlbumImages,
    scanDirectoryTree,
    createErrorResponse,
    SUPPORTED_FORMATS
};
