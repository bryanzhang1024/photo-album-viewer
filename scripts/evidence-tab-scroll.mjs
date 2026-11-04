#!/usr/bin/env node
// 真实 Electron 窗口：隔离 profile、只读真实 COS 索引、临时照片来源。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const task = process.env.PAV_EVID_TEMP;
if (!task || !path.isAbsolute(task)) throw new Error('PAV_EVID_TEMP must be an agent-tmp task directory');
const app = process.env.PAV_APP || path.join(root, 'dist/mac-arm64/Photo Album Viewer.app/Contents/MacOS/Photo Album Viewer');
const prefix = process.env.PAV_EVID_PREFIX || 'built';
const evidence = path.join(root, '.3things/acceptance/evidence/tab-scroll');
fs.mkdirSync(evidence, { recursive: true });
const profile = fs.mkdtempSync(path.join(task, `${prefix}-profile-`));
const fixture = fs.mkdtempSync(path.join(task, `${prefix}-photos-`));
fs.mkdirSync(path.join(fixture, 'B'));
const png = await sharp({ create: { width: 120, height: 160, channels: 3, background: '#365b78' } }).png().toBuffer();
for (let i = 0; i < 220; i++) {
  const name = `${String(i).padStart(3, '0')}.png`;
  fs.writeFileSync(path.join(fixture, name), png);
  fs.linkSync(path.join(fixture, name), path.join(fixture, 'B', name));
}
const userProfile = path.join(os.homedir(), 'Library/Application Support/photo-album-viewer');
for (const name of ['cos-library-catalog-v1.json', 'cos-library-roots-v1.json', 'library-sources-v3.json']) {
  fs.copyFileSync(path.join(userProfile, name), path.join(profile, name));
}
const port = await new Promise(resolve => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const child = spawn(app, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], { stdio: ['ignore', 'pipe', 'pipe'] });
const output = [];
child.stdout.on('data', d => output.push(String(d)));
child.stderr.on('data', d => output.push(String(d)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let ws, error;
let seq = 0;
const pending = new Map();
async function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 25000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: e => { clearTimeout(timer); reject(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
async function until(expr, label, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expr)) return; await delay(70); }
  throw new Error(`等待 ${label} 超时`);
}
async function check(name, expression) {
  const detail = await evaluate(expression);
  const ok = typeof detail === 'object' ? Boolean(detail.ok) : Boolean(detail);
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} ${JSON.stringify(detail)}`);
}
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  assert.ok(point, selector);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  await delay(120);
}
const grid = 'document.querySelector("main .folder-scroll")';
async function ready(label = '文件网格') {
  await until(`${grid}?.getAttribute('aria-label')===${JSON.stringify(label)} && ${grid}.querySelectorAll('[data-key]').length>0`, label);
  await delay(250);
}
async function wheel(deltaY) {
  const point = await evaluate(`(()=>{const b=${grid}.getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaY, deltaX: 0 });
  await delay(250);
}
async function snapshot() {
  return evaluate(`(()=>{const g=${grid};const box=g.getBoundingClientRect();const first=[...g.querySelectorAll('[data-key]')].find(e=>e.getBoundingClientRect().bottom>box.top+40);return {top:g.scrollTop,height:g.scrollHeight,key:first?.dataset.key}})()`);
}
async function restored(name, before) {
  await delay(600);
  await check(name, `(()=>{const g=${grid};return {ok:Math.abs(g.scrollTop-${before.top})<=1,expected:${before.top},actual:g.scrollTop,height:g.scrollHeight}})()`);
}
async function tabs(locations) {
  await evaluate(`(()=>{localStorage.setItem('pav.tabs.v1',JSON.stringify({tabs:${JSON.stringify(locations)}.map(location=>({history:[location],historyIndex:0})),activeIndex:0}));location.reload()})()`);
  await ready();
}
async function shot(name) {
  await send('Page.bringToFront');
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, `${prefix}-${name}.png`), Buffer.from(r.data, 'base64'));
}

