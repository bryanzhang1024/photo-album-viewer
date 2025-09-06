/**
 * 跨平台路径处理工具函数
 * 解决Electron打包后path模块不可用的问题
 */

/**
 * 获取路径的基础名称（文件名或最后一级目录名）
 * @param {string} filePath - 文件路径
 * @returns {string} - 基础名称
 */
export const getBasename = (filePath) => {
  if (!filePath) return '';
  
  // 移除末尾的斜杠
  const cleanPath = filePath.replace(/[\\\/]+$/, '');
  
  // 找到最后一个斜杠
  const lastSlash = Math.max(cleanPath.lastIndexOf('/'), cleanPath.lastIndexOf('\\'));
  
  if (lastSlash === -1) {
    return cleanPath; // 没有斜杠，返回整个字符串
  }
  
  return cleanPath.substring(lastSlash + 1);
};

/**
 * 获取路径的目录名（上级路径）
 * @param {string} filePath - 文件路径
 * @returns {string} - 目录路径
 */
export const getDirname = (filePath) => {
  if (!filePath) return '';
  
  // 移除末尾的斜杠
  const cleanPath = filePath.replace(/[\\\/]+$/, '');
  
  // 找到最后一个斜杠
  const lastSlash = Math.max(cleanPath.lastIndexOf('/'), cleanPath.lastIndexOf('\\'));
  
  if (lastSlash === -1) {
    return ''; // 没有斜杠，返回空字符串
  }
  
  return cleanPath.substring(0, lastSlash) || '/'; // 如果是根目录，返回'/'
};

/**
 * 获取两个路径的相对路径
 * @param {string} from - 起始路径
 * @param {string} to - 目标路径
 * @returns {string} - 相对路径
 */
export const getRelativePath = (from, to) => {
  if (!from || !to) return to || '';
  
  // 标准化路径分隔符
  const fromPath = from.replace(/\\/g, '/');
  const toPath = to.replace(/\\/g, '/');
  
  // 如果to路径以from路径开头
  if (toPath.startsWith(fromPath)) {
    const relative = toPath.substring(fromPath.length);
    return relative.replace(/^\//, ''); // 移除开头的斜杠
  }
  
  // 简单的相对路径计算
  const fromParts = fromPath.split('/').filter(Boolean);
  const toParts = toPath.split('/').filter(Boolean);
  
  // 找到共同的前缀
  let commonLength = 0;
  for (let i = 0; i < Math.min(fromParts.length, toParts.length); i++) {
    if (fromParts[i] === toParts[i]) {
      commonLength++;
    } else {
      break;
    }
  }
  
  // 计算相对路径
  const upLevels = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);
  
  const relativeParts = [];
  for (let i = 0; i < upLevels; i++) {
    relativeParts.push('..');
  }
  relativeParts.push(...downParts);
  
  return relativeParts.join('/') || '.';
};

/**
 * 检查路径是否为绝对路径
 * @param {string} filePath - 文件路径
 * @returns {boolean} - 是否为绝对路径
 */
export const isAbsolutePath = (filePath) => {
  if (!filePath) return false;
  
  // Windows: C:\ 或 \\server\share
  // Unix: /path
  return /^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/') || filePath.startsWith('\\\\');
};

/**
 * 连接多个路径段
 * @param {...string} paths - 路径段
 * @returns {string} - 连接后的路径
 */
export const joinPath = (...paths) => {
  if (!paths || paths.length === 0) return '';
  
  // 过滤掉空值
  const validPaths = paths.filter(p => p != null && p !== '');
  
  if (validPaths.length === 0) return '';
  
  // 使用正斜杠统一分隔符
  let result = validPaths[0];
  
  for (let i = 1; i < validPaths.length; i++) {
    const current = validPaths[i].replace(/^[\\\/]+/, ''); // 移除开头的斜杠
    const previousEnd = result.endsWith('/') || result.endsWith('\\');
    
    if (previousEnd) {
      result += current;
    } else {
      result += '/' + current;
    }
  }
  
  return result;
};

/**
 * 标准化路径，移除多余的斜杠
 * @param {string} filePath - 文件路径
 * @returns {string} - 标准化后的路径
 */
export const normalizePath = (filePath) => {
  if (!filePath) return '';
  
  // 保留Windows盘符
  const windowsDriveMatch = filePath.match(/^([a-zA-Z]:)(.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1];
    const rest = windowsDriveMatch[2].replace(/[\\\/]+/g, '/');
    return drive + rest;
  }
  
  // Unix风格路径
  return filePath.replace(/[\\\/]+/g, '/');
};