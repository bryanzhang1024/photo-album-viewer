/* eslint-disable no-console */
/**
 * 验证：WebP effort 对缩略图链路的实际影响
 *
 * 运行: npx electron scripts/verify-webp-effort.js
 *
 * 分两个层次测量，因为两者结论差别很大：
 *   0 节「隔离编码」：同一批已解码 raw 像素只比编码，反映 effort 对编码器本身的作用
 *   1/2 节「端到端」：走真实 ThumbnailService（真实解码 + 真实落盘）
 *
 * 教训：不要用隔离编码的比例去外推端到端收益。编码只占链路的一部分，
 * 曾经用「编码 −57%」外推出「端到端 −28%」，实测只有 −13%，因为外推时
 * 假设的解码耗时来自另一组样本。
 *
 * 走真实服务路径时两个 effort 各用独立缓存目录；顺序测量交替进行以抵消热漂移。
 * 只读源图；只往系统临时目录写输出。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const BASE_DIR = path.join(os.tmpdir(), 'thumb-webp-effort-verify');
app.setPath('userData', BASE_DIR);

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const RES = 600;
const HEIGHT = Math.round(RES * 1.5);
const COVER = { width: RES, height: HEIGHT, fit: sharp.fit.cover, withoutEnlargement: true };
const N_SEQ = Number(process.env.WEBP_N_SEQ || 12);
const N_GRID = Number(process.env.WEBP_N_GRID || 36);
const N_ENC = Number(process.env.WEBP_N_ENC || 8);
const CONCURRENCY = 6;
const BEFORE_EFFORT = 4; // sharp 默认，即改动前
const AFTER_EFFORT = 2; // 改动后

// 阈值依据实测而非预期：「孤立编码」应省一半以上；端到端只占链路的一部分，
// 故门槛设在 8%/5%，只用来判断改善是否超过噪声。
const MIN_ENCODE_GAIN = 40;
const MIN_E2E_SEQ_GAIN = 8;
const MIN_E2E_GRID_GAIN = 5;

const PASS = [];
const FAIL = [];

function check(name, condition, detail) {
  if (condition) {
    PASS.push(name);
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    FAIL.push(name);
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

const section = (title) => console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    n: sorted.length,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    p50: q(0.5),
    p90: q(0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1]
  };
}

const fmt = (s) => `p50=${s.p50.toFixed(0)}ms mean=${s.mean.toFixed(0)}ms p90=${s.p90.toFixed(0)}ms`;

const cacheDirFor = (effort) => path.join(BASE_DIR, `thumbnails-effort-${effort}`);
const outPathFor = (service, imagePath) => service.generateCacheFilename(imagePath, RES, HEIGHT, 'webp');

function useCacheDir(service, effort) {
  service.cacheDir = cacheDirFor(effort);
  service.cacheDirReady = true;
}

/** 逐张测量，两个 effort 在同一循环里交替，抵消时间漂移 */
async function measureInterleaved(service, files) {
  const result = {
    [BEFORE_EFFORT]: { times: [], sizes: [], failures: 0 },
    [AFTER_EFFORT]: { times: [], sizes: [], failures: 0 }
  };

  for (const file of files) {
    for (const effort of [BEFORE_EFFORT, AFTER_EFFORT]) {
      service.WEBP_OPTIONS = { quality: 80, effort };
      useCacheDir(service, effort);

      const startedAt = performance.now();
      // eslint-disable-next-line no-await-in-loop
      const url = await service.generateThumbnail(file, RES, HEIGHT, 0);
      const elapsed = performance.now() - startedAt;

      const bucket = result[effort];
      bucket.times.push(elapsed);
      if (!url) {
        bucket.failures += 1;
        continue;
      }
      const outPath = outPathFor(service, file);
      bucket.sizes.push(fs.existsSync(outPath) ? fs.statSync(outPath).size : 0);
    }
  }

  return result;
}

async function measureThroughput(service, files, effort) {
  service.WEBP_OPTIONS = { quality: 80, effort };
  useCacheDir(service, effort);
  service.setMaxWorkers(CONCURRENCY);

  const startedAt = performance.now();
  const results = await Promise.all(
    files.map((file) => service.generateThumbnail(file, RES, HEIGHT, 0).catch(() => null))
  );
  const wall = performance.now() - startedAt;

  return {
    wall,
    rate: files.length / (wall / 1000),
    failures: results.filter((r) => !r).length
  };
}

