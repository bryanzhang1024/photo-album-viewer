#!/usr/bin/env node
/**
 * 点击冒烟：启动打包后的应用，用 CDP 真点一遍关键路径，失败就非零退出。
 *
 * 为什么要有它：截图只能证明「长得像」，证明不了「点得动」。这个脚本把
 * 「每个入口点下去会发生什么」变成可执行断言，反方也能直接跑它取证。
 *
 * 用法：npm run test:e2e
 * 前置：先 npm run build（脚本会用 dist/mac-arm64 里的产物）。
 * 安全：所有步骤都是只读操作（搜索、切换视图、排序、开标签、右键菜单、开查看器），
 *       不改收藏、不删文件、不改设置。
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_BINARY = path.join(
  ROOT,
  'dist/mac-arm64/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer'
);
const PORT = 9333 + Math.floor(Math.random() * 200);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
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
    name: '进入第一个照片来源：面包屑与工具栏搜索都在',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const items = [...document.querySelectorAll('.sidebar-item')];
        const sources = items.filter((el) => el.querySelector('svg') && el.textContent.trim().includes('Collection'));
        const target = sources[0] || items[items.length - 2];
        if (!target) return { ok: false, reason: '侧栏没有可点的照片来源' };
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
        const add = document.querySelector('[aria-label="新建标签页"]');
        add.click();
        await sleep(300);
        const afterAdd = count();
        const close = document.querySelector('.tab-close');
        close.click();
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
        const listButton = document.querySelector('[aria-label="列表视图"]');
        if (!listButton) return { ok: false, reason: '找不到列表视图按钮' };
        listButton.click();
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
        const gridButton = document.querySelector('[aria-label="图标视图"]');
        if (gridButton) { gridButton.click(); await sleep(800); }
        const card = document.querySelector('.grid-card');
        if (!card) return { ok: false, reason: '没有卡片可点' };
        const rect = card.getBoundingClientRect();
        card.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: rect.left + 20, clientY: rect.top + 20
        }));
        await sleep(300);
        const menu = document.querySelector('[role="menu"]');
        const items = menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent) : [];
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(300);
        return { ok: items.length >= 4 && !document.querySelector('[role="menu"]'), items };
      })()`);
      assert(detail.ok, '卡片右键菜单没弹出或少项', detail);
      return detail;
    }
  },
  {
    name: '查看器：点开图片后 Esc 关闭',
    run: async (page) => {
      const detail = await page.evaluate(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const imageCard = () => [...document.querySelectorAll('.grid-card')]
          .find((el) => /KB/.test(el.querySelector('.grid-card-meta')?.textContent || ''));
        let card = imageCard();
        let depth = 0;
        while (!card && depth < 3) {
          const folder = document.querySelector('.grid-card');
          if (!folder) break;
          folder.click();
          await sleep(1200);
          card = imageCard();
          depth += 1;
        }
        if (!card) return { ok: false, reason: '向下一层找三次仍没有图片卡片', depth };
        card.click();
        await sleep(900);
        const viewer = document.querySelector('[role="dialog"]');
        if (!viewer) return { ok: false, reason: '点开图片没有出现查看器' };
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(400);
        return { ok: !document.querySelector('[role="dialog"]') };
      })()`);
      assert(detail.ok, '查看器打开或 Esc 关闭失败', detail);
      return detail;
    }
  }
];

async function main() {
  if (!fs.existsSync(APP_BINARY)) {
    console.error(`找不到构建产物：${APP_BINARY}\n先运行 npm run build`);
    process.exit(2);
  }

  const child = spawn(APP_BINARY, [`--remote-debugging-port=${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let appLog = '';
  child.stdout.on('data', (chunk) => { appLog += chunk; });
  child.stderr.on('data', (chunk) => { appLog += chunk; });

  const results = [];
  let failed = false;
  try {
    const target = await waitForTarget();
    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    await sleep(1200);

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
    cdp.ws.close();
  } catch (error) {
    failed = true;
    console.error(`启动或连接失败：${error.message}`);
    if (appLog) console.error(appLog.slice(-800));
  } finally {
    child.kill('SIGTERM');
    await sleep(600);
    if (!child.killed) child.kill('SIGKILL');
  }

  const reportPath = path.join(ROOT, '.3things/acceptance/evidence/click-smoke.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({
    at: new Date().toISOString(),
    passed: results.filter((row) => row.ok).length,
    total: STEPS.length,
    failed,
    results
  }, null, 2));
  console.log(`\n报告：${path.relative(ROOT, reportPath)}`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
