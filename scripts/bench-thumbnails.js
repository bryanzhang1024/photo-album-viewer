/* eslint-disable no-console */
/**
 * 缩略图性能基准 — sharp (libvips) vs macOS 原生 ImageIO/QuickLook
 *
 * 运行:
 *   npx electron scripts/bench-thumbnails.js
 *
 * 环境变量:
 *   BENCH_LIST  样本清单文件（每行一个绝对路径），默认 /tmp/thumb-bench-sample.txt
 *   BENCH_N     顺序延迟测量的样本数，默认 20
 *   BENCH_GRID  并发吞吐测量的样本数，默认 60
 *
 * 安全: 只读源图；只往系统临时目录写输出。
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const OUT = path.join(os.tmpdir(), 'thumb-bench-out');
const SIZE = 300;
const N_SEQ = Number(process.env.BENCH_N || 20);
const N_GRID = Number(process.env.BENCH_GRID || 60);

// 与 ThumbnailService.js 保持一致的参数
const COVER = { width: SIZE, height: SIZE, fit: sharp.fit.cover, withoutEnlargement: true };
const WEBP = { quality: 80 };

function stats(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { n: a.length, mean, p50: q(0.5), p90: q(0.9), min: a[0], max: a[a.length - 1] };
}

const fmt = (s) =>
  s ? `n=${s.n} mean=${s.mean.toFixed(1)}ms p50=${s.p50.toFixed(1)}ms p90=${s.p90.toFixed(1)}ms min=${s.min.toFixed(1)} max=${s.max.toFixed(1)}` : 'n=0';

async function timeMany(files, fn) {
  const times = [];
  let failures = 0;
  for (const f of files) {
    const t0 = performance.now();
    try {
      await fn(f);
      times.push(performance.now() - t0);
    } catch (err) {
      failures++;
      console.warn(`    ! ${path.basename(f)}: ${err.message}`);
    }
  }
  return { times, failures };
}

/** 并发受限的 map */
async function mapPool(items, limit, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function timePool(files, limit, fn) {
  let failures = 0;
  const t0 = performance.now();
  await mapPool(files, limit, async (f) => {
    try {
      await fn(f);
    } catch {
      failures++;
    }
  });
  return { wall: performance.now() - t0, failures };
}

function section(title) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);
}

function line(label, s, extra = '') {
  console.log(`  ${label.padEnd(34)} ${fmt(s)}${extra}`);
}

