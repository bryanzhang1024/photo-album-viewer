/* eslint-disable no-console */
/**
 * 端到端验证：优先级派发与滚动取消（真实解码，非 mock）
 *
 * 运行: npx electron scripts/verify-thumbnail-queue.js
 *
 * 把 userData 指向临时目录，从而保证所有样本都是冷缓存、走真实解码路径。
 * 只读源图；只往临时目录写输出。
 *
 * 断言刻意做成时序无关：真实解码耗时约 150ms，任何依赖「等 N 毫秒后正好
 * 完成 M 个任务」的假设都不可靠。这里只断言顺序性质与计数关系。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERIFY_USER_DATA = path.join(os.tmpdir(), 'thumb-verify-userdata');
app.setPath('userData', VERIFY_USER_DATA);

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const RES = 600;
const HEIGHT = Math.round(RES * 1.5);

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

/** 记录真实解码的开始顺序，同时保留真实实现 */
function instrument(service) {
  const started = [];
  const original = service.processThumbnail.bind(service);
  service.processThumbnail = (imagePath, width, height, cacheFilenames) => {
    started.push(imagePath);
    return original(imagePath, width, height, cacheFilenames);
  };
  return started;
}

function realFileExists(service, imagePath) {
  const webp = service.generateCacheFilename(imagePath, RES, HEIGHT, 'webp');
  const png = service.generateCacheFilename(imagePath, RES, HEIGHT, 'png');
  return fs.existsSync(webp) || fs.existsSync(png);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const samples = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));

  if (samples.length < 110) {
    throw new Error(`样本不足: ${samples.length}，至少需要 110 张`);
  }

  // eslint-disable-next-line global-require
  const ThumbnailService = require('../src/main/services/ThumbnailService');
  const service = ThumbnailService.thumbnailService;

  fs.rmSync(VERIFY_USER_DATA, { recursive: true, force: true });

  console.log(`userData（临时）: ${VERIFY_USER_DATA}`);
  console.log(`样本: ${samples.length} 张   目标规格: ${RES}x${HEIGHT}`);

  // ── 场景 1：可见优先于屏外前瞻 ──────────────────────────────
  section('场景 1：可见任务插队（真实解码，并发 1）');
  service.setMaxWorkers(1);
  const started1 = instrument(service);

  const prefetchPaths = samples.slice(0, 24);
  const visiblePath = samples[24];

  const prefetchTasks = prefetchPaths.map((p) => service.generateThumbnail(p, RES, HEIGHT, 1));
  await sleep(400); // 让若干前瞻任务真实开始，队列里仍有存量

  const queuedPrefetchBefore = service.getRuntimeStats().queuedPrefetch;
  const visibleTask = service.generateThumbnail(visiblePath, RES, HEIGHT, 0);

  check(
    '提交可见任务时队列里仍有前瞻任务',
    queuedPrefetchBefore > 0,
    `queuedPrefetch=${queuedPrefetchBefore}`
  );
  check('可见任务已入队', service.getRuntimeStats().queuedVisible === 1);

  await Promise.all([...prefetchTasks, visibleTask]);

  const visibleIndex = started1.indexOf(visiblePath);
  const prefetchStartedAfterVisible = prefetchPaths.filter(
    (p) => started1.indexOf(p) > visibleIndex
  ).length;

  check(
    '可见任务插到当时所有排队前瞻任务之前',
    prefetchStartedAfterVisible >= queuedPrefetchBefore,
    `提交时排队 ${queuedPrefetchBefore} 个前瞻，之后才开始的前瞻有 ${prefetchStartedAfterVisible} 个（可见任务启动位次 ${visibleIndex + 1}/${prefetchPaths.length + 1}）`
  );
  check(
    '所有任务最终都产出了缩略图文件',
    [...prefetchPaths, visiblePath].every((p) => realFileExists(service, p))
  );

  // ── 场景 2：取消尚未开始的排队任务 ─────────────────────────
  section('场景 2：取消划出视野的排队任务（真实解码，并发 1）');
  service.setMaxWorkers(1);
  const started2 = instrument(service);

  const blockPath = samples[25];
  const queuedPaths = samples.slice(26, 50);
  const keeperPaths = samples.slice(50, 53);

  const blockTask = service.generateThumbnail(blockPath, RES, HEIGHT, 0);
  await sleep(100);

  const queuedTasks = queuedPaths.map((p) => service.generateThumbnail(p, RES, HEIGHT, 0));
  const keeperTasks = keeperPaths.map((p) => service.generateThumbnail(p, RES, HEIGHT, 0));

  const cancelResult = service.cancelPending(queuedPaths);

  check(
    '取消 + 在途计数不超过提交数',
    cancelResult.cancelled + cancelResult.inFlight <= queuedPaths.length,
    JSON.stringify(cancelResult)
  );
  check('确实摘掉了排队任务', cancelResult.cancelled > 0, `cancelled=${cancelResult.cancelled}`);

  const cancelledResults = await Promise.all(queuedTasks);
  const nullCount = cancelledResults.filter((r) => r === null).length;
  check(
    '被取消的任务全部解析为 null',
    nullCount === cancelResult.cancelled,
    `null=${nullCount} cancelled=${cancelResult.cancelled}`
  );

  await Promise.all([blockTask, ...keeperTasks]);

  const startedSet = new Set(started2);
  const cancelledPaths = queuedPaths.filter((_, index) => cancelledResults[index] === null);
  const cancelledNeverStarted = cancelledPaths.filter((p) => !startedSet.has(p));

  check(
    '被取消的任务从未开始解码',
    cancelledNeverStarted.length === cancelledPaths.length,
    `被取消 ${cancelledPaths.length} 张，其中从未开始 ${cancelledNeverStarted.length} 张`
  );
  check(
    '保留的任务仍然完成并产出文件',
    keeperPaths.every((p) => realFileExists(service, p)),
    `${keeperPaths.filter((p) => realFileExists(service, p)).length}/${keeperPaths.length}`
  );
  check(
    '取消计数已计入统计',
    service.getRuntimeStats().cancelled === cancelResult.cancelled,
    `stats.cancelled=${service.getRuntimeStats().cancelled}`
  );

  // ── 场景 3：真实吞吐 ────────────────────────────────────────
  section('场景 3：真实吞吐（生产并发 6，冷缓存）');
  service.setMaxWorkers(6);
  const throughputPaths = samples.slice(58, 106); // 48 张与前两个场景不重叠

  const t0 = Date.now();
  await Promise.all(throughputPaths.map((p) => service.generateThumbnail(p, RES, HEIGHT, 0)));
  const wall = Date.now() - t0;
  const rate = throughputPaths.length / (wall / 1000);

  console.log(`  ${throughputPaths.length} 张耗时 ${wall}ms  →  ${rate.toFixed(1)} 张/秒`);

  const stats = service.getRuntimeStats();
  console.log(
    `  统计: activeWorkers=${stats.activeWorkers} pendingTasks=${stats.pendingTasks} ` +
      `queued=${stats.queuedVisible + stats.queuedPrefetch} ` +
      `queueWaitP50=${stats.queueWaitP50Ms}ms p90=${stats.queueWaitP90Ms}ms`
  );

  check('结束后无残留任务', stats.pendingTasks === 0 && stats.activeWorkers === 0);
  check('排队等待指标已采集', stats.queueWaitSamples > 0, `样本 ${stats.queueWaitSamples} 条`);
  check(
    '全部 48 张产出文件',
    throughputPaths.every((p) => realFileExists(service, p)),
    `${throughputPaths.filter((p) => realFileExists(service, p)).length}/48`
  );

  // ── 汇总 ────────────────────────────────────────────────────
  section('结果');
  console.log(`  通过 ${PASS.length}   失败 ${FAIL.length}`);
  FAIL.forEach((name) => console.log(`  ✗ ${name}`));
  console.log(FAIL.length === 0 ? '\n全部通过。' : '\n存在失败项。');

  fs.rmSync(VERIFY_USER_DATA, { recursive: true, force: true });
  return FAIL.length;
}

app.whenReady()
  .then(main)
  .then((failed) => app.exit(failed === 0 ? 0 : 1))
  .catch((error) => {
    console.error('\n验证脚本异常:', error);
    app.exit(2);
  });
