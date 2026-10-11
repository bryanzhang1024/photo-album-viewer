/* eslint-disable no-console */
/**
 * 缩略图基准 第二轮 — 针对生产配置（600x900）和并发模型
 *
 * 运行:
 *   npx electron scripts/bench-thumbnails-2.js
 *
 * ⚠️ 第 1 节调用 nativeImage.createThumbnailFromPath，该 API 在本机实测可挂起
 *    不返回（曾导致整进程 22 分钟 0% CPU）。脚本末尾有全局硬超时兜底；
 *    若要单独重跑纯 sharp 部分，请改用 bench-thumbnails-3.js。
 *
 * 只读源图；只往系统临时目录写输出。
 */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sharp = require('sharp');

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const OUT = path.join(os.tmpdir(), 'thumb-bench-out2');
const RES = 600; // 生产配置 thumbnailResolution
const COVER = { width: RES, height: Math.round(RES * 1.5), fit: sharp.fit.cover, withoutEnlargement: true };
const WEBP = { quality: 80 };

function stats(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return { n: a.length, mean, p50: q(0.5), p90: q(0.9), min: a[0], max: a[a.length - 1] };
}
const fmt = (s) =>
  s ? `n=${s.n} mean=${s.mean.toFixed(0)} p50=${s.p50.toFixed(0)} p90=${s.p90.toFixed(0)} min=${s.min.toFixed(0)} max=${s.max.toFixed(0)}` : 'n=0';

async function mapPool(items, limit, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        await fn(item);
      }
    })
  );
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

/** 并发场景每张图必须写到不同文件，否则写入互相竞争会低估吞吐 */
const uniqueOut = (tag, key) =>
  path.join(OUT, `${tag}-${crypto.createHash('md5').update(key).digest('hex').slice(0, 16)}.webp`);

const section = (t) => console.log(`\n${'─'.repeat(72)}\n${t}\n${'─'.repeat(72)}`);

