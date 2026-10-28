#!/usr/bin/env node
/**
 * 只读取证：启动构建好的应用（或装好的 /Applications 版本），在隔离 profile 里
 * 用一个临时图片来源真点查看器，验证 4.7.0 恢复的「左键单击逐级放大」。
 *
 * 用法：
 *   node scripts/evidence-viewer-click-zoom.mjs                 # 默认 dist 里的构建产物
 *   PAV_APP="/Applications/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer" \
 *     PAV_EVID_PREFIX=installed- PAV_EVID_JSON=verification-installed.json \
 *     node scripts/evidence-viewer-click-zoom.mjs
 *
 * 不碰用户图库与真实 profile：临时来源注册在隔离 user-data-dir，图片是现场生成的。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.PAV_APP
  || path.join(ROOT, 'dist/mac-arm64/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer');
const EVID = path.join(ROOT, '.3things/acceptance/evidence/viewer-click-zoom');
const PREFIX = process.env.PAV_EVID_PREFIX || '';
const REPORT_NAME = process.env.PAV_EVID_JSON || 'verification.json';
const PORT = 9400 + Math.floor(Math.random() * 200);
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

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result?.__timeout) throw new Error('页面执行超时');
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面内执行失败');
    return result?.result?.value;
  }
}

/** 生成一张有明显参照物的测试图，放大后肉眼能看出变化。 */
async function makeFixture() {
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-zoom-'));
  for (const n of [1, 2]) {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#16324f"/>
        <stop offset="1" stop-color="#7a2e4a"/></linearGradient></defs>
      <rect width="1200" height="900" fill="url(#g)"/>
      <g stroke="rgba(255,255,255,0.22)" stroke-width="2">
        ${Array.from({ length: 12 }, (_, i) => `<line x1="${i * 100}" y1="0" x2="${i * 100}" y2="900"/>`).join('')}
        ${Array.from({ length: 9 }, (_, i) => `<line x1="0" y1="${i * 100}" x2="1200" y2="${i * 100}"/>`).join('')}
      </g>
      <g fill="rgba(255,255,255,0.9)" font-family="Helvetica, Arial, sans-serif">
        <text x="90" y="170" font-size="72" font-weight="700">PAV 4.7.0</text>
        <text x="90" y="250" font-size="34">点击放大 · 拖动平移 · 右键关闭</text>
        <text x="90" y="340" font-size="150" font-weight="700">${n}</text>
        <text x="90" y="800" font-size="26">zoom-evidence fixture · ${n} / 2</text>
      </g>
      <circle cx="980" cy="690" r="110" fill="rgba(255,205,90,0.85)"/>
      <circle cx="980" cy="690" r="60" fill="rgba(20,20,24,0.75)"/>
    </svg>`);
    await sharp(svg).jpeg({ quality: 88 }).toFile(path.join(dir, `${n}.jpg`));
  }
  return dir;
}

const startedAt = new Date().toISOString();
const assertions = [];
const shots = [];
const consoleLines = [];

function record(name, ok, detail) {
  assertions.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

async function main() {
  if (!fs.existsSync(APP)) throw new Error(`找不到应用：${APP}`);
  fs.mkdirSync(EVID, { recursive: true });

  const fixtureDir = await makeFixture();
  const label = path.basename(fixtureDir);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-zoom-profile-'));

  const child = spawn(APP, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => consoleLines.push(String(chunk)));
  child.stderr.on('data', (chunk) => consoleLines.push(String(chunk)));

  let cdp = null;
  const finish = async (error) => {
    try { cdp?.ws.close(); } catch (_error) { /* ignore */ }
    child.kill('SIGTERM');
    await sleep(700);
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(profileDir, { recursive: true, force: true });
    const report = {
      at: new Date().toISOString(),
      startedAt,
      app: APP,
      fixture: label,
      passed: assertions.filter((row) => row.ok).length,
      total: assertions.length,
      ok: !error && assertions.every((row) => row.ok),
      error: error ? String(error.message || error) : null,
      assertions,
      screenshots: shots
    };
    fs.writeFileSync(path.join(EVID, REPORT_NAME), JSON.stringify(report, null, 2));
    if (consoleLines.length) {
      fs.writeFileSync(path.join(EVID, REPORT_NAME.replace(/\.json$/, '.app-console.txt')), consoleLines.join(''));
    }
    if (error) {
      console.error(`\n失败：${error.message}`);
      process.exitCode = 1;
    }
  };

  try {
    let target = null;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      try {
        const list = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
        target = (list || []).find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (target) break;
      } catch (_error) { /* 还没起来 */ }
      await sleep(500);
    }
    if (!target) throw new Error('等待应用窗口超时');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    await sleep(1500);

    const waitFor = async (expr, timeoutMs, name) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        try {
          if (await cdp.evaluate(expr)) return true;
        } catch (_error) { /* 页面切换中 */ }
        await sleep(400);
      }
      throw new Error(`等待超时：${name}`);
    };

    // 注册临时来源（隔离 profile，只写这个临时目录）
    const setup = await cdp.evaluate(`(async () => {
      const res = await window.electronAPI.invoke('save-source-root-v1', {
        contractVersion: 1, sourceId: null, rootPath: ${JSON.stringify(fixtureDir)}, label: null
      });
      return { ok: Boolean(res?.ok), error: res?.error?.message || null };
    })()`);
    if (!setup.ok) throw new Error(`注册临时来源失败：${setup.error || '未知原因'}`);

    const ua = await cdp.evaluate('navigator.userAgent');
    record('安装/运行版本为 4.7.0（UA 含 /4.7.0）', String(ua).includes('/4.7.0'), ua);

    await cdp.evaluate('window.location.reload()');
    await sleep(2600);
    await waitFor('Boolean(document.querySelector(".sidebar-item"))', 30000, '侧栏');

    const entered = await cdp.evaluate(`(async () => {
      const item = [...document.querySelectorAll('.sidebar-item')]
        .find((el) => el.textContent.includes(${JSON.stringify(label)}));
      if (!item) return { ok: false, reason: '侧栏没有临时来源' };
      item.click();
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      await sleep(1800);
      const cards = [...document.querySelectorAll('.grid-card')];
      return { ok: cards.length >= 2, cards: cards.length };
    })()`);
    record('临时来源进入后有 2 张图片卡片', entered.ok, entered);

    const opened = await cdp.evaluate(`(async () => {
      const pad = (n) => String(n).padStart(2, '0');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const card = document.querySelector('.grid-card');
      card.click();
      await sleep(900);
      const viewer = document.querySelector('[role="dialog"]');
      return {
        ok: Boolean(viewer && viewer.querySelector('.viewer-image')),
        title: viewer?.querySelector('.viewer-title')?.textContent.trim() || null
      };
    })()`);
    record('单击图片卡片打开查看器', opened.ok, opened);

    // 页面内操作助手：用真实 DOM 事件走 React 的 mouse 处理器
    await cdp.evaluate(`(() => {
      window.__pavZoom = {
        stage: () => document.querySelector('.viewer-stage'),
        zoom: () => document.querySelector('.viewer-zoom')?.textContent || null,
        title: () => document.querySelector('.viewer-title')?.textContent.trim() || '',
        transform: () => document.querySelector('.viewer-image')?.style.transform || '',
        showBar: () => {
          const viewer = document.querySelector('[role="dialog"]');
          if (!viewer) return null;
          viewer.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: innerHeight - 10 }));
          return document.querySelector('.viewer-bar')?.className || '';
        },
        clickStage: async (times = 1) => {
          const stage = window.__pavZoom.stage();
          const x = Math.round(innerWidth / 2);
          const y = Math.round(innerHeight / 2);
          for (let i = 0; i < times; i += 1) {
            stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
            stage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x, clientY: y }));
          }
          await new Promise((r) => setTimeout(r, 150));
          return window.__pavZoom.zoom();
        },
        longPress: async () => {
          const stage = window.__pavZoom.stage();
          const x = Math.round(innerWidth / 2);
          const y = Math.round(innerHeight / 2);
          stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
          await new Promise((r) => setTimeout(r, 320));
          stage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x, clientY: y }));
          return window.__pavZoom.zoom();
        },
        drag: async (dx = 40) => {
          const stage = window.__pavZoom.stage();
          const x = Math.round(innerWidth / 2);
          const y = Math.round(innerHeight / 2);
          stage.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y }));
          stage.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x + dx, clientY: y }));
          stage.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x + dx, clientY: y }));
          await new Promise((r) => setTimeout(r, 150));
          return { zoom: window.__pavZoom.zoom(), transform: window.__pavZoom.transform() };
        },
        wheel: async (deltaY, meta = false) => {
          window.__pavZoom.stage().dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, deltaY, ctrlKey: meta
          }));
          await new Promise((r) => setTimeout(r, 150));
          return window.__pavZoom.zoom();
        },
        clickButton: (aria) => {
          const button = [...document.querySelectorAll('button')]
            .find((el) => el.getAttribute('aria-label') === aria);
          if (!button) return false;
          button.click();
          return true;
        }
      };
      return true;
    })()`);

    let data = await cdp.evaluate('({ zoom: __pavZoom.zoom(), title: __pavZoom.title() })');
    record('打开时缩放 100%', data.zoom === '100%', data);

    const shot = async (name) => {
      await cdp.evaluate('__pavZoom.showBar()');
      await sleep(220);
      await cdp.send('Page.bringToFront', {}, 5000).catch(() => {});
      const viewport = await cdp.evaluate('({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })');
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false
      }, 10000);
      const capture = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 86, captureBeyondViewport: false }, 20000);
      await cdp.send('Emulation.clearDeviceMetricsOverride', 10000).catch(() => {});
      const file = path.join(EVID, `${PREFIX}${name}`);
      fs.writeFileSync(file, Buffer.from(capture.data, 'base64'));
      shots.push({ file: path.basename(file), viewport });
      console.log(`  截图：${path.basename(file)}`);
    };

    await shot('00-viewer-100.jpg');

    data = await cdp.evaluate('(async () => ({ zoom: await __pavZoom.clickStage(1) }))()');
    record('单击一次放大到 120%', data.zoom === '120%', data);
    await shot('01-click-once-120.jpg');

    data = await cdp.evaluate('(async () => ({ zoom: await __pavZoom.clickStage(2) }))()');
    record('连点三下累计到 173%', data.zoom === '173%', data);
    await shot('02-click-three-173.jpg');

    data = await cdp.evaluate('(async () => __pavZoom.drag(40))()');
    record('拖动 40px 只平移、缩放保持 173%', data.zoom === '173%' && /translate\(40px, 0px\)/.test(data.transform), data);
    await shot('03-drag-pan-173.jpg');

    data = await cdp.evaluate(`(async () => {
      __pavZoom.clickButton('适应窗口');
      await new Promise((r) => setTimeout(r, 200));
      return { zoom: __pavZoom.zoom(), transform: __pavZoom.transform() };
    })()`);
    record('适应窗口复位到 100% 且位置回中', data.zoom === '100%' && /translate\(0px, 0px\)/.test(data.transform), data);

    data = await cdp.evaluate(`(async () => {
      const before = __pavZoom.title();
      __pavZoom.clickButton('下一张');
      await new Promise((r) => setTimeout(r, 500));
      return { before, title: __pavZoom.title(), zoom: __pavZoom.zoom() };
    })()`);
    record('点右翻页箭头：换到下一张，不放大（仍 100%）', /2 \/ 2/.test(data.title) && data.zoom === '100%', data);
    await shot('04-next-arrow-100.jpg');

    data = await cdp.evaluate('(async () => ({ zoom: await __pavZoom.wheel(-120, true) }))()');
    record('⌘滚轮向上仍能放大（100% → 110%）', data.zoom === '110%', data);

    data = await cdp.evaluate(`(async () => {
      const before = __pavZoom.title();
      __pavZoom.wheel(120, false);
      await new Promise((r) => setTimeout(r, 500));
      return { before, title: __pavZoom.title(), zoom: __pavZoom.zoom() };
    })()`);
    record('普通滚轮翻页后缩放复位到 100%', data.zoom === '100%' && data.title !== data.before, data);

    data = await cdp.evaluate('(async () => ({ zoom: await __pavZoom.longPress() }))()');
    record('长按 320ms 后松开不算单击', data.zoom === '100%', data);

    data = await cdp.evaluate('(async () => ({ zoom: await __pavZoom.clickStage(15), title: __pavZoom.title() }))()');
    record('连点到上限后保持 800%', data.zoom === '800%', data);
    await shot('05-max-800.jpg');

    data = await cdp.evaluate(`(async () => {
      const viewer = document.querySelector('[role="dialog"]');
      viewer.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return { closed: !document.querySelector('[role="dialog"]') };
    })()`);
    record('右键关闭查看器（原有行为不变）', data.closed, data);

    const passed = assertions.filter((row) => row.ok).length;
    console.log(`\n${passed}/${assertions.length} 条断言通过；报告写入 ${path.join(EVID, REPORT_NAME)}`);
    if (passed !== assertions.length) throw new Error(`断言未全过：${passed}/${assertions.length}`);
    await finish(null);
  } catch (error) {
    await finish(error);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
