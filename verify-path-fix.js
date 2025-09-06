/**
 * 验证路径处理修复是否完整
 * 检查bundle.js中是否还有path模块引用
 */

const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, 'dist/mac-arm64/Photo Album Viewer.app/Contents/Resources/app.asar/build/bundle.js');

if (!fs.existsSync(bundlePath)) {
  console.log('❌ Bundle文件不存在:', bundlePath);
  process.exit(1);
}

console.log('正在验证路径处理修复...');

try {
  const bundleContent = fs.readFileSync(bundlePath, 'utf8');
  
  // 检查是否还有path模块引用
  const pathReferences = [
    /path\s*\./g,
    /require\(['"]path['"]\)/g,
    /import.*path/g
  ];
  
  let foundIssues = false;
  
  pathReferences.forEach((regex, index) => {
    const matches = bundleContent.match(regex);
    if (matches) {
      console.log(`❌ 发现path模块引用 (${index + 1}): ${matches.length} 处`);
      foundIssues = true;
    }
  });
  
  // 检查我们的路径工具函数是否存在
  const ourFunctions = ['getBasename', 'getDirname', 'getRelativePath'];
  
  ourFunctions.forEach(funcName => {
    if (bundleContent.includes(funcName)) {
      console.log(`✅ 发现自定义路径函数: ${funcName}`);
    } else {
      console.log(`⚠️  未找到自定义路径函数: ${funcName}`);
    }
  });
  
  if (!foundIssues) {
    console.log('✅ 路径处理修复验证通过！');
    console.log('✅ 没有发现path模块引用');
    console.log('✅ 应用应该可以正常运行');
  } else {
    console.log('❌ 发现path模块引用，需要进一步修复');
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ 验证失败:', error.message);
  process.exit(1);
}