#!/usr/bin/env node

/**
 * 新架构测试和性能验证脚本
 * 测试智能导航扫描系统的功能和性能
 */

const fs = require('fs');
const path = require('path');

// 测试配置
const TEST_CONFIG = {
  SAMPLE_LIMIT: 20,
  MAX_PREVIEW_SAMPLES: 4,
  MAX_CHILD_SCAN: 10,
  TIMEOUT_MS: 2000
};

const NODE_TYPES = {
  FOLDER: 'folder',
  ALBUM: 'album',
  EMPTY: 'empty'
};

const SUPPORTED_FORMATS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'];

/**
 * 模拟新架构的核心扫描逻辑
 */
class NavigationTester {
  constructor() {
    this.scanStats = {
      totalScans: 0,
      totalTime: 0,
      nodeTypes: { folder: 0, album: 0, empty: 0 },
      averageTime: 0,
      maxTime: 0,
      minTime: Infinity
    };
  }

  /**
   * 确定节点类型
   */
  async determineNodeType(dirPath) {
    try {
      const entries = await fs.promises.readdir(dirPath);
      if (entries.length === 0) return NODE_TYPES.EMPTY;

      const sampleEntries = entries.slice(0, TEST_CONFIG.SAMPLE_LIMIT);
      
      for (const entry of sampleEntries) {
        const entryPath = path.join(dirPath, entry);
        try {
          const stats = await fs.promises.stat(entryPath);
          
          if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
            return NODE_TYPES.ALBUM;
          }
        } catch {
          continue;
        }
      }
      
      return NODE_TYPES.FOLDER;
    } catch (error) {
      console.warn(`检查节点类型失败 ${dirPath}:`, error.message);
      return NODE_TYPES.EMPTY;
    }
  }

  /**
   * 获取相册统计
   */
  async getAlbumStats(dirPath) {
    try {
      const entries = await fs.promises.readdir(dirPath);
      const imageFiles = [];
      
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        try {
          const stats = await fs.promises.stat(entryPath);
          
          if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
            imageFiles.push({
              path: entryPath,
              name: entry,
              size: stats.size,
              lastModified: stats.mtime
            });
          }
        } catch {
          continue;
        }
      }
      
      imageFiles.sort((a, b) => b.lastModified - a.lastModified);
      const previewImages = imageFiles.slice(0, TEST_CONFIG.MAX_PREVIEW_SAMPLES);
      
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
        totalSize: 0,
        lastModified: new Date()
      };
    }
  }

  /**
   * 获取文件夹统计
   */
  async getFolderStats(dirPath) {
    try {
      const entries = await fs.promises.readdir(dirPath);
      const sampleSize = Math.min(entries.length, TEST_CONFIG.MAX_CHILD_SCAN);
      const sampleEntries = entries.slice(0, sampleSize);
      
      let folderCount = 0;
      let estimatedImages = 0;
      let previewSamples = [];
      let hasSubAlbums = false;
      
      const promises = sampleEntries.map(async (entry) => {
        const entryPath = path.join(dirPath, entry);
        try {
          const stats = await fs.promises.stat(entryPath);
          
          if (stats.isDirectory()) {
            folderCount++;
            const quickCheck = await this.quickScanForImages(entryPath);
            if (quickCheck.hasImages) {
              hasSubAlbums = true;
              estimatedImages += quickCheck.imageCount;
              previewSamples.push(...quickCheck.samples.slice(0, 2));
            }
          }
        } catch {
          // 跳过无法访问的目录
        }
      });
      
      await Promise.all(promises);
      
      if (folderCount > 0 && sampleSize < entries.length) {
        const ratio = entries.length / sampleSize;
        estimatedImages = Math.round(estimatedImages * ratio);
      }
      
      return {
        childFolders: folderCount,
        estimatedImages,
        previewSamples: previewSamples.slice(0, TEST_CONFIG.MAX_PREVIEW_SAMPLES),
        hasSubAlbums,
        hasMore: entries.length > sampleSize,
        sampleSize
      };
    } catch (error) {
      console.warn(`获取文件夹统计失败 ${dirPath}:`, error.message);
      return {
        childFolders: 0,
        estimatedImages: 0,
        previewSamples: [],
        hasSubAlbums: false,
        hasMore: false,
        sampleSize: 0
      };
    }
  }

  /**
   * 快速扫描检查目录是否包含图片
   */
  async quickScanForImages(dirPath) {
    try {
      const entries = await fs.promises.readdir(dirPath);
      const sampleEntries = entries.slice(0, 10);
      
      const samples = [];
      let imageCount = 0;
      
      for (const entry of sampleEntries) {
        const entryPath = path.join(dirPath, entry);
        try {
          const stats = await fs.promises.stat(entryPath);
          
          if (stats.isFile() && SUPPORTED_FORMATS.includes(path.extname(entry).toLowerCase())) {
            samples.push(entryPath);
            imageCount++;
            
            if (samples.length >= 2) break;
          }
        } catch {
          continue;
        }
      }
      
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
   * 测试智能扫描单层目录
   */
  async testScanNavigationLevel(targetPath) {
    const startTime = Date.now();
    
    try {
      const entries = await fs.promises.readdir(targetPath);
      if (entries.length === 0) {
        return this.createTestResponse([], targetPath, 0);
      }

      const nodePromises = entries
        .slice(0, 100)
        .map(entry => this.processTestNavigationEntry(targetPath, entry));
      
      const nodes = (await Promise.all(nodePromises)).filter(Boolean);
      
      nodes.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === NODE_TYPES.FOLDER ? -1 : 1;
        }
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });

      const scanTime = Date.now() - startTime;
      this.updateScanStats(scanTime, nodes);
      
      return this.createTestResponse(nodes, targetPath, scanTime);
      
    } catch (error) {
      console.error(`测试扫描失败 ${targetPath}:`, error);
      return this.createErrorTestResponse(error.message, targetPath);
    }
  }

  /**
   * 处理单个测试目录项
   */
  async processTestNavigationEntry(parentPath, entry) {
    const fullPath = path.join(parentPath, entry);
    
    try {
      const stats = await fs.promises.stat(fullPath);
      
      if (!stats.isDirectory()) {
        return null;
      }
      
      const nodeType = await this.determineNodeType(fullPath);
      
      if (nodeType === NODE_TYPES.ALBUM) {
        const albumStats = await this.getAlbumStats(fullPath);
        return this.createAlbumTestNode(fullPath, entry, albumStats);
      } else if (nodeType === NODE_TYPES.FOLDER) {
        const folderStats = await this.getFolderStats(fullPath);
        return this.createFolderTestNode(fullPath, entry, folderStats);
      }
      
      return null;
      
    } catch (error) {
      console.warn(`跳过测试项目 ${fullPath}:`, error.message);
      return null;
    }
  }

  createAlbumTestNode(path, name, stats) {
    return {
      path,
      name,
      type: NODE_TYPES.ALBUM,
      hasImages: true,
      imageCount: stats.imageCount || 0,
      childFolders: 0,
      samples: stats.previewImages || [],
      lastModified: stats.lastModified || new Date(),
      previewImages: stats.previewImages || [],
      totalSize: stats.totalSize || 0
    };
  }

  createFolderTestNode(path, name, stats) {
    return {
      path,
      name,
      type: NODE_TYPES.FOLDER,
      hasImages: false,
      imageCount: stats.estimatedImages || 0,
      childFolders: stats.childFolders || 0,
      samples: stats.previewSamples || [],
      lastModified: new Date(),
      estimatedImages: stats.estimatedImages || 0,
      previewSamples: stats.previewSamples || [],
      hasSubAlbums: stats.hasSubAlbums || false,
      quickStats: {
        hasMore: stats.hasMore || false,
        sampleSize: stats.sampleSize || 0
      }
    };
  }

  createTestResponse(nodes, currentPath, scanTime) {
    return {
      success: true,
      nodes,
      currentPath,
      metadata: {
        totalNodes: nodes.length,
        folderCount: nodes.filter(n => n.type === NODE_TYPES.FOLDER).length,
        albumCount: nodes.filter(n => n.type === NODE_TYPES.ALBUM).length,
        totalImages: nodes.reduce((sum, n) => sum + (n.imageCount || 0), 0),
        scanTime
      }
    };
  }

  createErrorTestResponse(message, currentPath) {
    return {
      success: false,
      nodes: [],
      currentPath,
      error: { message, timestamp: Date.now() },
      metadata: null
    };
  }

  updateScanStats(scanTime, nodes) {
    this.scanStats.totalScans++;
    this.scanStats.totalTime += scanTime;
    this.scanStats.maxTime = Math.max(this.scanStats.maxTime, scanTime);
    this.scanStats.minTime = Math.min(this.scanStats.minTime, scanTime);
    this.scanStats.averageTime = this.scanStats.totalTime / this.scanStats.totalScans;

    nodes.forEach(node => {
      this.scanStats.nodeTypes[node.type]++;
    });
  }

  /**
   * 运行性能测试
   */
  async runPerformanceTest(testPath) {
    console.log('🚀 开始新架构性能测试...\n');
    
    const testStartTime = Date.now();
    
    console.log(`📁 测试目录: ${testPath}`);
    
    // 测试单层扫描
    const response = await this.testScanNavigationLevel(testPath);
    
    if (response.success) {
      console.log('✅ 扫描成功!');
      console.log(`📊 扫描结果:`);
      console.log(`  - 总节点数: ${response.metadata.totalNodes}`);
      console.log(`  - 文件夹数: ${response.metadata.folderCount}`);
      console.log(`  - 相册数: ${response.metadata.albumCount}`);
      console.log(`  - 总图片数: ${response.metadata.totalImages}`);
      console.log(`  - 扫描时间: ${response.metadata.scanTime}ms`);
      
      // 分析节点类型
      console.log('\n🔍 节点类型分析:');
      response.nodes.forEach((node, index) => {
        const typeIcon = node.type === 'folder' ? '📁' : '📷';
        const countInfo = node.type === 'folder' 
          ? `(${node.childFolders}个子文件夹, ~${node.estimatedImages}张图片)`
          : `(${node.imageCount}张图片)`;
        console.log(`  ${index + 1}. ${typeIcon} ${node.name} ${countInfo}`);
      });
      
    } else {
      console.log('❌ 扫描失败:', response.error?.message);
    }
    
    const testTotalTime = Date.now() - testStartTime;
    
    console.log('\n📈 性能统计:');
    console.log(`  - 总测试时间: ${testTotalTime}ms`);
    console.log(`  - 平均扫描时间: ${this.scanStats.averageTime.toFixed(2)}ms`);
    console.log(`  - 最快扫描: ${this.scanStats.minTime}ms`);
    console.log(`  - 最慢扫描: ${this.scanStats.maxTime}ms`);
    
    // 性能评估
    const performanceGrade = this.evaluatePerformance(response.metadata?.scanTime || 0);
    console.log(`\n🎯 性能评级: ${performanceGrade.grade} (${performanceGrade.description})`);
    
    return response;
  }

  evaluatePerformance(scanTime) {
    if (scanTime < 100) {
      return { grade: 'A+', description: '极优 - 闪电般快速' };
    } else if (scanTime < 300) {
      return { grade: 'A', description: '优秀 - 非常快速' };
    } else if (scanTime < 800) {
      return { grade: 'B', description: '良好 - 较快' };
    } else if (scanTime < 2000) {
      return { grade: 'C', description: '一般 - 可接受' };
    } else {
      return { grade: 'D', description: '较差 - 需要优化' };
    }
  }
}

/**
 * 主测试函数
 */
async function main() {
  const testPath = process.argv[2];
  
  if (!testPath) {
    console.log('用法: node test-new-architecture.js <测试目录路径>');
    console.log('例如: node test-new-architecture.js /Users/test/Photos');
    process.exit(1);
  }
  
  if (!fs.existsSync(testPath)) {
    console.error('❌ 测试目录不存在:', testPath);
    process.exit(1);
  }
  
  const stat = await fs.promises.stat(testPath);
  if (!stat.isDirectory()) {
    console.error('❌ 指定路径不是目录:', testPath);
    process.exit(1);
  }
  
  const tester = new NavigationTester();
  await tester.runPerformanceTest(testPath);
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = NavigationTester;