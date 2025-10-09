const path = require('path');

/**
 * 构造一个虚拟文件树，生成供 mock-fs 使用的结构
 */

const buildFsStructure = (tree) => {
  const result = {};
  for (const [name, value] of Object.entries(tree)) {
    if (typeof value === 'string' || Buffer.isBuffer(value)) {
      result[name] = value;
    } else if (typeof value === 'object') {
      result[name] = buildFsStructure(value);
    } else {
      throw new Error(`Unsupported mock fs entry for ${name}`);
    }
  }
  return result;
};

const createFsMock = (tree, { includeNodeModules = true } = {}) => {
  const mockFs = require('mock-fs');
  const structure = buildFsStructure(tree);

  if (!Object.prototype.hasOwnProperty.call(structure, 'src')) {
    structure.src = mockFs.load(path.resolve('src'));
  }

  if (includeNodeModules && !Object.prototype.hasOwnProperty.call(structure, 'node_modules')) {
    structure.node_modules = mockFs.load(path.resolve('node_modules'));
  }

  mockFs(structure, { createCwd: false, createTmp: false });
  return mockFs;
};

module.exports = {
  createFsMock,
  buildFsStructure,
  resolveMockPath: (...segments) => path.join(...segments)
};