async function main() {
  const all = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => fs.existsSync(f));

  if (!all.length) throw new Error(`样本清单为空: ${LIST}`);

  await fsp.mkdir(OUT, { recursive: true });
  const seq = all.slice(0, N_SEQ);
  const grid = all.slice(0, N_GRID);

  console.log(`样本清单: ${LIST}`);
  console.log(`可用样本: ${all.length}  顺序测量: ${seq.length}  并发测量: ${grid.length}`);
  console.log(`sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips} / mozjpeg ${sharp.versions.mozjpeg} / webp ${sharp.versions.webp}`);

  // 样本画像
  section('0. 样本画像');
  const sizes = await Promise.all(seq.map(async (f) => (await fsp.stat(f)).size));
  const metas = [];
  for (const f of seq.slice(0, 8)) metas.push(await sharp(f).metadata());
  console.log(`  文件大小  mean=${(sizes.reduce((a, b) => a + b, 0) / sizes.length / 1024).toFixed(0)}KB`);
  const dims = metas.map((m) => `${m.width}x${m.height}`);
  const mp = metas.map((m) => (m.width * m.height) / 1e6);
  console.log(`  像素规模  mean=${(mp.reduce((a, b) => a + b, 0) / mp.length).toFixed(1)}MP  例: ${[...new Set(dims)].slice(0, 4).join(', ')}`);

  // 预热：JIT + QL 守护进程 + 页缓存
  console.log('\n预热中…');
  for (const f of seq.slice(0, 3)) {
    try {
      await sharp(f).resize(COVER).webp(WEBP).toBuffer();
      const img = await nativeImage.createThumbnailFromPath(f, { width: SIZE, height: SIZE });
      img?.toBitmap?.();
    } catch { /* 预热失败不影响测量 */ }
  }

  section('1. 顺序单张延迟（越低越好）');
  const strategies = [
    ['fs.readFile（纯 I/O 下限）', (f) => fsp.readFile(f)],
    ['sharp.metadata（只读文件头）', (f) => sharp(f).metadata()],
    ['sharp 解码+cover300 → 原始像素', (f) => sharp(f).resize(COVER).toBuffer()],
    ['sharp 解码+cover300 → webp80', (f) => sharp(f).resize(COVER).webp(WEBP).toBuffer()],
    ['sharp 解码+cover300 → webp80 → 落盘', (f) => sharp(f).resize(COVER).webp(WEBP).toFile(path.join(OUT, 'a.webp'))],
    ['macOS 原生 createThumbnailFromPath', async (f) => { const i = await nativeImage.createThumbnailFromPath(f, { width: SIZE, height: SIZE }); if (!i || i.isEmpty()) throw new Error('空缩略图'); return i; }],
    ['macOS 原生 + toPNG（回退路径）', async (f) => { const i = await nativeImage.createThumbnailFromPath(f, { width: SIZE, height: SIZE }); if (!i || i.isEmpty()) throw new Error('空缩略图'); return i.toPNG(); }],
  ];

  const results = {};
  for (const [label, fn] of strategies) {
    const { times, failures } = await timeMany(seq, fn);
    results[label] = { stats: stats(times), failures };
    line(label, results[label].stats, failures ? `  失败=${failures}` : '');
  }

  section('2. 编码成本拆解');
  const rawBuf = await sharp(seq[0]).resize(COVER).toBuffer();
  const tEnc = performance.now();
  for (let i = 0; i < 5; i++) await sharp(rawBuf, { raw: { width: SIZE, height: SIZE, channels: 3 } }).webp(WEBP).toBuffer();
  console.log(`  300x300 原始像素 → webp80        ${((performance.now() - tEnc) / 5).toFixed(1)}ms/张`);
  const nativeImg = await nativeImage.createThumbnailFromPath(seq[0], { width: SIZE, height: SIZE });
  const tPng = performance.now();
  for (let i = 0; i < 5; i++) nativeImg.toPNG();
  console.log(`  NativeImage → PNG 编码          ${((performance.now() - tPng) / 5).toFixed(1)}ms/张`);

  section('3. 主进程阻塞项（ThumbnailService 现存逻辑）');
  const bmp = nativeImg.toBitmap();
  const tIcon = performance.now();
  for (let i = 0; i < 5; i++) {
    // 复刻 isSystemFileIcon 的逐像素比较循环（L253-271）
    const total = bmp.length / 4;
    const threshold = Math.ceil(total * 0.2);
    let mismatched = 0;
    for (let j = 0; j < bmp.length; j += 4) {
      if (bmp[j] !== bmp[j] || bmp[j + 1] !== bmp[j + 1] || bmp[j + 2] !== bmp[j + 2]) {
        mismatched++;
        if (mismatched > threshold) break;
      }
    }
  }
  console.log(`  逐像素比对循环 (${SIZE}x${SIZE})        ${((performance.now() - tIcon) / 5).toFixed(1)}ms/次  ← 同步阻塞主进程`);
  const tExists = performance.now();
  for (let i = 0; i < 1000; i++) fs.existsSync(seq[0]);
  console.log(`  fs.existsSync ×1000              ${(performance.now() - tExists).toFixed(1)}ms`);

  section('4. 网格填充吞吐（整批墙钟时间，越低越好）');
  for (const conc of [3, 8, 12]) {
    const sharpRun = await timePool(grid, conc, (f) => sharp(f).resize(COVER).webp(WEBP).toFile(path.join(OUT, 'b.webp')));
    const nativeRun = await timePool(grid, conc, async (f) => {
      const i = await nativeImage.createThumbnailFromPath(f, { width: SIZE, height: SIZE });
      if (!i || i.isEmpty()) throw new Error('空缩略图');
    });
    console.log(
      `  并发=${String(conc).padStart(2)}  sharp 全链路 ${String(sharpRun.wall.toFixed(0)).padStart(6)}ms` +
        `  |  原生 ImageIO ${String(nativeRun.wall.toFixed(0)).padStart(6)}ms` +
        `  →  ${(sharpRun.wall / nativeRun.wall).toFixed(2)}x`
    );
  }
  console.log(`\n  （${grid.length} 张，桌面 300px 网格量级）`);

  // 汇总
  section('5. 结论摘要');
  const a = results['sharp 解码+cover300 → webp80 → 落盘'].stats;
  const b = results['macOS 原生 createThumbnailFromPath'].stats;
  const c = results['sharp 解码+cover300 → 原始像素'].stats;
  const io = results['fs.readFile（纯 I/O 下限）'].stats;
  console.log(`  单张 I/O 下限            ${io.p50.toFixed(1)}ms`);
  console.log(`  当前链路 (sharp→webp→盘)  ${a.p50.toFixed(1)}ms`);
  console.log(`  原生 ImageIO             ${b.p50.toFixed(1)}ms`);
  console.log(`  纯解码 (无编码)           ${c.p50.toFixed(1)}ms`);
  console.log(`  编码+落盘占比             ${(((a.p50 - c.p50) / a.p50) * 100).toFixed(0)}%`);
  console.log(`  原生/当前 速度比           ${(a.p50 / b.p50).toFixed(2)}x`);

  await fsp.rm(OUT, { recursive: true, force: true });
  console.log('\n完成。');
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (err) => {
    console.error('\n基准失败:', err);
    app.exit(1);
  }
);
