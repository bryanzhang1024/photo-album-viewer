/* eslint-disable no-console */
/**
 * 探针 — 定位 macOS 原生缩略图路径到底卡在哪一步
 *
 * 运行: npx electron scripts/probe-native-thumb.js
 * 每一步都同步落盘到 LOG，避免 stdout 缓冲掩盖真实进度。
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const LOG = path.join(os.tmpdir(), 'probe-native-thumb.log');
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT || 20000);

fs.writeFileSync(LOG, '', 'utf8');
function log(line) {
  const s = `${((Date.now() - START) / 1000).toFixed(2)}s  ${line}`;
  console.log(s);
  fs.appendFileSync(LOG, s + '\n', 'utf8');
}
const START = Date.now();

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`TIMEOUT(${ms}ms) @ ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  const all = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));

  log(`样本 ${all.length} 张  超时阈值 ${TIMEOUT_MS}ms`);
  log(`Electron ${process.versions.electron} / Node ${process.versions.node} / 核心 ${os.cpus().length}`);

  // 基线：sharp 参照
  log('');
  log('--- 基线: sharp 600x900 ---');
  for (const f of all.slice(0, 2)) {
    const t0 = Date.now();
    await sharp(f).resize({ width: 600, height: 900, fit: 'cover' }).webp({ quality: 80 }).toBuffer();
    log(`  sharp  ${Date.now() - t0}ms  ${path.basename(f).slice(0, 40)}`);
  }

  // 探针 1: createThumbnailFromPath 分尺寸
  for (const size of [128, 600]) {
    log('');
    log(`--- createThumbnailFromPath ${size}px ---`);
    for (const f of all.slice(0, 4)) {
      const t0 = Date.now();
      try {
        const img = await withTimeout(
          nativeImage.createThumbnailFromPath(f, { width: size, height: size }),
          TIMEOUT_MS,
          `createThumbnailFromPath ${size}`
        );
        const el = Date.now() - t0;
        const sz = img && !img.isEmpty() ? img.getSize() : null;
        log(`  ok   ${String(el).padStart(6)}ms  尺寸=${sz ? `${sz.width}x${sz.height}` : '空'}  ${path.basename(f).slice(0, 34)}`);
      } catch (err) {
        log(`  FAIL ${String(Date.now() - t0).padStart(6)}ms  ${err.message}`);
      }
    }
  }

  // 探针 2: app.getFileIcon（isSystemFileIcon 每次都调）
  log('');
  log('--- app.getFileIcon size=large ---');
  for (const f of all.slice(0, 3)) {
    const t0 = Date.now();
    try {
      const icon = await withTimeout(app.getFileIcon(f, { size: 'large' }), TIMEOUT_MS, 'getFileIcon');
      const sz = icon && !icon.isEmpty() ? icon.getSize() : null;
      log(`  ok   ${String(Date.now() - t0).padStart(6)}ms  尺寸=${sz ? `${sz.width}x${sz.height}` : '空'}`);
    } catch (err) {
      log(`  FAIL ${String(Date.now() - t0).padStart(6)}ms  ${err.message}`);
    }
  }

  // 探针 3: createFromPath + resize（Chromium/Skia 路径）
  log('');
  log('--- nativeImage.createFromPath + resize + toJPEG ---');
  for (const f of all.slice(0, 3)) {
    const t0 = Date.now();
    try {
      const img = nativeImage.createFromPath(f);
      if (!img || img.isEmpty()) throw new Error('空图');
      const out = img.resize({ width: 600 }).toJPEG(80);
      log(`  ok   ${String(Date.now() - t0).padStart(6)}ms  源=${img.getSize().width}x${img.getSize().height}  输出=${(out.length / 1024).toFixed(0)}KB`);
    } catch (err) {
      log(`  FAIL ${String(Date.now() - t0).padStart(6)}ms  ${err.message}`);
    }
  }

  log('');
  log('探针完成。');
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (err) => {
    log(`致命错误: ${err && err.stack ? err.stack : err}`);
    app.exit(1);
  }
);

// 兜底：整脚本硬超时，避免再次挂死
setTimeout(() => {
  log(`!! 全局硬超时 ${TIMEOUT_MS * 6}ms，强制退出`);
  app.exit(2);
}, TIMEOUT_MS * 6).unref();
