const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const sharp = require('sharp');
const crypto = require('crypto');

const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

const THUMBNAIL_CACHE_DIR = path.join(app.getPath('userData'), 'thumbnail-cache');

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
        // 检查缓存是否存在
        await stat(cacheFilename);
    } catch (err) {
        // 缓存未命中，生成缩略图
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
        } catch (err) {
            console.error(`处理图片失败: ${imagePath}`, err);
            return null;
        }
    }

    // 读取缓存文件并返回Data URI
    try {
        const fileBuffer = await readFile(cacheFilename);
        return `data:image/webp;base64,${fileBuffer.toString('base64')}`;
    } catch (readError) {
        console.error(`读取缩略图缓存失败: ${cacheFilename}`, readError);
        return null;
    }
}

module.exports = {
    ensureCacheDir,
    generateThumbnail
};