#!/usr/bin/env node
/**
 * 只读取证：真实构建产物 + 隔离 profile，拍 COS 图库 / 照片来源两个入口的网格截图并测量 DOM。
 * 不写仓库代码、不构建、不安装；唯一写入仓库的路径是 .3things/acceptance/evidence/cos-vs-folder/。
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
const EVID = path.join(ROOT, '.3things/acceptance/evidence/cos-vs-folder');
const REAL_CATALOG = path.join(os.homedir(), 'Library/Application Support/photo-album-viewer/cos-library-catalog-v1.json');
const LIBRARY_SOURCES = {
  schemaVersion: 1,
  sources: [{
    schemaVersion: 1,
    sourceId: 'src_00000000-0000-4000-8000-000000000001',
    label: '300-Cos套图库',
    rootPath: '/Volumes/1TB/Collection/300-Cos套图库',
    sourceGeneration: 1
  }]
};
const COS_ROOTS = {
  version: 1,
  roots: [{
    id: 'root:b772fe5793b0ccff6904c762124dc9a114de2548',
    path: '/Volumes/1TB/Collection/300-Cos套图库',
    label: '300-Cos套图库',
    kind: 'sets'
  }]
};

const startedAt = new Date().toISOString();
const logLines = [];
function log(message) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${message}`;
  logLines.push(line);
  console.log(line);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return { width: null, height: null };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function findFreePort() {
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

function httpJson(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_error) { return; }
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(msg.error.message || 'CDP error'));
        else entry.resolve(msg.result);
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
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 20000) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true
    }, timeoutMs);
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '页面内执行失败');
    }
    return result?.result?.value;
  }
}

function measureExpression(kind) {
  return `(() => {
    const R = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const n = (v) => Math.round(v * 10) / 10;
      return { x: n(r.x), y: n(r.y), top: n(r.top), left: n(r.left), right: n(r.right), bottom: n(r.bottom), width: n(r.width), height: n(r.height) };
    };
    const T = (el) => (el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : null);
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    };
    const isGrid = true; // 两个入口共用同一套网格，测量口径一致
    const cardSel = isGrid ? '.grid-card' : '.cos-card';
    const cards = [...document.querySelectorAll(cardSel)];
    const vis = cards.filter(visible);
    const first = cards[0] || null;
    const cover = first ? first.querySelector(isGrid ? '.grid-card-cover' : '.cos-cover') : null;
    const nameEl = first ? first.querySelector(isGrid ? '.grid-card-name' : '.cos-name') : null;
    const metaEl = first ? first.querySelector(isGrid ? '.grid-card-meta' : '.cos-meta') : null;
    const textStyle = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        text: T(el),
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        marginTop: s.marginTop,
        minHeight: s.minHeight,
        color: s.color,
        fontWeight: s.fontWeight
      };
    };

    let grid = null;
    if (isGrid) {
      const row = document.querySelector('.vg-row');
      const inner = document.querySelector('.folder-scroll-inner');
      const scroll = document.querySelector('.folder-scroll');
      const rowCs = row ? getComputedStyle(row) : null;
      const innerCs = inner ? getComputedStyle(inner) : null;
      grid = {
        containerSelector: '.vg-row',
        rowCount: document.querySelectorAll('.vg-row').length,
        className: row ? row.className : null,
        inlineGridTemplateColumns: row ? row.style.gridTemplateColumns : null,
        computedGridTemplateColumns: rowCs ? rowCs.gridTemplateColumns : null,
        columnCount: rowCs ? rowCs.gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        columnGap: rowCs ? rowCs.columnGap : null,
        rowGap: rowCs ? rowCs.rowGap : null,
        padding: innerCs ? { left: innerCs.paddingLeft, right: innerCs.paddingRight } : null,
        clientWidth: inner ? inner.clientWidth : null,
        rect: R(row),
        scrollContainer: scroll ? {
          className: scroll.className,
          ariaLabel: scroll.getAttribute('aria-label'),
          clientWidth: scroll.clientWidth,
          clientHeight: scroll.clientHeight,
          scrollHeight: scroll.scrollHeight
        } : null
      };
    } else {
      const g = document.querySelector('.cos-grid');
      const gs = g ? getComputedStyle(g) : null;
      const scroll = document.querySelector('.cos-scroll');
      grid = {
        containerSelector: '.cos-grid',
        className: g ? g.className : null,
        computedGridTemplateColumns: gs ? gs.gridTemplateColumns : null,
        columnCount: gs ? gs.gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        columnGap: gs ? gs.columnGap : null,
        rowGap: gs ? gs.rowGap : null,
        padding: gs ? { left: gs.paddingLeft, right: gs.paddingRight, top: gs.paddingTop, bottom: gs.paddingBottom } : null,
        clientWidth: g ? g.clientWidth : null,
        rect: R(g),
        scrollContainer: scroll ? {
          className: scroll.className,
          clientWidth: scroll.clientWidth,
          clientHeight: scroll.clientHeight,
          scrollHeight: scroll.scrollHeight
        } : null
      };
    }

    const header = document.querySelector('.page-header');
    const hc = header ? getComputedStyle(header) : null;
    const headerControls = header ? [...header.querySelectorAll('select, input, button')] : [];
    const controlSummary = { select: 0, search: 0, range: 0, iconButton: 0, button: 0, input: 0 };
    for (const el of headerControls) {
      if (el.tagName === 'SELECT') controlSummary.select += 1;
      else if (el.tagName === 'INPUT') {
        controlSummary.input += 1;
        if (el.type === 'search') controlSummary.search += 1;
        if (el.type === 'range') controlSummary.range += 1;
      } else if (el.tagName === 'BUTTON') {
        controlSummary.button += 1;
        if (el.classList.contains('icon-button')) controlSummary.iconButton += 1;
      }
    }
    const crumbEls = header ? [...header.querySelectorAll('.page-header-crumb, .page-header-crumb-current, .page-header-crumb-ellipsis')] : [];
    const pageHeader = {
      rect: R(header),
      height: header ? Math.round(header.getBoundingClientRect().height * 10) / 10 : null,
      className: header ? header.className : null,
      padding: hc ? { top: hc.paddingTop, bottom: hc.paddingBottom, left: hc.paddingLeft, right: hc.paddingRight } : null,
      crumbCount: crumbEls.length,
      crumbs: crumbEls.map(T),
      title: T(header ? header.querySelector('.page-header-title-compact, .page-header-title, h1') : null),
      count: T(header ? header.querySelector('.page-header-count') : null),
      controlSummary,
      controlDetail: headerControls.map((el) => ({
        tag: el.tagName,
        type: el.type || null,
        className: String(el.className || ''),
        ariaLabel: el.getAttribute('aria-label'),
        text: el.tagName === 'SELECT' ? T(el) : null
      }))
    };

    const firstRect = first ? first.getBoundingClientRect() : null;
    const coverRect = cover ? cover.getBoundingClientRect() : null;

    return {
      kind: ${JSON.stringify(kind)},
      toolbarSearch: Boolean(document.querySelector('.toolbar-search input')),
      headerSearchInput: Boolean(document.querySelector('.page-header input[type="search"]')),
      sidebarActiveItem: T(document.querySelector('.sidebar-item[aria-current="page"]')),
      viewport: { innerWidth, innerHeight, devicePixelRatio },
      sidebar: document.querySelector('.sidebar') ? {
        width: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width * 10) / 10,
        collapsed: document.querySelector('.sidebar').dataset.collapsed || null
      } : null,
      pageHeader,
      grid,
      cards: {
        selector: cardSel,
        totalCount: cards.length,
        visibleCount: vis.length,
        firstCardTag: first ? first.tagName : null,
        firstCardClass: first ? String(first.className) : null,
        firstCardRect: R(first),
        firstCardWidth: firstRect ? Math.round(firstRect.width * 10) / 10 : null,
        firstCardHeight: firstRect ? Math.round(firstRect.height * 10) / 10 : null,
        coverRect: R(cover),
        coverWidth: coverRect ? Math.round(coverRect.width * 10) / 10 : null,
        coverHeight: coverRect ? Math.round(coverRect.height * 10) / 10 : null,
        coverAspectRatioCss: cover ? getComputedStyle(cover).aspectRatio : null,
        coverAspectRatioMeasured: coverRect ? Math.round((coverRect.width / coverRect.height) * 1000) / 1000 : null,
        coverBorderRadius: cover ? getComputedStyle(cover).borderRadius : null,
        heartCount: document.querySelectorAll('.card-heart').length,
        selectedCount: document.querySelectorAll('.grid-card.selected').length,
        cosMoreExists: Boolean(document.querySelector('.cos-more')),
        firstCardText: first ? T(first) : null,
        firstCardSecondLine: metaEl ? T(metaEl) : null
      },
      text: { name: textStyle(nameEl), meta: textStyle(metaEl) },
      cardTextSamples: cards.slice(0, 3).map((card) => T(card))
    };
  })()`;
}

async function main() {
  fs.mkdirSync(EVID, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-cosgrid-'));
  const appLogPath = path.join(os.tmpdir(), `pav-cosgrid-app-${Date.now()}.log`);
  const appLog = fs.createWriteStream(appLogPath);
  const port = await findFreePort();
  const measurements = {
    meta: {
      startedAt,
      appBinary: APP,
      profileDir,
      port,
      appLogPath,
      catalogSource: REAL_CATALOG,
      catalogCopied: false,
      pageSizes: '窗口默认 1280x800，未改尺寸',
      note: '隔离 profile，只读访问真实图库；未点击刷新索引/添加根目录/移除来源，未收藏'
    },
    pages: {},
    smoke: {}
  };

  log(`临时 profile：${profileDir}`);
  log(`CDP 端口：${port}`);
  fs.writeFileSync(path.join(profileDir, 'library-sources-v3.json'), JSON.stringify(LIBRARY_SOURCES, null, 2));
  fs.writeFileSync(path.join(profileDir, 'cos-library-roots-v1.json'), JSON.stringify(COS_ROOTS, null, 2));
  const t0 = Date.now();
  fs.copyFileSync(REAL_CATALOG, path.join(profileDir, 'cos-library-catalog-v1.json'));
  measurements.meta.catalogCopied = true;
  measurements.meta.catalogBytes = fs.statSync(REAL_CATALOG).size;
  measurements.meta.catalogCopyMs = Date.now() - t0;
  log(`已复制 COS 索引缓存 ${(measurements.meta.catalogBytes / 1024 / 1024).toFixed(1)}MB，用时 ${measurements.meta.catalogCopyMs}ms`);

  const child = spawn(APP, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    // 窗口可能被别的窗口挡住；不让 Chromium 把遮挡窗口降频，否则截图会等不到新帧
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const pid = child.pid;
  measurements.meta.pid = pid;
  fs.writeFileSync(path.join(os.tmpdir(), 'pav-cosgrid-child.pid'), String(pid));
  child.stdout.pipe(appLog, { end: false });
  child.stderr.pipe(appLog, { end: false });
  log(`已启动测试实例 PID=${pid}`);

  let cdp = null;
  const steps = [];
  const shots = [];
  const recordStep = (page, ok, data, error) => {
    measurements.pages[page] = ok ? data : { failed: true, error };
    steps.push({ page, ok, error: error || null });
    if (ok) log(`✓ ${page} 测量完成`); else log(`✗ ${page} 失败：${error}`);
  };

  try {
    // 等 CDP 就绪
    let target = null;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      try {
        const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
        target = (targets || []).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (target) break;
      } catch (_error) { /* 还没起来 */ }
      await sleep(500);
    }
    if (!target) throw new Error('等待应用窗口超时');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    log('CDP 已连接');

    // 等外壳渲染
    const waitFor = async (expr, timeoutMs, label) => {
      const start = Date.now();
      let lastLog = 0;
      while (Date.now() - start < timeoutMs) {
        try {
          const value = await cdp.evaluate(expr);
          if (value) return value;
        } catch (_error) { /* 导航中 */ }
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now();
          log(`等待${label}… ${Math.round((Date.now() - start) / 1000)}s`);
        }
        await sleep(700);
      }
      throw new Error(`等待超时：${label}`);
    };

    await waitFor('Boolean(document.querySelector(".sidebar-item"))', 60000, '侧栏');
    const sidebarLabels = await cdp.evaluate('[...document.querySelectorAll(".sidebar-item")].map((el) => String(el.textContent || "").replace(/\\s+/g," ").trim())');
    measurements.smoke.initialSidebarItems = sidebarLabels;
    log(`初始侧栏：${JSON.stringify(sidebarLabels)}`);

    const clickByText = async (selector, text, label) => {
      const ok = await cdp.evaluate(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((node) => String(node.textContent || '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
        if (!el) return false;
        el.click();
        return true;
      })()`);
      if (!ok) throw new Error(`找不到可点击目标：${label || text}`);
      log(`已点击：${label || text}`);
    };

    const takeScreenshot = async (fileName) => {
      await cdp.send('Page.bringToFront', {}, 5000).catch(() => {});
      const viewport = await cdp.evaluate('({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })');
      // 窗口是 Retina（dpr=2），先固定成 CSS 像素再截，输出与设计稿同尺寸的 1280×800；
      // 直接截 Retina 表面在窗口被遮挡时会等不到新帧，统一走 emulation 更稳。
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false
      }, 10000);
      const capture = (params, timeoutMs) => cdp.send('Page.captureScreenshot', params, timeoutMs);
      let shot;
      try {
        shot = await capture({ format: 'png', captureBeyondViewport: false }, 20000);
      } catch (error) {
        // 窗口被遮挡或屏幕休眠时，表面帧可能一直等不到；退回到渲染帧抓取
        log(`截图首试超时（${error.message}），改用渲染帧重试`);
        shot = await capture({ format: 'png', fromSurface: false, captureBeyondViewport: false }, 30000);
      }
      await cdp.send('Emulation.clearDeviceMetricsOverride', 10000).catch(() => {});
      let buffer = Buffer.from(shot.data, 'base64');
      let size = pngSize(buffer);
      const emulated = true;
      const fullPath = path.join(EVID, fileName);
      fs.writeFileSync(fullPath, buffer);
      shots.push({ file: fullPath, width: size.width, height: size.height, bytes: buffer.length, viewport, cdpDprEmulationUsed: emulated });
      log(`截图：${fileName}（${size.width}x${size.height}, ${(buffer.length / 1024).toFixed(0)}KB）`);
      return { path: fullPath, width: size.width, height: size.height, emulated };
    };

    const measure = async (kind) => cdp.evaluate(measureExpression(kind), 30000);

    // ---------- A：全部作品 ----------
    let aData = null;
    try {
      await clickByText('.sidebar-item', '全部作品', '侧栏「全部作品」');
      await waitFor(`document.querySelectorAll(".grid-card").length > 0 && String(document.querySelector(".page-header-title-compact, .page-header-title")?.textContent || "").includes("全部作品")`, 300000, 'COS 套图网格');
      await sleep(3500);
      const data = await measure('cos');
      data.screenshot = await takeScreenshot('A-cos-all-1280x800.png');
      aData = data;
      recordStep('A', true, data);

      // 缩略图滑杆必须真正改变列数（4.5.1 回归）
      try {
        const before = data.grid?.columnCount || 0;
        const applied = await cdp.evaluate(`(() => {
          const input = document.querySelector('.page-header input[type="range"]');
          if (!input) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '2');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        await sleep(900);
        const after = await cdp.evaluate(`(() => {
          const row = document.querySelector('.vg-row');
          return row ? getComputedStyle(row).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
        })()`);
        await cdp.evaluate(`(() => {
          const input = document.querySelector('.page-header input[type="range"]');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, '0');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()`);
        await sleep(600);
        measurements.densityCheck = { applied, before, after, ok: applied && after > 0 && after < before };
        log(`密度滑杆：${before} 列 → ${after} 列（${measurements.densityCheck.ok ? '生效' : '未生效'}）`);
      } catch (densityError) {
        measurements.densityCheck = { ok: false, error: densityError.message };
        log(`密度滑杆检查失败：${densityError.message}`);
      }
    } catch (error) {
      recordStep('A', false, null, error.message);
      try {
        const stateText = await cdp.evaluate('String(document.querySelector(".folder-state")?.textContent || "")');
        measurements.pages.A = { failed: true, error: error.message, folderStateText: stateText };
      } catch (_error) { /* ignore */ }
    }

    // ---------- B：照片来源 ----------
    let bData = null;
    try {
      await clickByText('.sidebar-item-row .sidebar-item', '300-Cos套图库', '照片来源「300-Cos套图库」');
      await waitFor(`document.querySelectorAll(".grid-card").length > 0 && String(document.querySelector(".page-header-title-compact, .page-header-title")?.textContent || "").includes("300-Cos套图库")`, 180000, '文件夹网格卡片');
      await sleep(3500);
      const data = await measure('grid');
      data.screenshot = await takeScreenshot('B-folder-1280x800.png');
      bData = data;
      recordStep('B', true, data);
    } catch (error) {
      recordStep('B', false, null, error.message);
      try {
        const stateText = await cdp.evaluate('String(document.querySelector(".folder-state")?.textContent || "")');
        measurements.pages.B = { failed: true, error: error.message, folderStateText: stateText };
      } catch (_error) { /* ignore */ }
    }

    // ---------- C：COS 套图照片页 ----------
    const cHints = { title: null, setCardName: null };
    try {
      if (!aData) throw new Error('A 未成功，无法进入套图页');
      await clickByText('.sidebar-item', '全部作品', '侧栏「全部作品」（回 A）');
      await waitFor('document.querySelectorAll(".grid-card").length > 0', 60000, 'COS 卡片（返回）');
      await sleep(1500);
      const firstCard = await cdp.evaluate(`(() => {
        const card = document.querySelector('.grid-card');
        if (!card) return null;
        const nameEl = card.querySelector('.grid-card-name');
        return { name: nameEl ? String(nameEl.textContent || '').trim() : null, text: String(card.textContent || '').replace(/\\s+/g, ' ').trim() };
      })()`);
      cHints.setCardName = firstCard?.name || null;
      log(`A 第一张卡片：${firstCard?.name || '(空)'}`);
      const clicked = await cdp.evaluate(`(() => { const card = document.querySelector('.grid-card'); if (!card) return false; card.click(); return true; })()`);
      if (!clicked) throw new Error('点击第一张套图卡失败');
      await waitFor(`document.querySelectorAll(".grid-card").length > 0 && String(document.querySelector(".page-header-count")?.textContent || "").includes("张照片")`, 60000, '套图照片网格');
      await sleep(3000);
      const data = await measure('cosPhotos');
      data.screenshot = await takeScreenshot('C-cos-set-photos.png');
      data.setTitle = data.pageHeader?.title || null;
      cHints.title = data.setTitle;
      recordStep('C', true, data);
    } catch (error) {
      recordStep('C', false, null, error.message);
      measurements.pages.C = { failed: true, error: error.message };
    }

    // ---------- D：同一套的文件夹照片层 ----------
    try {
      if (!bData) throw new Error('B 未成功，无法做文件夹照片层');
      if (!cHints.title) throw new Error('C 未成功，拿不到套图标题');
      await clickByText('.sidebar-item-row .sidebar-item', '300-Cos套图库', '照片来源（回 B）');
      await waitFor('document.querySelectorAll(".grid-card").length > 0', 120000, '文件夹卡片（返回）');
      await sleep(1500);

      const candidates = (() => {
        const raw = String(cHints.title || '').trim();
        const noParen = raw.replace(/[（(][^（）()]*[）)]/g, '').trim();
        const segments = raw.split(/[｜|]/).map((part) => part.replace(/[（(][^（）()]*[）)]/g, '').trim()).filter((part) => part.length >= 2);
        const pool = [raw, noParen, ...segments].filter(Boolean);
        const scored = pool.map((value) => ({ value, length: value.length }));
        scored.sort((a, b) => b.length - a.length);
        const unique = [];
        for (const item of scored) if (!unique.includes(item.value)) unique.push(item.value);
        return unique.slice(0, 6);
      })();
      log(`D 搜索候选：${JSON.stringify(candidates)}`);
      const typed = await cdp.evaluate(`(() => {
        const input = document.querySelector('.toolbar-search input[type="search"]') || document.querySelector('input[type="search"]');
        if (!input) return { ok: false, reason: '工具栏没有搜索框' };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true, ariaLabel: input.getAttribute('aria-label') || null, placeholder: input.placeholder || null };
      })()`);
      if (!typed.ok) throw new Error(`工具栏搜索框不可用：${typed.reason}`);

      let chosen = null;
      for (const candidate of candidates) {
        await cdp.evaluate(`(() => {
          const input = document.querySelector('.toolbar-search input[type="search"]') || document.querySelector('input[type="search"]');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(candidate)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
        await sleep(900);
        const probe = await cdp.evaluate(`(() => {
          const cards = [...document.querySelectorAll('.grid-card')];
          const names = cards.map((card) => String(card.querySelector('.grid-card-name')?.textContent || '').trim());
          return { count: cards.length, names: names.slice(0, 6), matched: names.some((name) => name.includes(${JSON.stringify(candidate)})) };
        })()`);
        log(`D 候选「${candidate}」→ ${probe.count} 张卡片（${JSON.stringify(probe.names.slice(0, 3))}）`);
        if (probe.count > 0 && probe.matched) { chosen = { candidate, probe }; break; }
      }
      if (!chosen) throw new Error(`搜索候选都匹配不到文件夹：${JSON.stringify(candidates)}`);

      const beforeTitle = await cdp.evaluate('String(document.querySelector(".page-header-title-compact, .page-header-title")?.textContent || "")');
      const entered = await cdp.evaluate(`(() => {
        const card = [...document.querySelectorAll('.grid-card')].find((item) => String(item.querySelector('.grid-card-name')?.textContent || '').includes(${JSON.stringify(chosen.candidate)}));
        if (!card) return { ok: false };
        const name = String(card.querySelector('.grid-card-name')?.textContent || '').trim();
        card.click();
        return { ok: true, name };
      })()`);
      if (!entered.ok) throw new Error('点击匹配的文件夹卡片失败');
      await waitFor(`(() => {
        const title = String(document.querySelector('.page-header-title-compact, .page-header-title')?.textContent || '');
        const cards = document.querySelectorAll('.grid-card').length;
        return cards > 0 && title !== ${JSON.stringify(beforeTitle)};
      })()`, 90000, '进入文件夹照片层');
      await sleep(3000);
      const data = await measure('grid');
      data.screenshot = await takeScreenshot('D-folder-photos.png');
      data.dSearch = { candidate: chosen.candidate, typedAriaLabel: typed.ariaLabel, beforeTitle, enteredFolderName: entered.name };
      recordStep('D', true, data);
    } catch (error) {
      recordStep('D', false, null, error.message);
      measurements.pages.D = { failed: true, error: error.message, hints: cHints };
    }

    // ---------- 对比摘要 ----------
    const summarize = (page) => {
      const data = measurements.pages[page];
      if (!data || data.failed) return null;
      return {
        page,
        title: data.pageHeader?.title || null,
        count: data.pageHeader?.count || null,
        headerHeight: data.pageHeader?.height ?? null,
        headerClass: data.pageHeader?.className || null,
        crumbCount: data.pageHeader?.crumbCount ?? null,
        headerControls: data.pageHeader?.controlSummary || null,
        columns: data.grid?.columnCount ?? null,
        columnGap: data.grid?.columnGap ?? null,
        rowGap: data.grid?.rowGap ?? null,
        cardWidth: data.cards?.firstCardWidth ?? null,
        coverWidth: data.cards?.coverWidth ?? null,
        coverHeight: data.cards?.coverHeight ?? null,
        cardTag: data.cards?.firstCardTag ?? null,
        heartCount: data.cards?.heartCount ?? null,
        selectedCount: data.cards?.selectedCount ?? null,
        toolbarSearch: data.toolbarSearch ?? null,
        headerSearchInput: data.headerSearchInput ?? null,
        nameFontSize: data.text?.name?.fontSize || null,
        nameLineHeight: data.text?.name?.lineHeight || null,
        nameColor: data.text?.name?.color || null,
        metaFontSize: data.text?.meta?.fontSize || null,
        metaLineHeight: data.text?.meta?.lineHeight || null,
        firstCard: data.cards?.firstCardText || null,
        secondLine: data.cards?.firstCardSecondLine || null
      };
    };
    measurements.summary = {
      A: summarize('A'),
      B: summarize('B'),
      C: summarize('C'),
      D: summarize('D'),
      shots
    };
    measurements.steps = steps;

    // S1 验收：两处网格必须是同一套尺寸与文字层级
    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok, detail });
    const close = (a, b, tolerance = 0.5) => (
      typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tolerance
    );
    const comparePair = (leftKey, rightKey, label) => {
      const left = measurements.summary[leftKey];
      const right = measurements.summary[rightKey];
      if (!left || !right) {
        check(`${label} 两页都测得`, false, `${leftKey}=${Boolean(left)} ${rightKey}=${Boolean(right)}`);
        return;
      }
      check(`${label} 列数一致`, left.columns === right.columns, `${left.columns} vs ${right.columns}`);
      check(`${label} 卡宽一致(±0.5px)`, close(left.cardWidth, right.cardWidth), `${left.cardWidth} vs ${right.cardWidth}`);
      check(`${label} 封面高一致(±0.5px)`, close(left.coverHeight, right.coverHeight), `${left.coverHeight} vs ${right.coverHeight}`);
      check(`${label} 名字字号/行高一致`, left.nameFontSize === right.nameFontSize && left.nameLineHeight === right.nameLineHeight,
        `${left.nameFontSize}/${left.nameLineHeight} vs ${right.nameFontSize}/${right.nameLineHeight}`);
      check(`${label} 次行字号一致`, left.metaFontSize === right.metaFontSize, `${left.metaFontSize} vs ${right.metaFontSize}`);
      check(`${label} 卡片元素一致`, left.cardTag === right.cardTag, `${left.cardTag} vs ${right.cardTag}`);
      check(`${label} 都有面包屑`, left.crumbCount >= 1 && right.crumbCount >= 1, `${left.crumbCount} vs ${right.crumbCount}`);
      check(`${label} 都有排序控件`, left.headerControls?.select === 1 && right.headerControls?.select === 1,
        `${left.headerControls?.select} vs ${right.headerControls?.select}`);
      check(`${label} 都有缩略图密度`, left.headerControls?.range === 1 && right.headerControls?.range === 1,
        `${left.headerControls?.range} vs ${right.headerControls?.range}`);
      check(`${label} 搜索都在工具栏`, left.toolbarSearch === true && right.toolbarSearch === true,
        `${left.toolbarSearch} vs ${right.toolbarSearch}`);
      check(`${label} 页头不再有搜索框`, left.headerSearchInput === false && right.headerSearchInput === false,
        `${left.headerSearchInput} vs ${right.headerSearchInput}`);
      check(`${label} 卡片都有收藏心形`, left.heartCount > 0 && right.heartCount > 0,
        `${left.heartCount} vs ${right.heartCount}`);
    };
    comparePair('A', 'B', '套图列表 vs 文件夹网格');
    comparePair('C', 'D', '套图照片页 vs 文件夹照片页');
    measurements.parity = {
      checks,
      ok: checks.every((item) => item.ok),
      note: 'S1–S3 后两处网格、页头控件、搜索位置与收藏入口都应一致；文案与数据口径差异（套 / 个文件夹、其他文件计数）不在断言内'
    };
    log(`一致性断言：${checks.filter((item) => item.ok).length}/${checks.length} 通过`);
    for (const item of checks) if (!item.ok) log(`  ✗ ${item.name}（${item.detail}）`);
    measurements.parity.checks.push({
      name: '缩略图滑杆真正改变列数',
      ok: measurements.densityCheck?.ok === true,
      detail: `${measurements.densityCheck?.before} 列 → ${measurements.densityCheck?.after} 列`
    });
    measurements.parity.ok = measurements.parity.checks.every((item) => item.ok);
    log(`一致性断言：${measurements.parity.checks.filter((item) => item.ok).length}/${measurements.parity.checks.length} 通过`);
    measurements.ok = !steps.some((step) => !step.ok) && measurements.parity.ok;
  } catch (error) {
    measurements.fatal = error.message;
    measurements.ok = false;
    log(`致命错误：${error.message}`);
  } finally {
    try {
      child.kill('SIGTERM');
      await sleep(1200);
      child.kill('SIGKILL');
      log(`已结束自己的进程 PID=${pid}`);
    } catch (error) {
      log(`结束进程时出错：${error.message}`);
    }
    try { cdp?.ws?.close(); } catch (_error) { /* ignore */ }
    measurements.meta.finishedAt = new Date().toISOString();
    measurements.meta.durationMs = Date.now() - new Date(startedAt).getTime();
    measurements.meta.logLines = logLines;
    measurements.meta.appLogTail = (() => {
      try {
        const text = fs.readFileSync(appLogPath, 'utf8');
        return text.split('\n').slice(-40).join('\n');
      } catch (_error) { return null; }
    })();
    appLog.end();
    fs.writeFileSync(path.join(EVID, 'measurements.json'), JSON.stringify(measurements, null, 2));
    log(`已写入 measurements.json，总耗时 ${Math.round(measurements.meta.durationMs / 1000)}s`);
    // 打印便于直接读的摘要
    console.log('\n=== 摘要 ===');
    console.log(JSON.stringify(measurements.summary, null, 2));
    process.exit(measurements.ok ? 0 : 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
