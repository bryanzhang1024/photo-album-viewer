/* eslint-disable no-console */
/**
 * 验证：启动索引成本
 *
 * 运行: node scripts/verify-startup-index.js
 *
 * 只读用户数据目录里的 Cos 索引，不写入、不删除。
 *
 * 量化三件事：
 *   1. 105MB 索引 readFile + JSON.parse 的耗时、主线程阻塞时长与堆增量
 *   2. 判断 .pre-3.4.json 副本是否存在：access（现在）vs readFile+parse（以前）
 *   3. 主线程阻塞用「事件循环漂移」测量：定时器本应每 10ms 触发一次，
 *      实际偏差的最大值近似于最长的一次同步阻塞
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const USER_DATA = path.join(os.homedir(), 'Library', 'Application Support', 'photo-album-viewer');
const CACHE = path.join(USER_DATA, 'cos-library-catalog-v1.json');
const PRE34 = `${CACHE}.pre-3.4.json`;

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
const mb = (bytes) => `${(bytes / 1048576).toFixed(1)}MB`;

/**
 * 在事件循环上加一个 10ms 节拍，记录最大漂移。
 * 漂移越大说明主线程被同步占住得越久。
 */
async function measure(label, fn) {
  let maxDrift = 0;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    const drift = now - last - 10;
    if (drift > maxDrift) maxDrift = drift;
    last = now;
  }, 10);

  // 让节拍先稳定下来，再清零基线
  await new Promise((resolve) => setTimeout(resolve, 60));
  last = Date.now();
  maxDrift = 0;

  const heapBefore = process.memoryUsage().heapUsed;
  const startedAt = Date.now();
  const result = await fn();
  const elapsed = Date.now() - startedAt;
  const heapAfter = process.memoryUsage().heapUsed;

  // 关键：必须等一个节拍过去再 clearInterval。
  // 阻塞结束后先跑的是微任务（这里的续体），逾期的 interval 回调是宏任务，
  // 若在这里立刻 clearInterval，那次本该记录漂移的回调就永远不会执行，
  // 于是同步阻塞会被误报成 0ms。
  await new Promise((resolve) => setTimeout(resolve, 60));
  clearInterval(timer);

  return {
    label,
    elapsed,
    maxDrift,
    heapDelta: heapAfter - heapBefore,
    result
  };
}

function report(row) {
  console.log(
    `  ${row.label.padEnd(40)} 耗时 ${String(row.elapsed).padStart(5)}ms  ` +
      `主线程最长阻塞 ${String(row.maxDrift).padStart(5)}ms  堆 ${row.heapDelta >= 0 ? '+' : ''}${mb(row.heapDelta)}`
  );
}

async function main() {
  console.log(`用户数据目录: ${USER_DATA}`);

  if (!fs.existsSync(CACHE)) {
    console.log('未找到 Cos 索引，跳过。');
    return 0;
  }

  section('0. 文件规模');
  const cacheSize = fs.statSync(CACHE).size;
  console.log(`  cos-library-catalog-v1.json   ${mb(cacheSize)}`);
  if (fs.existsSync(PRE34)) {
    console.log(`  .pre-3.4.json（迁移副本）      ${mb(fs.statSync(PRE34).size)}`);
  } else {
    console.log('  .pre-3.4.json                 不存在（本机当前版本走 rootCatalogs 分支，不触发该检查）');
  }

  section('1. 主索引解析成本（实际启动时会做一次，现已在首屏后延后 5s）');
  const parseRow = await measure('readFile + JSON.parse 主索引', async () => {
    const raw = await fs.promises.readFile(CACHE, 'utf8');
    return JSON.parse(raw);
  });
  report(parseRow);
  const setCount = parseRow.result?.catalog?.sets?.length ?? '?';
  console.log(`  解析出 ${setCount} 个套图条目`);

  section('2. 判断 .pre-3.4.json 是否存在：新旧做法对比');
  if (fs.existsSync(PRE34)) {
    const accessRow = await measure('fs.access（现在的做法）', () => fs.promises.access(PRE34, fs.constants.F_OK));
    report(accessRow);

    const legacyRow = await measure('readFile + JSON.parse（以前的做法）', async () => {
      const raw = await fs.promises.readFile(PRE34, 'utf8');
      return JSON.parse(raw);
    });
    report(legacyRow);

    const saved = legacyRow.elapsed - accessRow.elapsed;
    console.log(`  → 每次启动省下约 ${saved}ms 与 ${mb(Math.max(0, legacyRow.heapDelta))} 堆占用`);
    check('存在性检查明显快于解析副本', saved > 50, `省约 ${saved}ms`);
    check(
      '存在性检查不造成主线程阻塞',
      accessRow.maxDrift < Math.max(20, legacyRow.maxDrift / 2),
      `access ${accessRow.maxDrift}ms vs 解析 ${legacyRow.maxDrift}ms`
    );
  } else {
    console.log('  副本不存在，无法对比（本机走 rootCatalogs 分支，该路径不执行）');
  }

  section('3. 结论性判断');
  check(
    '主索引解析确实存在可观测的主线程阻塞',
    parseRow.maxDrift > 50,
    `最长阻塞 ${parseRow.maxDrift}ms（这正是不该放在 did-finish-load 上的原因）`
  );
  console.log(
    `\n  主索引每启动一次：约 ${parseRow.elapsed}ms 耗时、${mb(Math.max(0, parseRow.heapDelta))} 堆增量、` +
      `其中主线程同步阻塞约 ${parseRow.maxDrift}ms。`
  );
  console.log('  把这一次解析从 did-finish-load 挪到首屏后 5s，首屏窗口内不再有这段阻塞；');
  console.log('  但解析本身的成本没变——要真正降下来需要把索引分片（见诊断报告第 16 节）。');

  section('结果');
  console.log(`  通过 ${PASS.length}   失败 ${FAIL.length}`);
  FAIL.forEach((name) => console.log(`  ✗ ${name}`));

  return FAIL.length;
}

main()
  .then((failed) => process.exit(failed === 0 ? 0 : 1))
  .catch((error) => {
    console.error('验证脚本异常:', error);
    process.exit(2);
  });
