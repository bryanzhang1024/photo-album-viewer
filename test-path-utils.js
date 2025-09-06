// 测试路径工具函数
const { getBasename, getDirname, getRelativePath } = require('./src/renderer/utils/pathUtils');

console.log('测试路径工具函数...');

// 测试 getBasename
const testPaths = [
  '/Users/clover/Photos/Vacation',
  'C:\\Users\\Photos\\Vacation',
  '/Users/clover/Photos/Vacation/',
  'Vacation',
  '',
  null
];

console.log('\n=== 测试 getBasename ===');
testPaths.forEach(path => {
  console.log(`路径: "${path}" => 基础名称: "${getBasename(path)}"`);
});

// 测试 getDirname
console.log('\n=== 测试 getDirname ===');
testPaths.forEach(path => {
  console.log(`路径: "${path}" => 目录名: "${getDirname(path)}"`);
});

// 测试 getRelativePath
const relativeTestCases = [
  { from: '/Users/clover/Photos', to: '/Users/clover/Photos/Vacation' },
  { from: '/Users/clover/Photos/Vacation', to: '/Users/clover/Photos' },
  { from: '/Users/clover/Photos', to: '/Users/clover/Documents' },
  { from: 'C:\\Users\\Photos', to: 'C:\\Users\\Photos\\Vacation' }
];

console.log('\n=== 测试 getRelativePath ===');
relativeTestCases.forEach(({ from, to }) => {
  console.log(`从 "${from}" 到 "${to}" => 相对路径: "${getRelativePath(from, to)}"`);
});

console.log('\n测试完成！');