try {
  let target;
  for (let i = 0; i < 120; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl); if (target) break; } catch {}
    await delay(250);
  }
  assert.ok(target, '应用启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', e => { const r = JSON.parse(String(e.data)); const p = pending.get(r.id); if (p) { pending.delete(r.id); if (r.error) p.reject(new Error(JSON.stringify(r.error))); else p.resolve(r.result); } });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await until('Boolean(window.electronAPI && document.querySelector(".sidebar"))', '应用入口');
  console.log('运行版本：', await evaluate('navigator.userAgent'));
  const saved = await evaluate(`window.electronAPI.invoke('save-source-root-v1',{contractVersion:1,sourceId:null,rootPath:${JSON.stringify(fixture)},label:'位置记忆验证'})`);
  assert.ok(saved.ok, JSON.stringify(saved));
  const folder = { kind: 'folder', sourceId: saved.data.source.sourceId, relativePath: '' };
  const other = { ...folder, relativePath: 'B' };
  await tabs([folder, folder]);
  await wheel(1600);
  const a = await snapshot();
  await shot('folder-a-before');
  await click('[role=tab]:nth-child(2)'); await ready();
  await check('同目录新标签不继承另一标签的位置', `${grid}.scrollTop===0`);
  await wheel(2800); const b = await snapshot();
  await click('[role=tab]:nth-child(1)'); await ready();
  await restored('鼠标切回 A 保持原滚动位置', a);
  await shot('folder-a-after');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ']', code: 'BracketRight', modifiers: 12 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ']', code: 'BracketRight', modifiers: 12 });
  await ready();
  await restored('⇧⌘] 切回 B 保持独立位置', b);

  await tabs([folder, other]);
  await click('button[aria-label="列表视图"]'); await ready('文件列表');
  await wheel(1800); const listA = await snapshot();
  await click('[role=tab]:nth-child(2)'); await ready();
  await click('button[aria-label="列表视图"]'); await ready('文件列表');
  await wheel(3400); const listB = await snapshot();
  await click('[role=tab]:nth-child(1)'); await ready('文件列表');
  await restored('不同目录的列表 A 位置恢复', listA);
  await shot('list-restored');
  await click('[role=tab]:nth-child(2)'); await ready('文件列表');
  await restored('不同目录的列表 B 位置恢复', listB);

  const cosSets = { kind: 'cos-sets', viewKind: 'all' };
  await tabs([cosSets, folder]);
  for (let i = 0; i < 4; i++) {
    const height = (await snapshot()).height;
    await evaluate(`${grid}.scrollTop=${grid}.scrollHeight`);
    await until(`${grid}.scrollHeight>${height}`, 'COS 下一页');
  }
  await wheel(-500);
  const deep = await snapshot();
  await shot('cos-list-before');
  await click('[role=tab]:nth-child(2)'); await ready('文件列表');
  await click('[role=tab]:nth-child(1)'); await ready();
  await restored('真实 COS 列表滚过五页仍恢复原位置', deep);
  await check('恢复后的锚点卡片已渲染', `Boolean([...${grid}.querySelectorAll('[data-key]')].find(e=>e.dataset.key===${JSON.stringify(deep.key)}))`);
  await shot('cos-list-after');

  const candidates = await evaluate(`window.electronAPI.invoke('cos-list-sets',{sortBy:'imageCount',sortDirection:'desc',limit:5})`);
  const album = candidates.items.find(set => set.imageCount >= 240);
  assert.ok(album, '需要至少 240 张照片的在线套图');
  await tabs([{ kind: 'cos-set', setId: album.id, name: album.displayName }, folder]);
  const height = (await snapshot()).height;
  await evaluate(`${grid}.scrollTop=${grid}.scrollHeight`);
  await until(`${grid}.scrollHeight>${height}`, '套内照片第二页');
  await wheel(-400);
  const photo = await snapshot();
  await click('[role=tab]:nth-child(2)'); await ready('文件列表');
  await click('[role=tab]:nth-child(1)'); await ready();
  await restored('真实套内照片超过 120 张后仍恢复位置', photo);
  await check('照片页恢复后仍有可见照片', `${grid}.querySelectorAll('.grid-card').length>0`);
  await shot('cos-photo-restored');
} catch (e) {
  error = e; console.error(e);
} finally {
  fs.writeFileSync(path.join(evidence, `${prefix}-verification.json`), JSON.stringify({ at: new Date().toISOString(), app, viewport: { width: 1280, height: 900 }, ok: !error && checks.every(c=>c.ok), passed: checks.filter(c=>c.ok).length, total: checks.length, error: error?.message || null, checks }, null, 2) + '\n');
  fs.writeFileSync(path.join(task, `${prefix}-app.log`), output.join(''));
  ws?.close(); child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
  if (error || checks.some(c=>!c.ok)) process.exitCode = 1;
}
