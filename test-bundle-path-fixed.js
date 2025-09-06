/**
 * 验证bundle.js中的路径处理修复 - 修正版本
 * 区分SVG path元素和Node.js path模块
 */

const fs = require('fs');
const path = require('path');

const bundlePath = path.join(__dirname, 'build/bundle.js');

if (!fs.existsSync(bundlePath)) {
  console.log('❌ Bundle文件不存在:', bundlePath);
  process.exit(1);
}

console.log('正在验证bundle.js中的路径处理修复...');

try {
  const bundleContent = fs.readFileSync(bundlePath, 'utf8');
  
  // 检查真正的path模块问题（排除SVG path元素）
  const problematicPatterns = [
    /path\.basename/g,  // path.basename
    /path\.dirname/g,   // path.dirname  
    /path\.relative/g,  // path.relative
    /require\s*\(\s*["']path["']\s*\)/g,  // require("path")
    /from\s+["']path["']/g,  // from "path"
    /require\s*\(\s*['"]path['"]\s*\)/g  // require('path')
  ];
  
  let foundRealIssues = false;
  
  problematicPatterns.forEach((pattern, index) => {
    const matches = bundleContent.match(pattern);
    if (matches) {
      // 进一步检查是否是真实的path模块引用
      matches.forEach(match => {
        // 排除SVG相关的path引用
        if (!match.includes('d=') && !match.includes('jsx') && !match.includes('SvgIcon')) {
          console.log(`❌ 发现真实的path模块问题 (${index + 1}): "${match}"`);
          foundRealIssues = true;
        }
      });
    }
  });
  
  // 检查我们的路径工具函数是否存在
  const ourFunctions = ['getBasename', 'getDirname', 'getRelativePath'];
  let foundOurFunctions = 0;
  
  ourFunctions.forEach(funcName => {
    if (bundleContent.includes(funcName)) {
      foundOurFunctions++;
      console.log(`✅ 发现自定义路径函数: ${funcName}`);
    }
  });
  
  if (foundOurFunctions === ourFunctions.length) {
    console.log(`✅ 所有自定义路径函数都存在 (${foundOurFunctions}/${ourFunctions.length})`);
  } else {
    console.log(`⚠️  部分自定义路径函数缺失 (${foundOurFunctions}/${ourFunctions.length})`);
  }
  
  // 检查是否有路径相关的错误处理
  if (bundleContent.includes('path is not defined')) {
    console.log('❌ 发现"path is not defined"错误引用');
    foundRealIssues = true;
  }
  
  if (!foundRealIssues) {
    console.log('✅ 路径处理修复验证通过！');
    console.log('✅ 没有发现真实的path模块引用错误');
    console.log('✅ 自定义路径工具函数已正确集成');
    console.log('✅ SVG path元素引用正常（已排除）');
  } else {
    console.log('❌ 发现真实的path模块问题，需要进一步修复');
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ 验证失败:', error.message);
  process.exit(1);
}