/* eslint-disable no-console */
/**
 * 第三轮基准 — 只用 sharp，不调用任何 macOS 原生缩略图 API（那条路已确认不可用）
 *
 * 运行: npx electron scripts/bench-thumbnails-3.js
 * 只读源图；只往系统临时目录写输出。
 */
const { app } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const OUT = path.join(os.tmpdir(), 'thumb-bench-out3');
const RES = 600;
const COVER = { width: RES, height: Math.round(RES * 1.5), fit: sharp.fit.cover, withoutEnlargement: true };
const WEBP = { quality: 80 };
const N_SEQ = 15;
const N_GRID = 48;

const section = (t) => console.log(`\n${'─'.repeat(74)}\n${t}\n${'─'.repeat(74)}`);

function stats(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { n: s.length, mean: s.reduce((x, y) => x + y, 0) / s.length, p50: q(0.5), p90: q(0.9), min: s[0], max: s[s.length - 1] };
}
const fmt = (s) => (s ? `mean=${s.mean.toFixed(0)} p50=${s.p50.toFixed(0)} p90=${s.p90.toFixed(0)} min=${s.min.toFixed(0)} max=${s.max.toFixed(0)}` : 'n/a');

const gen = (f, out) => sharp(f).resize(COVER).webp(WEBP).toFile(out);

async function mapPool(items, limit, fn) {
  const q = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, q.length) }, async () => {
      for (;;) {
        const it = q.shift();
        if (it === undefined) return;
        await fn(it);
      }
    })
  );
}

async function timePool(files, limit, fn) {
  let fail = 0;
  const t0 = performance.now();
  await mapPool(files, limit, async (f) => {
    try {
      await fn(f);
    } catch {
      fail++;
    }
  });
  return { wall: performance.now() - t0, fail };
}

async function main() {
  const all = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));
  await fsp.mkdir(OUT, { recursive: true });

  const seq = all.slice(0, N_SEQ);
  const grid = all.slice(0, N_GRID);

  section('0. 环境');
  console.log(`  ${os.cpus()[0].model.trim()}  ${os.cpus().length} 核  ${(os.totalmem() / 1e9).toFixed(0)}GB`);
  console.log(`  sharp ${sharp.versions.sharp} / libvips ${sharp.versions.vips}   默认 sharp.concurrency()=${sharp.concurrency()}`);
  console.log(`  目标规格 ${COVER.width}x${COVER.height} webp q${WEBP.quality}   样本 ${all.length} 张`);

  for (const f of seq.slice(0, 3)) await gen(f, path.join(OUT, 'w.webp'));

  section('1. 单张冷缓存延迟（顺序，无并发）');
  const t1 = [];
  for (const f of seq) {
    const t0 = performance.now();
    await gen(f, path.join(OUT, 's.webp'));
    t1.push(performance.now() - t0);
  }
  console.log(`  sharp 600x900 → webp80 → 落盘   ${fmt(stats(t1))}`);

  section('2. 并发扫描 — 外层并发 × libvips 内部线程');
  console.log(`  ${N_GRID} 张整批；「墙钟」为总耗时，「吞吐」为张/秒\n`);
  const best = { rate: 0 };
  for (const vips of [0, 2, 1]) {
    if (vips > 0) sharp.concurrency(vips);
    const label = vips === 0 ? `libvips=默认(10)` : `libvips=${vips}      `;
    for (const conc of [2, 3, 6, 10, 14]) {
      const r = await timePool(grid, conc, (f) => gen(f, path.join(OUT, 'c.webp')));
      const rate = grid.length / (r.wall / 1000);
      if (rate > best.rate) Object.assign(best, { rate, conc, vips: vips || 10, wall: r.wall });
      console.log(
        `  并发 ${String(conc).padStart(2)}  ×  ${label}   墙钟 ${String(r.wall.toFixed(0)).padStart(6)}ms   ${String((r.wall / grid.length).toFixed(0)).padStart(4)}ms/张   ${rate.toFixed(1).padStart(5)} 张/秒`
      );
    }
    console.log('');
  }
  sharp.concurrency(0);
  console.log(`  → 最优组合：并发 ${best.conc} × libvips ${best.vips} → ${best.rate.toFixed(1)} 张/秒`);

  section('3. 队列实现对比（24 张，并发 6）');
  const tasks = grid.slice(0, 24);
  {
    const t0 = performance.now();
    let active = 0;
    const MAX = 6;
    await Promise.all(
      tasks.map(async (f) => {
        while (active >= MAX) await new Promise((r) => setTimeout(r, 100));
        active++;
        try {
          await gen(f, path.join(OUT, 'q.webp'));
        } finally {
          active--;
        }
      })
    );
    const polling = performance.now() - t0;
    const direct = await timePool(tasks, 6, (f) => gen(f, path.join(OUT, 'q.webp')));
    console.log(`  当前实现（100ms 轮询信号量）  ${polling.toFixed(0)}ms`);
    console.log(`  直接派发（同等并发）          ${direct.wall.toFixed(0)}ms`);
    console.log(`  轮询额外开销                  +${(polling - direct.wall).toFixed(0)}ms  (${(((polling - direct.wall) / polling) * 100).toFixed(0)}%)`);
  }

  section('4. ImageCacheManager LRU 的 O(n) 代价');
  console.log('  updateLRU() 每次 get/set 都执行 lruQueue.filter(...)，队列无上限\n');
  for (const n of [1000, 5000, 20000, 50000]) {
    const lruQueue = Array.from({ length: n }, (_, i) => `img_${i}`);
    const key = `img_${n}`;
    const t0 = performance.now();
    const ITER = 200;
    for (let i = 0; i < ITER; i++) {
      // 复刻 updateLRU
      const next = lruQueue.filter((k) => k !== key);
      next.unshift(key);
    }
    console.log(`  队列长度 ${String(n).padStart(6)}  每次 updateLRU ${((performance.now() - t0) / ITER).toFixed(3)}ms  → 100 次查找 ${(((performance.now() - t0) / ITER) * 100).toFixed(0)}ms`);
  }
  console.log('\n  对照：改用 Set/双向链表后为 O(1)');

  section('5. 缓存命中路径（当前已缓存 2199 张）');
  {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      fs.existsSync(path.join(OUT, 's.webp'));
    }
    console.log(`  fs.existsSync ×2000（主进程）   ${(performance.now() - t0).toFixed(0)}ms`);
  }

  await fsp.rm(OUT, { recursive: true, force: true });
  console.log('\n完成。');
}

app.whenReady().then(main).then(
  () => app.exit(0),
  (e) => {
    console.error('基准失败:', e);
    app.exit(1);
  }
);
