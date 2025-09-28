const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const http = require('http');
const sharp = require('sharp');
const crypto = require('crypto');
const url = require('url');

const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

const THUMBNAIL_CACHE_DIR = path.join(app.getPath('userData'), 'thumbnail-cache');

// 性能设置
let performanceSettings = {};

let thumbnailServer = null;
let thumbnailServerPort = 0;

async function ensureCacheDir() {
  try {
    await mkdir(THUMBNAIL_CACHE_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.error('创建缩略图缓存目录失败:', err);
    }
  }
}

function generateCacheFilename(imagePath, width, height) {
  const hash = crypto.createHash('md5').update(imagePath + width + height).digest('hex');
  return path.join(THUMBNAIL_CACHE_DIR, `${hash}.webp`);
}

async function generateThumbnail(imagePath, width = 300, height = 300) {
    await ensureCacheDir();
    const cacheFilename = generateCacheFilename(imagePath, width, height);

    try {
        await stat(cacheFilename);
        return getThumbnailUrl(cacheFilename);
    } catch (err) {
        // a.  Cache miss, generate
    }

    try {
        await stat(imagePath);
    } catch (err) {
        console.error(`源图片文件不存在: ${imagePath}`, err);
        return null;
    }

    try {
        await sharp(imagePath, { failOnError: false })
            .resize({ width, height, fit: sharp.fit.inside, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(cacheFilename);
        return getThumbnailUrl(cacheFilename);
    } catch (err) {
        console.error(`处理图片失败: ${imagePath}`, err);
        return null;
    }
}

function getThumbnailUrl(cacheFilename) {
  if (!thumbnailServer) {
    return null;
  }
  const relativePath = path.relative(THUMBNAIL_CACHE_DIR, cacheFilename);
  return `http://localhost:${thumbnailServerPort}/thumbnails/${encodeURIComponent(relativePath)}`;
}

function startThumbnailServer() {
  return new Promise((resolve, reject) => {
    if (thumbnailServer) {
      resolve(thumbnailServerPort);
      return;
    }
    
    const server = http.createServer((req, res) => {
      try {
        const parsedUrl = url.parse(req.url);
        
        if (parsedUrl.pathname.startsWith('/thumbnails/')) {
          const relativePath = decodeURIComponent(parsedUrl.pathname.substring('/thumbnails/'.length));
          const filePath = path.join(THUMBNAIL_CACHE_DIR, relativePath);
          
          const normalizedFilePath = path.normalize(filePath);
          if (!normalizedFilePath.startsWith(THUMBNAIL_CACHE_DIR)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('访问被拒绝');
            return;
          }
          
          fs.stat(filePath, (err, stats) => {
            if (err || !stats.isFile()) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('文件未找到');
              return;
            }
            
            res.setHeader('Cache-Control', 'max-age=31536000');
            res.setHeader('Content-Type', 'image/webp');
            
            const stream = fs.createReadStream(filePath);
            stream.pipe(res);
          });
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('文件未找到');
        }
      } catch (err) {
        console.error('缩略图服务器错误:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('服务器错误');
      }
    });
    
    server.listen(0, 'localhost', () => {
      const address = server.address();
      thumbnailServerPort = address.port;
      thumbnailServer = server;
      console.log(`缩略图服务器启动在端口 ${thumbnailServerPort}`);
      resolve(thumbnailServerPort);
    });
    
    server.on('error', (err) => {
      console.error('缩略图服务器启动失败:', err);
      reject(err);
    });
  });
}

function init(settings) {
    performanceSettings = settings;
}

module.exports = {
    init,
    ensureCacheDir,
    generateThumbnail,
    startThumbnailServer,
    getThumbnailUrl
};