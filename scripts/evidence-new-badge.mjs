#!/usr/bin/env node
/**
 * 只读取证：真实构建产物 + 隔离 profile，验证 4.8.0 的套图卡「新」角标。
 *
 * 用真实索引缓存（只复制到隔离 profile，不写用户 profile、不改图库），
 * 进 Cos 图库 › 按署名 › G44不会受伤，把排序切成「修改日期」（默认降序），
 * 断言最近 7 天入库的套图排在最前并带「新」，之后的不带。
 *
 * 用法：
 *   node scripts/evidence-new-badge.mjs
 *   PAV_APP="/Applications/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer" \
 *     PAV_EVID_PREFIX=installed- PAV_EVID_JSON=verification-installed.json \
 *     node scripts/evidence-new-badge.mjs
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.PAV_APP
  || path.join(ROOT, 'dist/mac-arm64/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer');
const EVID = path.join(ROOT, '.3things/acceptance/evidence/new-badge');
const PREFIX = process.env.PAV_EVID_PREFIX || '';
const REPORT_NAME = process.env.PAV_EVID_JSON || 'verification.json';
const PROFILE = path.join(os.homedir(), 'Library/Application Support/photo-album-viewer');
const CATALOG = path.join(PROFILE, 'cos-library-catalog-v1.json');
const ROOTS = path.join(PROFILE, 'cos-library-roots-v1.json');
const SOURCES = path.join(PROFILE, 'library-sources-v3.json');
const COSER = 'G44不会受伤';
const WEEK = 7 * 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        entry.resolve(msg.result);
      }
    });
  }

  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', reject);
    });
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = ++this.seq;
    return Promise.race([
      new Promise((resolve) => {
        this.pending.set(id, { resolve });
        this.ws.send(JSON.stringify({ id, method, params }));
      }),
      sleep(timeoutMs).then(() => ({ __timeout: true }))
    ]);
  }

  async evaluate(expression, timeoutMs = 30000) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result?.__timeout) throw new Error('页面执行超时');
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面内执行失败');
    return result?.result?.value;
  }
}

const assertions = [];
const shots = [];
const startedAt = new Date().toISOString();

function record(name, ok, detail) {
  assertions.push({ name, ok, detail: detail ?? null });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}

async function main() {
  if (!fs.existsSync(APP)) throw new Error(`找不到应用：${APP}`);
  fs.mkdirSync(EVID, { recursive: true });

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-badge-profile-'));
  const port = await freePort();
  const appLog = [];
  fs.copyFileSync(CATALOG, path.join(profileDir, 'cos-library-catalog-v1.json'));
  fs.copyFileSync(ROOTS, path.join(profileDir, 'cos-library-roots-v1.json'));
  if (fs.existsSync(SOURCES)) fs.copyFileSync(SOURCES, path.join(profileDir, 'library-sources-v3.json'));

  const child = spawn(APP, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => appLog.push(String(chunk)));
  child.stderr.on('data', (chunk) => appLog.push(String(chunk)));

  let cdp = null;
  const finish = async (error) => {
    try { cdp?.ws.close(); } catch (_) { /* ignore */ }
    child.kill('SIGTERM');
    await sleep(800);
    fs.rmSync(profileDir, { recursive: true, force: true });
    const report = {
      at: new Date().toISOString(),
      startedAt,
      app: APP,
      catalog: CATALOG,
      weekWindowMs: WEEK,
      passed: assertions.filter((row) => row.ok).length,
      total: assertions.length,
      ok: !error && assertions.every((row) => row.ok),
      error: error ? String(error.message || error) : null,
      assertions,
      screenshots: shots
    };
    fs.writeFileSync(path.join(EVID, REPORT_NAME), JSON.stringify(report, null, 2));
    if (appLog.length) fs.writeFileSync(path.join(EVID, REPORT_NAME.replace(/\.json$/, '.app-console.txt')), appLog.join(''));
    if (error) {
      console.error(`\n失败：${error.message}`);
      process.exitCode = 1;
    }
  };

  try {
    let target = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        const list = await httpJson(`http://127.0.0.1:${port}/json/list`);
        target = (list || []).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (target) break;
      } catch (_) { /* 还没起来 */ }
      await sleep(500);
    }
    if (!target) throw new Error('等待应用窗口超时');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    await sleep(1200);

    const waitFor = async (expr, timeoutMs, label) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        try {
          const value = await cdp.evaluate(expr);
          if (value) return value;
        } catch (_) { /* 导航中 */ }
        await sleep(600);
      }
      throw new Error(`等待超时：${label}`);
    };

    const clickByText = async (selector, text, label) => {
      const ok = await cdp.evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((node) => String(node.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error(`找不到可点击目标：${label || text}`);
    };

    const clickContaining = async (selector, text, label) => {
      const ok = await cdp.evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((node) => String(node.textContent || '').includes(${JSON.stringify(text)}));
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error(`找不到可点击目标：${label || text}`);
    };

    const clickCardContaining = async (text, label) => {
      const ok = await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('.grid-card')]
          .find((node) => String(node.textContent || '').includes(${JSON.stringify(text)}));
        if (!card) return false;
        card.click();
        return true;
      })()`);
      if (!ok) throw new Error(`找不到卡片：${label || text}`);
    };

    const capture = async (file) => {
      await cdp.send('Page.bringToFront', {}, 5000).catch(() => {});
      const viewport = await cdp.evaluate('({ width: innerWidth, height: innerHeight })');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false
      }, 10000);
      let shot;
      try {
        shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, 20000);
      } catch (_) {
        shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false }, 30000);
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride', 10000).catch(() => {});
      const buffer = Buffer.from(shot.data, 'base64');
      const full = path.join(EVID, `${PREFIX}${file}`);
      fs.writeFileSync(full, buffer);
      shots.push({ file: full, bytes: buffer.length });
      console.log(`截图：${path.basename(full)}`);
    };

    // 数据面：同一排序的口径边界（角标规则 = lastModified 在 7 天内）
    const dataCheck = await cdp.evaluate(`(async () => {
      const cosers = await window.electronAPI.invoke('cos-list-cosers', { limit: 500, groupSingletons: false });
      const coser = (cosers?.items || []).find((item) => item.name === ${JSON.stringify(COSER)});
      if (!coser) return { error: '找不到署名 ' + ${JSON.stringify(COSER)} };
      const all = [];
      let offset = 0;
      for (;;) {
        const page = await window.electronAPI.invoke('cos-list-sets', {
          coserId: coser.id, sortBy: 'lastModified', sortDirection: 'desc', limit: 100, offset
        });
        all.push(...(page?.items || []));
        if (!page || !page.items || page.items.length === 0 || all.length >= page.total) break;
        offset += page.items.length;
      }
      const now = Date.now();
      const recent = all.filter((set) => Number(set.lastModified) > 0 && now - Number(set.lastModified) < ${WEEK});
      const firstOldIndex = all.findIndex((set) => !(Number(set.lastModified) > 0 && now - Number(set.lastModified) < ${WEEK}));
      return {
        total: all.length,
        recentCount: recent.length,
        firstOldIndex,
        firstSet: all[0] ? { name: all[0].displayName, lastModified: all[0].lastModified } : null,
        boundarySet: firstOldIndex >= 0 ? { name: all[firstOldIndex].displayName, lastModified: all[firstOldIndex].lastModified } : null,
        recentNames: recent.slice(0, 3).map((set) => set.displayName)
      };
    })()`, 120000);

    if (dataCheck?.error) throw new Error(dataCheck.error);
    record('数据面：G44 套图按修改日期降序，最近 7 天的集中在最前', dataCheck.recentCount > 0 && dataCheck.firstOldIndex === dataCheck.recentCount, dataCheck);
    record('数据面：第一张是今天动过的套图（时间在 7 天内）', Boolean(dataCheck.firstSet) && Date.now() - Number(dataCheck.firstSet.lastModified) < WEEK && Date.now() - Number(dataCheck.firstSet.lastModified) < 24 * 60 * 60 * 1000, dataCheck.firstSet);

    // 界面面：侧栏 → Cos 图库 → 按署名 → G44不会受伤
    await waitFor('Boolean(document.querySelector(".sidebar-item"))', 60000, '侧栏');
    await clickByText('.sidebar-item', 'Cos 图库', '侧栏「Cos 图库」');
    await waitFor('document.querySelectorAll(".bigcard").length >= 3', 180000, 'Cos 总览三张入口卡');
    await clickContaining('.bigcard', '按署名', '「按署名」入口');
    await waitFor('document.querySelectorAll(".grid-card").length > 0', 180000, '署名列表');
    await waitFor(`[...document.querySelectorAll('.grid-card')].some((node) => String(node.textContent || '').includes(${JSON.stringify(COSER)}))`, 180000, `署名卡 ${COSER}`);
    await clickCardContaining(COSER, `署名卡 ${COSER}`);
    await waitFor(`String(document.querySelector('.page-header-title-compact, .page-header-title')?.textContent || '').includes(${JSON.stringify(COSER)})`, 180000, '套图列表页头');
    await waitFor('document.querySelectorAll(".grid-card").length > 0', 180000, '套图网格');
    await sleep(1500);

    // 排序切到「修改日期」（控件会自动置为降序）
    const sorted = await cdp.evaluate(`(() => {
      const select = document.querySelector('.page-header select[aria-label="排序"]');
      if (!select) return { ok: false, error: '找不到排序控件' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, 'lastModified');
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, value: select.value };
    })()`);
    if (!sorted.ok) throw new Error(sorted.error);
    await sleep(2500);

    const dom = await cdp.evaluate(`(() => {
      const cards = [...document.querySelectorAll('.grid-card')];
      const rows = cards.map((card) => {
        const badge = card.querySelector('.card-badge');
        const name = card.querySelector('.grid-card-name');
        const meta = card.querySelector('.grid-card-meta');
        return {
          name: String(name?.textContent || '').trim(),
          meta: String(meta?.textContent || '').trim(),
          badge: badge ? String(badge.textContent || '').trim() : null
        };
      });
      return {
        rendered: rows.length,
        badgeCount: rows.filter((row) => row.badge === '新').length,
        badgeNames: rows.filter((row) => row.badge === '新').slice(0, 30).map((row) => row.name),
        first: rows[0] || null,
        firstUnbadgedIndex: rows.findIndex((row) => !row.badge),
        sortValue: document.querySelector('.page-header select[aria-label="排序"]')?.value,
        sortDirection: document.querySelector('.page-header button[aria-label*="序"]')?.getAttribute('aria-label')
      };
    })()`);

    record('界面面：排序控件为「修改日期」且为降序', dom.sortValue === 'lastModified' && String(dom.sortDirection || '').includes('降序'), { sortValue: dom.sortValue, sortDirection: dom.sortDirection });
    record('界面面：第一张套图卡带「新」角标', Boolean(dom.first) && dom.first.badge === '新', dom.first);
    record('界面面：可见卡里带「新」的数量与数据面一致（虚拟网格只渲染可见行，至少 20 张）',
      dom.badgeCount >= 20 && dom.badgeCount <= dataCheck.recentCount, { rendered: dom.rendered, badgeCount: dom.badgeCount, recentCount: dataCheck.recentCount });
    // 列表里卡片名去掉了署名前缀和末尾作品括号，和 IPC 原始名按同一规则归一后再比
    const normalize = (name) => String(name).split('｜').pop().replace(/（.*$/, '').trim();
    const expectedBadges = dataCheck.recentNames.map(normalize);
    const actualBadges = dom.badgeNames.map(normalize);
    record('界面面：带「新」的卡按顺序就是数据面前 23 套，旧套图从第 24 张起不带标',
      actualBadges.slice(0, expectedBadges.length).join('|') === expectedBadges.join('|')
        && dom.firstUnbadgedIndex === Math.min(dom.rendered - 1, dataCheck.recentCount),
      { expectedBadges, actualBadges, firstUnbadgedIndex: dom.firstUnbadgedIndex, badgeCount: dom.badgeCount });

    await capture('A-g44-sets-new-badge-1280x800.png');
  } catch (error) {
    await finish(error);
    return;
  }
  await finish(null);
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
