#!/usr/bin/env node
/**
 * 点击冒烟：启动打包后的应用，用 CDP 真点一遍关键路径，失败就非零退出。
 *
 * 为什么要有它：截图只能证明「长得像」，证明不了「点得动」。这个脚本把
 * 「每个入口点下去会发生什么」变成可执行断言，反方也能直接跑它取证。
 *
 * 用法：npm run test:e2e（前置：npm run build）
 *
 * 组成：
 *   1. 在临时目录造两张图，通过真实 IPC 注册成照片来源（确定性，不依赖用户图库）；
 *   2. 真点六条路径：进入来源、搜索、标签页、列头排序、右键菜单、查看器；
 *   3. 通过真实 IPC 移除这个临时来源，并断言侧栏少一条、registry 里也没有了；
 *   4. 删除临时目录。
 * 除了这个临时来源，不改用户任何数据（不收藏、不删图、不改设置）。
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let childRef = null;
const APP_BINARY = path.join(
  ROOT,
  'dist/mac-arm64/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer'
);
const PORT = 9333 + Math.floor(Math.random() * 200);

// 1×1 的合法 JPEG，用来造确定性测试图
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
  'base64'
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function prepareFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-e2e-'));
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

async function waitForTarget(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await httpJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch (_error) {
      // 应用还没起来，继续等
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
    // 连接被关掉或页面正在重载时，pending 永远不会 resolve；加超时避免整脚本挂死。
    const result = await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      sleep(20000).then(() => ({ __timeout: true }))
    ]);
    if (result?.__timeout) throw new Error('页面执行超时');
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || '页面内执行失败');
    }
    return result?.result?.value;
  }
}

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    error.detail = detail;
    throw error;
  }
}

const STEPS = [
  {
    name: '注册临时来源并进入：面包屑与工具栏搜索都在',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const label = window.sessionStorage.getItem('pavE2ELabel');
        const target = [...document.querySelectorAll('.sidebar-item')]
          .find((el) => el.textContent.trim() === label);
        if (!target) return { ok: false, reason: '侧栏没有刚注册的临时来源', label };
        target.click();
        await sleep(1800);
        const crumbs = document.querySelector('[aria-label="面包屑"]');
        const search = document.querySelector('input[type="search"]');
        return {
          ok: Boolean(crumbs) && Boolean(search),
          crumbs: crumbs ? crumbs.textContent.replace(/\\s+/g, ' ') : null,
          searchLabel: search ? search.getAttribute('aria-label') : null
        };
      })()`);
      assert(detail.ok, '进入来源后没有面包屑或工具栏搜索框', detail);
      return detail;
    }
  },
  {
    name: '搜索：输入关键词后计数变化，Esc 清空恢复',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const input = document.querySelector('input[type="search"]');
        if (!input) return { ok: false, reason: '找不到搜索框' };
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'zzz-no-such-item');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(500);
        const count = [...document.querySelectorAll('.page-header-count')].map((el) => el.textContent).join(' ');
        const hasResultText = count.includes('个结果');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(400);
        const after = [...document.querySelectorAll('.page-header-count')].map((el) => el.textContent).join(' ');
        return { ok: hasResultText && !after.includes('个结果'), count, after };
      })()`);
      assert(detail.ok, '搜索没有改变计数，或 Esc 没有清空', detail);
      return detail;
    }
  },
  {
    name: '标签页：新建后变两个、关闭后回一个',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const count = () => document.querySelectorAll('[role="tab"]').length;
        document.querySelector('[aria-label="新建标签页"]').click();
        await sleep(300);
        const afterAdd = count();
        document.querySelector('.tab-close').click();
        await sleep(300);
        return { ok: afterAdd === 2 && count() === 1, afterAdd, afterClose: count() };
      })()`);
      assert(detail.ok, '标签页新建或关闭没生效', detail);
      return detail;
    }
  },
  {
    name: '列表视图：列头可点并出现排序方向',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[aria-label="列表视图"]').click();
        await sleep(700);
        const headers = [...document.querySelectorAll('[role="columnheader"]')];
        const sortable = headers.find((el) => el.tagName === 'BUTTON');
        if (!sortable) return { ok: false, reason: '列头不是可点按钮' };
        sortable.click();
        await sleep(400);
        return {
          ok: sortable.getAttribute('aria-sort') !== 'none',
          headers: headers.map((el) => el.textContent.trim()),
          ariaSort: sortable.getAttribute('aria-sort')
        };
      })()`);
      assert(detail.ok, '列头点击后没有排序方向', detail);
      return detail;
    }
  },
  {
    name: '右键菜单：卡片弹出五项，Esc 关闭',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('[aria-label="图标视图"]')?.click();
        await sleep(800);
        const cards = [...document.querySelectorAll('.grid-card')];
        const card = cards.find((el) => /个子文件夹/.test(el.querySelector('.grid-card-meta')?.textContent || '')) || cards[0];
        if (!card) return { ok: false, reason: '没有卡片可点' };
        const isFolderCard = /个子文件夹/.test(card.querySelector('.grid-card-meta')?.textContent || '');
        const rect = card.getBoundingClientRect();
        card.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: rect.left + 20, clientY: rect.top + 20
        }));
        await sleep(300);
        const menu = document.querySelector('[role="menu"]');
        const items = menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent) : [];
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
        // 文件夹卡片应有五项；图片卡片至少三项
        const folderMenu = ['打开', '在新标签页打开', '在新窗口中打开', '添加到收藏', '在 Finder 中显示'];
        const imageMenu = ['打开', '添加到收藏', '在 Finder 中显示'];
        const required = isFolderCard ? folderMenu : imageMenu;
        const hasAll = required.every((text) => items.some((item) => item.includes(text)));
        const exact = !isFolderCard || items.length === folderMenu.length;
        return {
          ok: hasAll && exact && !document.querySelector('[role="menu"]'),
          items,
          isFolderCard
        };
      })()`);
      assert(detail.ok, '卡片右键菜单没弹出或少项', detail);
      return detail;
    }
  },
  {
    name: '查看器：点开图片、信息面板有尺寸、Esc 关闭',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const card = [...document.querySelectorAll('.grid-card')]
          .find((el) => /KB/.test(el.querySelector('.grid-card-meta')?.textContent || ''));
        if (!card) return { ok: false, reason: '临时来源里没有图片卡片' };
        card.click();
        await sleep(900);
        const viewer = document.querySelector('[role="dialog"]');
        if (!viewer) return { ok: false, reason: '点开图片没有出现查看器' };
        viewer.querySelector('[aria-label="图片信息"]')?.click();
        await sleep(300);
        const info = viewer.querySelector('.viewer-info')?.textContent || '';
        const hasSize = info.includes('尺寸');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
        const panelClosed = !viewer.querySelector('.viewer-info');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(400);
        return {
          ok: hasSize && panelClosed && !document.querySelector('[role="dialog"]'),
          hasSize,
          panelClosed
        };
      })()`);
      assert(detail.ok, '查看器打开、信息面板或 Esc 分层失败', detail);
      return detail;
    }
  },
  {
    name: '安全边界：未注册的根、根目录 /、未授权文件列表都被拒绝',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const coverTmp = await window.electronAPI.invoke('get-folder-cover-v1', {
          rootPath: '/tmp', relativePath: ''
        });
        const coverRoot = await window.electronAPI.invoke('get-folder-cover-v1', {
          rootPath: '/', relativePath: 'tmp'
        });
        const listTmp = await window.electronAPI.invoke('list-directory-files-v1', '/tmp');
        const scanTmp = await window.electronAPI.invoke('scan-navigation-level', '/tmp');
        const scanRoot = await window.electronAPI.invoke('scan-navigation-level', '/');
        const dropRoot = await window.electronAPI.invoke('resolve-dropped-folders', ['/']);
        const saveRoot = await window.electronAPI.invoke('save-source-root-v1', {
          contractVersion: 1, sourceId: null, rootPath: '/', label: null
        });
        const saveLink = await window.electronAPI.invoke('save-source-root-v1', {
          contractVersion: 1, sourceId: null, rootPath: window.__pavRootLink, label: null
        });
        const dropRootDenied = (dropRoot?.folders || []).length === 0
          && (dropRoot?.rejected || []).includes('/');
        const saveRootDenied = saveRoot?.ok === false;
        const saveLinkDenied = saveLink?.ok === false;
        return {
          ok: coverTmp?.success === false
            && coverRoot?.success === false
            && listTmp?.success === false
            && scanTmp?.success === false
            && scanRoot?.success === false
            && dropRootDenied
            && saveRootDenied
            && saveLinkDenied,
          coverTmp, coverRoot, listTmp,
          scanTmp: scanTmp?.success === false ? 'denied' : scanTmp,
          scanRoot: scanRoot?.success === false ? 'denied' : scanRoot,
          dropRootDenied,
          saveRootDenied,
          saveLinkDenied
        };
      })()`);
      assert(detail.ok, '未授权路径没有被拒绝', detail);
      return detail;
    }
  },
  {
    name: '通过侧栏移除临时来源：菜单确认后侧栏少一条、registry 也没有',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const label = window.sessionStorage.getItem('pavE2ELabel');
        const sourceId = window.sessionStorage.getItem('pavE2ESourceId');
        const row = [...document.querySelectorAll('.sidebar-item-row')]
          .find((el) => el.textContent.trim().startsWith(label));
        if (!row) return { ok: false, reason: '侧栏找不到临时来源行' };
        row.querySelector('.sidebar-item-remove').click();
        await sleep(300);
        const menu = document.querySelector('[role="menu"]');
        if (!menu) return { ok: false, reason: '移除菜单没有弹出' };
        const confirm = [...menu.querySelectorAll('[role="menuitem"]')]
          .find((el) => el.textContent.includes(label));
        if (!confirm) return { ok: false, reason: '菜单里没有确认项', menu: menu.textContent };
        confirm.click();
        await sleep(800);
        const stillVisible = [...document.querySelectorAll('.sidebar-item-row')]
          .some((el) => el.textContent.trim().startsWith(label));
        const reloaded = await window.electronAPI.invoke('load-source-roots-v1', { contractVersion: 1 });
        const ids = (reloaded?.data?.sources || []).map((item) => item.sourceId);
        return {
          ok: !stillVisible && ids.indexOf(sourceId) === -1,
          stillVisible,
          stillInRegistry: ids.indexOf(sourceId) !== -1
        };
      })()`);
      assert(detail.ok, '侧栏移除来源失败或 registry 未更新', detail);
      return detail;
    }
  }
];

function writeReport(results, attempt) {
  const reportPath = path.join(ROOT, '.3things/acceptance/evidence/click-smoke.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    at: new Date().toISOString(),
    attempt,
    passed: results.filter((row) => row.ok).length,
    total: STEPS.length,
    failed: results.length < STEPS.length || results.some((row) => !row.ok),
    results
  }, null, 2));
  return reportPath;
}

/** 跑一次完整流程。隔离 user-data-dir：不碰真实来源注册表，也不会被用户正在开的实例挡住。 */
async function runOnce({ profileDir, fixtureDir, label, attempt, rootLinkPath }) {
  const child = spawn(APP_BINARY, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  childRef = child;

  let appLog = '';
  child.stdout.on('data', (chunk) => { appLog += chunk; });
  child.stderr.on('data', (chunk) => { appLog += chunk; });

  const results = [];
  let failed = false;
  let cdp = null;
  let fixtureSourceId = null;

  try {
    const target = await waitForTarget();
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    await sleep(1200);

    const setup = await cdp.evaluate(`(async () => {
      const res = await window.electronAPI.invoke('save-source-root-v1', {
        contractVersion: 1, sourceId: null, rootPath: ${JSON.stringify(fixtureDir)}, label: null
      });
      window.sessionStorage.setItem('pavE2ELabel', ${JSON.stringify(label)});
      window.__pavRootLink = ${JSON.stringify(rootLinkPath)};
      window.sessionStorage.setItem('pavE2ESourceId', res?.data?.source?.sourceId || '');
      return { ok: Boolean(res?.ok), sourceId: res?.data?.source?.sourceId || null, error: res?.error?.message || null };
    })()`);
    fixtureSourceId = setup.sourceId;
    if (!setup.ok || !setup.sourceId) {
      throw new Error(`注册临时来源失败：${setup.error || '未知原因'}`);
    }

    // 重新加载让侧栏读到新注册的来源（应用只在启动时拉一次列表）
    await cdp.evaluate('window.location.reload()');
    await sleep(2600);

    for (const step of STEPS) {
      try {
        const detail = await step.run(cdp);
        results.push({ step: step.name, ok: true, detail });
        console.log(`✓ ${step.name}`);
      } catch (error) {
        failed = true;
        results.push({ step: step.name, ok: false, error: error.message, detail: error.detail });
        console.error(`✗ ${step.name}\n  ${error.message}`);
        if (error.detail) console.error(`  ${JSON.stringify(error.detail)}`);
        break;
      }
    }
  } catch (error) {
    failed = true;
    console.error(`尝试 ${attempt} 启动/连接失败：${error.message}`);
    if (appLog) console.error(appLog.slice(-600));
  } finally {
    if (cdp && fixtureSourceId) {
      try {
        await cdp.evaluate(`(async () => {
          await window.electronAPI.invoke('remove-source-root-v1', {
            contractVersion: 1, sourceId: ${JSON.stringify(fixtureSourceId)}
          });
          return true;
        })()`);
      } catch (_error) {
        // 整个 user-data-dir 会被删掉，留着也没关系
      }
    }
    try {
      child.kill('SIGTERM');
      await sleep(800);
      child.kill('SIGKILL');
    } catch (_error) {
      // 已退出
    }
    if (cdp) {
      try {
        cdp.ws.close();
      } catch (_error) {
        // 已关闭
      }
    }
  }
  return { results, failed };
}

async function main() {
  // 看门狗：任何一步卡住都不许无限等（曾出现过 app 未退出导致 npm 挂住）
  const watchdog = setTimeout(() => {
    console.error('超时：4 分钟内没有跑完，按失败处理');
    try {
      childRef?.kill('SIGKILL');
    } catch (_error) {
      // 已退出
    }
    process.exit(3);
  }, 240000);
  watchdog.unref();

  if (!fs.existsSync(APP_BINARY)) {
    console.error(`找不到构建产物：${APP_BINARY}\n先运行 npm run build`);
    process.exit(2);
  }

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pav-e2e-profile-'));
  const fixtureDir = prepareFixture();
  const label = path.basename(fixtureDir);
  const rootLinkPath = path.join(fixtureDir, 'rootlink');
  try {
    fs.symlinkSync('/', rootLinkPath, 'dir');
  } catch (_error) {
    // 不支持软链接时该步会因 rootlink 不存在而拒绝，断言仍成立
  }

  let outcome = { results: [], failed: true };
  let attempt = 0;
  for (attempt = 1; attempt <= 2; attempt += 1) {
    outcome = await runOnce({ profileDir, fixtureDir, label, attempt, rootLinkPath });
    if (!outcome.failed) break;
    if (attempt < 2) {
      console.error('第一次没跑通，重试一次…');
      await sleep(1500);
    }
  }

  const reportPath = writeReport(outcome.results, attempt);
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch (_error) {
    // 临时目录删不掉不影响结论
  }
  console.log(`\n报告：${path.relative(ROOT, reportPath)}`);
  process.exit(outcome.failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