async function main() {
  const all = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));
  await fsp.mkdir(OUT, { recursive: true });

  const seq = all.slice(0, 15);
  const grid = all.slice(0, 48);

  section('0. 环境');
  console.log(`  CPU 核心        ${os.cpus().length} (${os.cpus()[0].model.trim()})`);
  console.log(`  内存            ${(os.totalmem() / 1e9).toFixed(0)}GB`);
  console.log(`  libvips 线程    sharp.concurrency() = ${sharp.concurrency()}`);
  console.log(`  生产缩略图规格  ${COVER.width}x${COVER.height} webp q${WEBP.quality}`);
  console.log(`  Electron        ${process.versions.electron}  /  Node ${process.versions.node}`);

  // 预热
  for (const f of seq.slice(0, 3)) {
    try {
      await sharp(f).resize(COVER).webp(WEBP).toBuffer();
      await nativeImage.createThumbnailFromPath(f, { width: RES, height: RES });
    } catch { /* ignore */ }
  }

  section('1. macOS 原生路径深度检查');
  for (const size of [128, 300, 600, 1024]) {
    const times = [];
    let invalid = 0;
    for (const f of seq) {
      const t0 = performance.now();
      try {
        const img = await nativeImage.createThumbnailFromPath(f, { width: size, height: size });
        times.push(performance.now() - t0);
        if (!img || img.isEmpty()) invalid++;
      } catch {
        times.push(performance.now() - t0);
        invalid++;
      }
    }
    console.log(`  createThumbnailFromPath ${String(size).padStart(4)}px  ${fmt(stats(times))}  无效=${invalid}`);
  }

  const tIcon0 = performance.now();
  try {
    for (const f of seq.slice(0, 5)) await app.getFileIcon(f, { size: 'large' });
    console.log(`  app.getFileIcon('large')  ×5          ${((performance.now() - tIcon0) / 5).toFixed(0)}ms/次  ← isSystemFileIcon 每次都调`);
  } catch (e) {
    console.log(`  app.getFileIcon 失败: ${e.message}`);
  }

  const tFromPath = [];
  for (const f of seq.slice(0, 8)) {
    const t0 = performance.now();
    const i = nativeImage.createFromPath(f);
    tFromPath.push(performance.now() - t0);
    if (i && !i.isEmpty()) i.resize({ width: RES }).toJPEG(80);
  }
  console.log(`  createFromPath+resize+toJPEG          ${fmt(stats(tFromPath))}  ← Chromium/Skia 解码路径`);

  section('2. sharp 生产链路（600x900）单张延迟');
  const variants = [
    ['解码 → cover600x900 → webp80 → 落盘', () => sharp(seq[0]).resize(COVER).webp(WEBP).toFile(path.join(OUT, 'p.webp'))],
    ['仅解码+缩放 → raw（无编码）', null],
    ['仅解码（不做缩放）→ raw', null],
  ];
  // 变体 1
  {
    const t = [];
    for (const f of seq) {
      const t0 = performance.now();
      await sharp(f).resize(COVER).webp(WEBP).toFile(path.join(OUT, 'p.webp'));
      t.push(performance.now() - t0);
    }
    console.log(`  ${variants[0][0].padEnd(36)} ${fmt(stats(t))}`);
  }
  // 变体 2
  {
    const t = [];
    for (const f of seq) {
      const t0 = performance.now();
      await sharp(f).resize(COVER).raw().toBuffer();
      t.push(performance.now() - t0);
    }
    console.log(`  ${variants[1][0].padEnd(36)} ${fmt(stats(t))}`);
  }
  // 变体 3
  {
    const t = [];
    for (const f of seq) {
      const t0 = performance.now();
      await sharp(f).raw().toBuffer();
      t.push(performance.now() - t0);
    }
    console.log(`  ${variants[2][0].padEnd(36)} ${fmt(stats(t))}`);
  }
  // 变体 4: 关闭 fastShrinkOnLoad 对比
  {
    const t = [];
    for (const f of seq) {
      const t0 = performance.now();
      await sharp(f).resize({ ...COVER, fastShrinkOnLoad: false }).webp(WEBP).toFile(path.join(OUT, 'p.webp'));
      t.push(performance.now() - t0);
    }
    console.log(`  ${'同上但 fastShrinkOnLoad=false'.padEnd(36)} ${fmt(stats(t))}`);
  }

  section('3. 并发吞吐（48 张，整批墙钟时间）');
  console.log('  外层并发 × libvips 线程  = 墙钟时间 / 单张均摊 / 有效吞吐');
  for (const vipsThreads of [0, 1]) {
    if (vipsThreads > 0) sharp.concurrency(vipsThreads);
    const label = vipsThreads === 0 ? `libvips 默认(${sharp.concurrency()})` : `libvips=${vipsThreads}`;
    for (const conc of [3, 6, 10, 14]) {
      const run = await timePool(grid, conc, (f) => sharp(f).resize(COVER).webp(WEBP).toFile(uniqueOut('c', f)));
      console.log(
        `  并发=${String(conc).padStart(2)} × ${label.padEnd(16)} ${String(run.wall.toFixed(0)).padStart(6)}ms` +
          `  ${String((run.wall / grid.length).toFixed(0)).padStart(4)}ms/张` +
          `  ${String((grid.length / (run.wall / 1000)).toFixed(1)).padStart(5)} 张/秒`
      );
    }
  }
  sharp.concurrency(0);

  section('4. 队列开销：100ms 轮询 vs 直接派发');
  {
    // 模拟 ThumbnailService.waitAndGenerate 的 100ms 轮询
    const tasks = grid.slice(0, 24);
    const t0 = performance.now();
    let active = 0;
    const MAX = 3;
    await Promise.all(
      tasks.map(async (f) => {
        while (active >= MAX) await new Promise((r) => setTimeout(r, 100));
        active++;
        try {
          await sharp(f).resize(COVER).webp(WEBP).toFile(uniqueOut('q-poll', f));
        } finally {
          active--;
        }
      })
    );
    const polling = performance.now() - t0;
    const direct = await timePool(tasks, MAX, (f) => sharp(f).resize(COVER).webp(WEBP).toFile(uniqueOut('q-direct', f)));
    console.log(`  轮询队列（当前实现）      ${polling.toFixed(0)}ms`);
    console.log(`  直接派发（同等并发）      ${direct.wall.toFixed(0)}ms`);
    console.log(`  轮询带来的额外开销        +${(polling - direct.wall).toFixed(0)}ms  (${(((polling - direct.wall) / polling) * 100).toFixed(0)}%)`);
  }

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

// 兜底：原生缩略图 API 可能永久挂起，硬超时强制退出
const HARD_TIMEOUT_MS = Number(process.env.BENCH_HARD_TIMEOUT || 600000);
setTimeout(() => {
  console.error(`\n!! 全局硬超时 ${HARD_TIMEOUT_MS}ms，强制退出（很可能卡在原生缩略图 API）`);
  app.exit(2);
}, HARD_TIMEOUT_MS).unref();