/** effort 只影响编码搜索强度：量化表由 quality 决定，所以两者观感应几乎一致 */
async function pixelDelta(fileA, fileB) {
  const a = await sharp(fileA).raw().toBuffer();
  const b = await sharp(fileB).raw().toBuffer();
  if (a.length !== b.length) {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  const mse = sum / a.length;
  return {
    rmse: Math.sqrt(mse),
    psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
  };
}

async function main() {
  const samples = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));

  if (samples.length < N_SEQ + N_GRID + N_ENC) {
    throw new Error(`样本不足: ${samples.length}`);
  }

  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  for (const effort of [BEFORE_EFFORT, AFTER_EFFORT]) {
    fs.mkdirSync(cacheDirFor(effort), { recursive: true });
  }

  // eslint-disable-next-line global-require
  const ThumbnailService = require('../src/main/services/ThumbnailService');
  const service = ThumbnailService.thumbnailService;

  const seqFiles = samples.slice(0, N_SEQ);
  const gridFiles = samples.slice(N_SEQ, N_SEQ + N_GRID);
  const encFiles = samples.slice(N_SEQ + N_GRID, N_SEQ + N_GRID + N_ENC);

  console.log(`样本 ${samples.length} 张   目标规格 ${RES}x${HEIGHT}`);
  console.log(`对比 effort ${BEFORE_EFFORT}（改动前，sharp 默认） vs effort ${AFTER_EFFORT}（改动后）`);

  // 预热：JIT + libvips 初始化 + 编码器初始化
  useCacheDir(service, BEFORE_EFFORT);
  service.WEBP_OPTIONS = { quality: 80, effort: BEFORE_EFFORT };
  await service.generateThumbnail(seqFiles[0], RES, HEIGHT, 0);

  // ── 0：隔离编码 ────────────────────────────────────────────
  section('0. 隔离编码（同一批已解码 raw 像素，只比编码）');
  const rawInputs = [];
  for (const file of encFiles) {
    // eslint-disable-next-line no-await-in-loop
    rawInputs.push(await sharp(file).resize(COVER).raw().toBuffer({ resolveWithObject: true }));
  }
  const encTimes = { [BEFORE_EFFORT]: [], [AFTER_EFFORT]: [] };
  const encSizes = { [BEFORE_EFFORT]: [], [AFTER_EFFORT]: [] };
  for (const raw of rawInputs) {
    for (const effort of [BEFORE_EFFORT, AFTER_EFFORT]) {
      const startedAt = performance.now();
      // eslint-disable-next-line no-await-in-loop
      const buffer = await sharp(raw.data, {
        raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels }
      })
        .webp({ quality: 80, effort })
        .toBuffer();
      encTimes[effort].push(performance.now() - startedAt);
      encSizes[effort].push(buffer.length);
    }
  }
  const encBefore = stats(encTimes[BEFORE_EFFORT]);
  const encAfter = stats(encTimes[AFTER_EFFORT]);
  const encGain = (1 - encAfter.p50 / encBefore.p50) * 100;
  console.log(
    `  effort ${BEFORE_EFFORT} 编码  ${fmt(encBefore)}  ${(encSizes[BEFORE_EFFORT].reduce((a, b) => a + b, 0) / encSizes[BEFORE_EFFORT].length / 1024).toFixed(0)}KB`
  );
  console.log(
    `  effort ${AFTER_EFFORT} 编码  ${fmt(encAfter)}  ${(encSizes[AFTER_EFFORT].reduce((a, b) => a + b, 0) / encSizes[AFTER_EFFORT].length / 1024).toFixed(0)}KB`
  );
  console.log(`  → 编码本身 ${encBefore.p50.toFixed(0)}ms → ${encAfter.p50.toFixed(0)}ms（−${encGain.toFixed(0)}%），这 20ms 级差值只是链路的一部分`);
  check('隔离编码明显加快', encGain >= MIN_ENCODE_GAIN, `−${encGain.toFixed(0)}%`);

  // ── 1：端到端单张 ─────────────────────────────────────────
  section('1. 端到端单张延迟（真实服务路径，交替测量）');
  const seq = await measureInterleaved(service, seqFiles);
  const beforeSeq = stats(seq[BEFORE_EFFORT].times);
  const afterSeq = stats(seq[AFTER_EFFORT].times);
  const beforeSize = seq[BEFORE_EFFORT].sizes.reduce((a, b) => a + b, 0) / seq[BEFORE_EFFORT].sizes.length;
  const afterSize = seq[AFTER_EFFORT].sizes.reduce((a, b) => a + b, 0) / seq[AFTER_EFFORT].sizes.length;

  console.log(`  effort ${BEFORE_EFFORT}（改动前）  ${fmt(beforeSeq)}  平均 ${(beforeSize / 1024).toFixed(0)}KB  失败 ${seq[BEFORE_EFFORT].failures}`);
  console.log(`  effort ${AFTER_EFFORT}（改动后）  ${fmt(afterSeq)}  平均 ${(afterSize / 1024).toFixed(0)}KB  失败 ${seq[AFTER_EFFORT].failures}`);
  const seqGain = (1 - afterSeq.p50 / beforeSeq.p50) * 100;
  const sizeCost = (afterSize / beforeSize - 1) * 100;
  console.log(`  → 单张 p50 ${beforeSeq.p50.toFixed(0)}ms → ${afterSeq.p50.toFixed(0)}ms（−${seqGain.toFixed(0)}%），体积 +${sizeCost.toFixed(1)}%`);

  check('端到端单张下降', seqGain >= MIN_E2E_SEQ_GAIN, `−${seqGain.toFixed(0)}%`);
  check('体积增幅在 15% 以内', sizeCost <= 15, `+${sizeCost.toFixed(1)}%`);
  check('两个 effort 都没有失败', seq[BEFORE_EFFORT].failures === 0 && seq[AFTER_EFFORT].failures === 0);

  // ── 2：并发吞吐 ───────────────────────────────────────────
  section('2. 并发吞吐（真实网格行为）');
  const beforeGrid = await measureThroughput(service, gridFiles, BEFORE_EFFORT);
  const afterGrid = await measureThroughput(service, gridFiles, AFTER_EFFORT);
  console.log(`  effort ${BEFORE_EFFORT}（改动前）  ${beforeGrid.wall.toFixed(0)}ms  ${beforeGrid.rate.toFixed(1)} 张/秒  失败 ${beforeGrid.failures}`);
  console.log(`  effort ${AFTER_EFFORT}（改动后）  ${afterGrid.wall.toFixed(0)}ms  ${afterGrid.rate.toFixed(1)} 张/秒  失败 ${afterGrid.failures}`);
  const gridGain = (1 - afterGrid.wall / beforeGrid.wall) * 100;
  console.log(`  → 整批墙钟 ${beforeGrid.wall.toFixed(0)}ms → ${afterGrid.wall.toFixed(0)}ms（−${gridGain.toFixed(0)}%）`);
  check('端到端整批墙钟下降', gridGain >= MIN_E2E_GRID_GAIN, `−${gridGain.toFixed(0)}%`);

  // ── 3：画质差异 ───────────────────────────────────────────
  section('3. 输出画质差异（effort 只改编码搜索强度，不改量化表）');
  const deltas = [];
  for (const file of seqFiles.slice(0, 6)) {
    const beforeFile = path.join(cacheDirFor(BEFORE_EFFORT), path.basename(outPathFor(service, file)));
    const afterFile = path.join(cacheDirFor(AFTER_EFFORT), path.basename(outPathFor(service, file)));
    // eslint-disable-next-line no-await-in-loop
    const delta = await pixelDelta(beforeFile, afterFile);
    if (delta) {
      deltas.push(delta);
      console.log(`  ${path.basename(file).slice(0, 30).padEnd(32)} RMSE ${delta.rmse.toFixed(2)}  PSNR ${delta.psnr.toFixed(1)}dB`);
    }
  }
  const avgRmse = deltas.reduce((a, d) => a + d.rmse, 0) / deltas.length;
  const worstRmse = Math.max(...deltas.map((d) => d.rmse));
  console.log(`  → 平均 RMSE ${avgRmse.toFixed(2)}，最大 ${worstRmse.toFixed(2)}（0–255 量纲）`);
  check('画质差异可忽略（平均 RMSE < 3）', avgRmse < 3, `平均 ${avgRmse.toFixed(2)}`);

  section('结果');
  console.log(`  通过 ${PASS.length}   失败 ${FAIL.length}`);
  FAIL.forEach((name) => console.log(`  ✗ ${name}`));
  console.log(FAIL.length === 0 ? '\n全部通过。' : '\n存在失败项。');

  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  return FAIL.length;
}

app.whenReady()
  .then(main)
  .then((failed) => app.exit(failed === 0 ? 0 : 1))
  .catch((error) => {
    console.error('\n验证脚本异常:', error);
    app.exit(2);
  });
