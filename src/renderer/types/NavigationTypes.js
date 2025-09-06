/**
 * 导航系统数据结构定义
 * 重构后的类型定义，支持文件夹导航和相册浏览
 */

/**
 * 导航节点类型枚举
 */
export const NODE_TYPES = {
  FOLDER: 'folder',    // 文件夹节点 - 包含子目录
  ALBUM: 'album',      // 相册节点 - 直接包含图片
  EMPTY: 'empty'       // 空节点 - 无内容
};

/**
 * 导航节点基础结构
 * @typedef {Object} NavigationNode
 * @property {string} path - 节点路径
 * @property {string} name - 显示名称
 * @property {NODE_TYPES} type - 节点类型
 * @property {boolean} hasImages - 是否直接包含图片
 * @property {number} imageCount - 图片总数（预估）
 * @property {number} childFolders - 子文件夹数量
 * @property {Array<string>} samples - 预览图样本（最多4张）
 * @property {Object} stats - 统计信息
 * @property {Date} lastModified - 最后修改时间
 */

/**
 * 文件夹节点结构
 * @typedef {Object} FolderNode
 * @property {NODE_TYPES.FOLDER} type
 * @property {number} childFolders - 子文件夹数量
 * @property {number} estimatedImages - 预估图片总数
 * @property {Array<string>} previewSamples - 从子目录采样的预览图
 * @property {boolean} hasSubAlbums - 是否包含子相册
 * @property {Object} quickStats - 快速统计信息
 * @property {boolean} quickStats.hasMore - 是否还有更多内容
 * @property {number} quickStats.sampleSize - 采样大小
 */

/**
 * 相册节点结构  
 * @typedef {Object} AlbumNode
 * @property {NODE_TYPES.ALBUM} type
 * @property {Array<string>} previewImages - 预览图路径（前4张）
 * @property {number} imageCount - 精确图片数量
 * @property {Date} firstImageDate - 最早图片日期
 * @property {Date} lastImageDate - 最新图片日期
 * @property {number} totalSize - 总文件大小（字节）
 */

/**
 * 导航响应结构
 * @typedef {Object} NavigationResponse
 * @property {boolean} success - 操作是否成功
 * @property {Array<NavigationNode>} nodes - 节点列表
 * @property {string} currentPath - 当前路径
 * @property {string} parentPath - 父路径
 * @property {Array<Object>} breadcrumbs - 面包屑导航
 * @property {Object} error - 错误信息（如果有）
 * @property {Object} metadata - 元数据信息
 */

/**
 * 快速统计配置
 */
export const QUICK_STATS_CONFIG = {
  SAMPLE_LIMIT: 20,      // 采样文件数量限制
  MAX_PREVIEW_SAMPLES: 4, // 最大预览样本数
  MAX_CHILD_SCAN: 10,    // 最大子目录扫描数量
  TIMEOUT_MS: 2000       // 超时时间（毫秒）
};

/**
 * 性能配置
 */
export const PERFORMANCE_CONFIG = {
  PARALLEL_SCAN_LIMIT: 5,    // 并行扫描限制
  CACHE_TTL_MS: 300000,      // 缓存生存时间（5分钟）
  BATCH_SIZE: 50,            // 批处理大小
  PRIORITY_LEVELS: {         // 优先级级别
    HIGH: 0,     // 当前可见内容
    NORMAL: 1,   // 即将显示的内容
    LOW: 2       // 背景预加载
  }
};

/**
 * 创建文件夹节点
 * @param {string} path - 路径
 * @param {string} name - 名称
 * @param {Object} stats - 统计信息
 * @returns {FolderNode}
 */
export const createFolderNode = (path, name, stats = {}) => ({
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
});

/**
 * 创建相册节点
 * @param {string} path - 路径
 * @param {string} name - 名称
 * @param {Object} stats - 统计信息
 * @returns {AlbumNode}
 */
export const createAlbumNode = (path, name, stats = {}) => ({
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
});

/**
 * 创建导航响应
 * @param {Array<NavigationNode>} nodes - 节点列表
 * @param {string} currentPath - 当前路径
 * @param {string} parentPath - 父路径
 * @param {Array} breadcrumbs - 面包屑
 * @returns {NavigationResponse}
 */
export const createNavigationResponse = (nodes, currentPath, parentPath, breadcrumbs) => ({
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
    scanTime: Date.now()
  }
});

/**
 * 创建错误响应
 * @param {string} message - 错误消息
 * @param {string} currentPath - 当前路径
 * @returns {NavigationResponse}
 */
export const createErrorResponse = (message, currentPath = '') => ({
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
});