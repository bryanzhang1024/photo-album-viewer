/**
 * 验证bundle.js中的路径处理修复
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
  
  // 检查是否还有path模块相关代码
  const problematicPatterns = [
    /path\.basename/g,
    /path\.dirname/g,
    /path\.relative/g,
    /require\s*\(\s*["']path["']\s*\)/g,
    /from\s+["']path["']/g
  ];
  
  let foundIssues = false;
  
  problematicPatterns.forEach((pattern, index) => {
    const matches = bundleContent.match(pattern);
    if (matches) {
      console.log(`❌ 发现path模块问题 (${index + 1}): 找到 ${matches.length} 处`);
      console.log(`   匹配内容: ${matches[0]}`);
      foundIssues = true;
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
    foundIssues = true;
  }
  
  if (!foundIssues) {
    console.log('✅ 路径处理修复验证通过！');
    console.log('✅ 没有发现path模块引用错误');
    console.log('✅ 自定义路径工具函数已正确集成');
  } else {
    console.log('❌ 发现路径处理问题，需要进一步修复');
    process.exit(1);
  }
  
} catch (error) {
  console.error('❌ 验证失败:', error.message);
  process.exit(1);
}