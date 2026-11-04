#!/usr/bin/env node
// 构建产物/安装版使用同一套真实窗口验收；所有来源、Cos 配置和 profile 都隔离。
import fs from 'node:fs';
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
const evidence = path.join(root, '.3things/acceptance/evidence/multi-image-copy');
fs.mkdirSync(evidence, { recursive: true });
const fixture = fs.mkdtempSync(path.join(task, `${prefix}-images-`));
const profile = fs.mkdtempSync(path.join(task, `${prefix}-profile-`));
const album = path.join(fixture, '[测试署名] 多选验证 (测试角色)');
fs.mkdirSync(album);
fs.writeFileSync(path.join(album, 'cosset.json'), JSON.stringify({ schema: 'cosset/1', id: 'set:multi-copy-evidence', display_name: '多选验证套图', cosers: ['测试署名'], characters: ['测试角色'], works: [], looks: [], themes: [], type: '测试' }));
for (let i = 1; i <= 150; i++) {
  const color = ['#a83141', '#2b698b', '#2b7b65'][(i - 1) % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="240" height="320" fill="${color}"/><text x="120" y="185" text-anchor="middle" fill="white" font-size="70" font-family="sans-serif">${i}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(album, `${String(i).padStart(3, '0')}.png`));
}
fs.writeFileSync(path.join(profile, 'cos-library-roots-v1.json'), JSON.stringify({ version: 1, roots: [{ id: 'root:evidence', path: fixture, label: '多选测试', kind: 'sets' }] }));
const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const child = spawn(app, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'], { stdio: ['ignore', 'pipe', 'pipe'] });
const output = [];
child.stdout.on('data', d => output.push(String(d)));
child.stderr.on('data', d => output.push(String(d)));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let ws;
let seq = 0;
const pending = new Map();
async function send(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}
async function until(expr, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expr)) return; await delay(70); }
  throw new Error(`等待 ${label} 超时`);
}
async function check(name, expression) {
  const value = await evaluate(expression);
  checks.push({ name, ok: Boolean(value) });
  assert.ok(value, name);
  console.log(`✓ ${name}`);
}
async function pointer(type, x, y, modifiers = 0) {
  if (type === 'mousePressed') await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', buttons: 0, modifiers });
  await send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers });
}
async function clickCard(index, modifiers = 0) {
  const box = await evaluate(`(()=>{const b=document.querySelectorAll('.grid-card')[${index}].getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+40}})()`);
  await pointer('mousePressed', box.x, box.y, modifiers);
  await pointer('mouseReleased', box.x, box.y, modifiers);
  await delay(50);
}
async function key(key, modifiers = 0) {
  const code = key === 'c' ? 67 : key === 'Escape' ? 27 : key === 'ArrowDown' ? 40 : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, windowsVirtualKeyCode: code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(evidence, `${prefix}-${name}.png`), Buffer.from(r.data, 'base64'));
}
let error;
try {
  let target;
  for (let i = 0; i < 100; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {}
    if (target?.webSocketDebuggerUrl) break;
    await delay(100);
  }
  assert.ok(target?.webSocketDebuggerUrl, '应用未启动');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  ws.addEventListener('message', e => { const r = JSON.parse(String(e.data)); const p = pending.get(r.id); if (p) { pending.delete(r.id); if (r.error) p.reject(new Error(JSON.stringify(r.error))); else p.resolve(r.result); } });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until('Boolean(window.electronAPI && document.querySelector(".sidebar"))', '应用入口');
  await check('运行版本 4.9.0', 'navigator.userAgent.includes("/4.9.0")');
  const saved = await evaluate(`window.electronAPI.invoke('save-source-root-v1',{contractVersion:1,sourceId:null,rootPath:${JSON.stringify(album)},label:'多选验证'})`);
  assert.ok(saved.ok, JSON.stringify(saved));
  await evaluate('location.reload()');
  await until(`[...document.querySelectorAll('.sidebar-item')].some(e=>e.textContent.includes('多选验证'))`, '临时来源');
  await evaluate(`[...document.querySelectorAll('.sidebar-item')].find(e=>e.textContent.includes('多选验证')).click()`);
  await until('document.querySelectorAll(".grid-card").length>=3', '照片网格');
  await clickCard(2, 4); await clickCard(0, 4); await clickCard(1, 4);
  await check('⌘点三张高亮且不误开大图', 'document.querySelectorAll(".grid-card.selected").length===3 && !document.querySelector("[role=dialog]")');
  await shot('selected-three');
  // 这里验证同一个渲染层复制入口；macOS 原生 ⌘C 另用 CUA 在安装版检查。
  await evaluate(`window.dispatchEvent(new CustomEvent('pav:copy-selection',{cancelable:true}))`);
  await until('document.querySelector(".statusbar").textContent.includes("已复制 3 张原图")', '批量复制反馈');
  await check('网格复制入口真实调用主进程', 'document.querySelector(".statusbar").textContent.includes("已复制 3 张原图")');
  const grid = await evaluate(`(()=>{const b=document.querySelector('.folder-scroll').getBoundingClientRect();return {x:b.left+5,y:b.top+5}})()`);
  await pointer('mousePressed', grid.x, grid.y); await pointer('mouseReleased', grid.x, grid.y);
  await until('document.querySelectorAll(".grid-card.selected").length===0', '空白取消选择');
  await check('空白点击取消选择', 'document.querySelectorAll(".grid-card.selected").length===0');
  const targetPoint = await evaluate(`(()=>{const b=document.querySelectorAll('.grid-card')[2].getBoundingClientRect();return {x:b.right-2,y:b.top+70}})()`);
  await pointer('mousePressed', grid.x, grid.y);
  await pointer('mouseMoved', targetPoint.x, targetPoint.y);
  await until('document.querySelectorAll(".grid-card.selected").length===3 && !!document.querySelector(".grid-selection-box")', '框选高亮');
  await check('拖框选择三张并显示选择框', 'document.querySelectorAll(".grid-card.selected").length===3 && !!document.querySelector(".grid-selection-box")');
  await shot('marquee');
  await pointer('mouseReleased', targetPoint.x, targetPoint.y);
  await until('!document.querySelector(".grid-selection-box")', '松开选择框');
  await check('拖框松手不误开图片且保留选择', '!document.querySelector("[role=dialog]") && document.querySelectorAll(".grid-card.selected").length===3');
  await clickCard(1, 4);
  await check('⌘点取消一张', 'document.querySelectorAll(".grid-card.selected").length===2');
  await clickCard(3, 8);
  await check('Shift 按当前锚点连续选择', 'document.querySelectorAll(".grid-card.selected").length===3');
  await evaluate(`document.querySelector('.folder-scroll').scrollTo(0,5000)`);
  await until('![...document.querySelectorAll(".grid-card-name")].some(e=>e.textContent==="001.png")', '虚拟滚动移出首图');
  await check('滚动后仍保留三个选择，DOM 保持虚拟化', 'document.querySelector(".statusbar").textContent.includes("已选 3 张") && document.querySelectorAll(".grid-card").length<150');
  await evaluate(`document.querySelector('.folder-scroll').scrollTop=0`);
  await until('document.querySelectorAll(".grid-card.selected").length===3', '滚回后高亮恢复');
  await evaluate(`window.__pavEvidenceKeys=[];window.addEventListener('keydown',e=>window.__pavEvidenceKeys.push({key:e.key,code:e.code,meta:e.metaKey,shift:e.shiftKey,prevented:e.defaultPrevented}));`);
  await key('ArrowDown');
  await until('document.querySelectorAll(".grid-card.selected").length===1 && !document.querySelector(".statusbar").textContent.includes("已选")', '方向键单项导航');
  await check('方向键回到原有单项导航', 'document.querySelectorAll(".grid-card.selected").length===1 && !document.querySelector(".statusbar").textContent.includes("已选")');
  await clickCard(0);
  await until('Boolean(document.querySelector("[role=dialog]"))', '大图查看器');
  await check('普通单击仍开大图', '!!document.querySelector(".viewer-image")');
  await key('Escape');
  await until('!document.querySelector("[role=dialog]")', '关闭大图');
  // 以已有配置和真实索引进入 Cos 套内照片页。
  await evaluate(`window.electronAPI.invoke('cos-refresh')`);
  const cos = await evaluate(`window.electronAPI.invoke('cos-list-sets',{})`);
  assert.equal(cos.items?.length, 1, JSON.stringify(cos));
  await evaluate(`(()=>{const tab={history:[{kind:'cos-set',setId:${JSON.stringify(cos.items[0].id)},name:'多选测试'}],historyIndex:0};localStorage.setItem('pav.tabs.v1',JSON.stringify({tabs:[tab,tab],activeIndex:0}));location.reload()})()`);
  await until('document.querySelectorAll(".grid-card").length>=3', 'Cos 套内照片');
  await clickCard(0, 4); await clickCard(2, 4);
  await check('Cos 照片页同样支持不相邻多选', 'document.querySelectorAll(".grid-card.selected").length===2 && !document.querySelector("[role=dialog]")');
  await shot('cos-selection');
  await evaluate(`document.querySelectorAll('[role="tab"]')[1].click()`);
  await until('!document.querySelector(".statusbar").textContent.includes("已选")', '换标签清空选择');
  await check('相同套图换标签也清空多选', 'document.querySelectorAll(".grid-card.selected").length===0');
  await clickCard(0, 4); await clickCard(2, 4);
  const oldHeight = await evaluate(`document.querySelector('.folder-scroll').scrollHeight`);
  await evaluate(`document.querySelector('.folder-scroll').scrollTop=1e6`);
  await until(`document.querySelector('.folder-scroll').scrollHeight>${oldHeight}`, 'Cos 追加第二页');
  await evaluate(`document.querySelector('.folder-scroll').scrollTop=1e6`);
  await until('document.querySelector(".statusbar").textContent.includes("已选 2 张") && [...document.querySelectorAll(".grid-card-name")].some(e=>e.textContent==="150.png")', 'Cos 分页加载至第150张');
  await check('Cos 分页加载不丢选择', 'document.querySelector(".statusbar").textContent.includes("已选 2 张")');
  // 最小窗口真实渲染，不要求增加响应式布局分支。
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 480, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.folder-scroll').scrollTop=0`);
  await until('document.querySelector(".folder-scroll").clientWidth<=720', '窄窗口');
  await shot('narrow');
  await check('720×480 状态与高亮仍可见', 'document.querySelector(".statusbar").getBoundingClientRect().bottom<=480 && document.querySelectorAll(".grid-card.selected").length===2');
  await evaluate(`document.querySelector('button[aria-label*="点击改为降序"]').click()`);
  await until('!document.querySelector(".statusbar").textContent.includes("已选")', '改变排序清空');
  await check('改变排序清空多选', 'document.querySelectorAll(".grid-card.selected").length===0');
} catch (e) {
  error = e;
  console.error(e);
  if (ws?.readyState === 1) console.error(await evaluate(`({selected:document.querySelectorAll('.grid-card.selected').length,status:document.querySelector('.statusbar')?.textContent,active:document.activeElement?.tagName,keys:window.__pavEvidenceKeys,scroll:{top:document.querySelector('.folder-scroll')?.scrollTop,height:document.querySelector('.folder-scroll')?.clientHeight,total:document.querySelector('.folder-scroll')?.scrollHeight}})`).catch(() => null));
}
finally {
  const report = { at: new Date().toISOString(), app, ok: !error && checks.every(c => c.ok), passed: checks.filter(c=>c.ok).length, total: checks.length, error: error?.message || null, checks };
  fs.writeFileSync(path.join(evidence, `${prefix}-verification.json`), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(task, `${prefix}-app.log`), output.join(''));
  ws?.close();
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(fixture, { recursive: true, force: true });
  if (error) process.exitCode = 1;
}
