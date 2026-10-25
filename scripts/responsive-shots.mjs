#!/usr/bin/env node
/**
 * 响应式取证（规格 L01/R27/T11）：在真实窗口里按五档尺寸截图并断言不溢出。
 *
 * 用临时图库（两张测试图 + 一个子文件夹），不碰用户真实图库数据；
 * 跑完会把临时来源移除，截图落在 .3things/acceptance/evidence/responsive/。
 *
 * 用法：npm run evidence:responsive（前置 npm run build）
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_BINARY = path.join(
  ROOT,
  'dist/mac-arm64/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer'
);
const OUT_DIR = path.join(ROOT, '.3things/acceptance/evidence/responsive');
const PORT = 9533 + Math.floor(Math.random() * 200);

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64'
);

const SIZES = [
  { width: 1440, height: 900, label: '1440 宽屏' },
  { width: 1280, height: 800, label: '1280 常规' },
  { width: 1024, height: 768, label: '1024 中窗' },
  { width: 800, height: 600, label: '800 窄窗' },
  { width: 720, height: 480, label: '720×480 最小' }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function prepareFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-resp-'));
  fs.writeFileSync(path.join(dir, 'a.jpg'), TINY_JPEG);
  fs.writeFileSync(path.join(dir, 'b.jpg'), TINY_JPEG);
  const sub = path.join(dir, '子文件夹');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'c.jpg'), TINY_JPEG);
  return dir;
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', reject);
  });
}

async function waitForPage(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch (_error) {
      // 等应用起来
    }
    await sleep(500);
  }
  throw new Error('等待应用窗口超时');
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

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面执行失败');
    return result?.result?.value;
  }
}

async function main() {
  if (!fs.existsSync(APP_BINARY)) {
    console.error('找不到构建产物，先 npm run build');
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const fixtureDir = prepareFixture();
  const label = path.basename(fixtureDir);
  const child = spawn(APP_BINARY, [`--remote-debugging-port=${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let appLog = '';
  child.stdout.on('data', (chunk) => { appLog += chunk; });
  child.stderr.on('data', (chunk) => { appLog += chunk; });

  const results = [];
  let cdp = null;
  let sourceId = null;
  let failed = false;

  try {
    const page = await waitForPage();
    cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.ready();
    await sleep(1200);

    const setup = await cdp.evaluate(`(async () => {
      const list = await window.electronAPI.invoke('load-source-roots-v1', { contractVersion: 1 });
      for (const source of (list?.data?.sources || [])) {
        if (String(source.label || '').startsWith('pav-resp-')) {
          await window.electronAPI.invoke('remove-source-root-v1', { contractVersion: 1, sourceId: source.sourceId });
        }
      }
      const res = await window.electronAPI.invoke('save-source-root-v1', {
        contractVersion: 1, sourceId: null, rootPath: ${JSON.stringify(fixtureDir)}, label: null
      });
      window.sessionStorage.setItem('pavRespLabel', ${JSON.stringify(label)});
      window.sessionStorage.setItem('pavRespId', res?.data?.source?.sourceId || '');
      return { ok: Boolean(res?.ok), sourceId: res?.data?.source?.sourceId || null };
    })()`);
    if (!setup.ok || !setup.sourceId) throw new Error('注册临时来源失败');
    sourceId = setup.sourceId;

    await cdp.evaluate('window.location.reload()');
    await sleep(2600);
    await cdp.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const label = window.sessionStorage.getItem('pavRespLabel');
      const target = [...document.querySelectorAll('.sidebar-item')]
        .find((el) => el.textContent.trim() === label);
      target.click();
      await sleep(1600);
      return true;
    })()`);

    for (const size of SIZES) {
      // Electron 对 Browser.setWindowBounds 支持不稳定，用视口模拟改尺寸；
      // 媒体查询与 innerWidth 都会跟着变，截图也按模拟视口输出。
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await sleep(900);

      const metrics = await cdp.evaluate(`(() => {
        const root = document.documentElement;
        const cards = [...document.querySelectorAll('.grid-card')];
        const scroll = document.querySelector('.folder-scroll');
        const cardWidth = cards[0] ? cards[0].getBoundingClientRect().width : 0;
        const gap = 14;
        const columns = scroll && cardWidth
          ? Math.max(1, Math.floor((scroll.clientWidth - 44 + gap) / (cardWidth + gap)))
          : 0;
        const tabbar = document.querySelector('.tabbar');
        return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          overflowX: root.scrollWidth - root.clientWidth,
          columns,
          tabbarScrollable: tabbar ? tabbar.scrollWidth > tabbar.clientWidth : false,
          densityVisible: Boolean(document.querySelector('.ctrl-range') && document.querySelector('.ctrl-range').offsetParent),
          searchInput: Boolean(document.querySelector('input[type="search"]')),
          statusShortcutHidden: (() => {
            const bar = document.querySelector('.statusbar');
            const span = bar ? bar.lastElementChild : null;
            return span ? getComputedStyle(span).display === 'none' : null;
          })()
        };
      })()`);

      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT_DIR, `w${size.width}x${size.height}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));

      const ok = metrics.overflowX <= 1;
      results.push({ ...size, ...metrics, file: path.relative(ROOT, file), ok });
      console.log(`${ok ? '✓' : '✗'} ${size.label}：列数 ${metrics.columns}、溢出 ${metrics.overflowX}px、`
        + `密度${metrics.densityVisible ? '显示' : '隐藏'}、搜索${metrics.searchInput ? '输入框' : '图标'}、`
        + `状态栏快捷键${metrics.statusShortcutHidden ? '隐藏' : '显示'}`);
      if (!ok) failed = true;
    }

    // 800 宽下列表隐藏子文件夹列
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 800, height: 600, deviceScaleFactor: 1, mobile: false
    });
    await sleep(600);
    const listColumns = await cdp.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('[aria-label="列表视图"]')?.click();
      await sleep(700);
      return [...document.querySelectorAll('[role="columnheader"]')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => el.textContent.trim());
    })()`);
    const listOk = listColumns.length === 3;
    results.push({ check: 'list-hides-child-column', columns: listColumns, ok: listOk });
    console.log(`${listOk ? '✓' : '✗'} 800 宽列表列数：${listColumns.length}（${listColumns.join(' / ')}）`);
    if (!listOk) failed = true;
  } catch (error) {
    failed = true;
    console.error(`失败：${error.message}`);
    try {
      if (cdp) await cdp.send('Emulation.clearDeviceMetricsOverride');
    } catch (_error) {
      // 忽略
    }
    if (appLog) console.error(appLog.slice(-600));
  } finally {
    if (cdp && sourceId) {
      try {
        await cdp.evaluate(`(async () => {
          await window.electronAPI.invoke('remove-source-root-v1', {
            contractVersion: 1, sourceId: ${JSON.stringify(sourceId)}
          });
          return true;
        })()`);
      } catch (_error) {
        // 下次运行开头会清理 pav-resp-*
      }
    }
    child.kill('SIGTERM');
    await sleep(500);
    try {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch (_error) {
      // 忽略
    }
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'responsive.json'),
    JSON.stringify({ at: new Date().toISOString(), failed, results }, null, 2)
  );
  console.log(`\n证据目录：${path.relative(ROOT, OUT_DIR)}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
