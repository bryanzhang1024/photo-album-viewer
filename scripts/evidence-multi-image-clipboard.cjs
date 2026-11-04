#!/usr/bin/env node
// 用真实主进程 handler、preload、系统剪贴板和 Chromium paste 事件检查文件列表。
// PAV_EVID_TEMP 必须是 agent-tmp 分配的任务目录；不启动日用 profile。
const { app, BrowserWindow, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const task = process.env.PAV_EVID_TEMP;
if (!task || !path.isAbsolute(task)) throw new Error('PAV_EVID_TEMP is required');
const images = path.join(task, 'clipboard-images');
fs.mkdirSync(images, { recursive: true });
app.setPath('userData', path.join(task, 'clipboard-profile'));
process.env.PAV_TEST_APPROVED_ROOTS = fs.realpathSync(images);
// 只抑制日用窗口启动，不替换待测 IPC handler 或任何剪贴板 API。
const ready = app.whenReady.bind(app);
app.whenReady = () => new Promise(() => {});
require(path.join(root, 'src/main/main.js'));
app.whenReady = ready;

ready().then(async () => {
  const sharp = require('sharp');
  const names = ['中文 3.png', 'a&b<2>.png', '1.png'];
  const colors = ['#e63946', '#457b9d', '#2a9d8f'];
  const files = names.map(name => path.join(images, name));
  for (let i = 0; i < files.length; i++) {
    await sharp({ create: { width: 40, height: 60, channels: 3, background: colors[i] } }).png().toFile(files[i]);
  }
  const win = new BrowserWindow({ show: true, width: 500, height: 300, webPreferences: { preload: path.join(root, 'src/main/preload.js'), contextIsolation: true, nodeIntegration: false } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body><div id="receiver" contenteditable="true">Paste receiver</div><script>
    window.pasted = null;
    document.addEventListener('paste', async e => {
      e.preventDefault();
      window.pasted = await Promise.all(Array.from(e.clipboardData.files).map(async f => ({name:f.name,type:f.type,size:f.size,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))})));
    });
    </script></body>`));
  const result = await win.webContents.executeJavaScript(`window.electronAPI.invoke('copy-images-to-clipboard', ${JSON.stringify(files)})`);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.count, 3);
  const xml = clipboard.readBuffer('NSFilenamesPboardType').toString('utf8');
  assert.equal((xml.match(/<string>/g) || []).length, 3);
  win.focus();
  await win.webContents.executeJavaScript(`document.querySelector('#receiver').focus()`);
  win.webContents.paste();
  const pasted = await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+5000;const timer=setInterval(()=>{if(window.pasted!==null){clearInterval(timer);resolve(window.pasted)}else if(Date.now()>end){clearInterval(timer);reject(new Error('paste timeout'))}},30)})`);
  assert.deepEqual(pasted.map(f => f.name), names);
  const sha = data => crypto.createHash('sha256').update(data).digest('hex');
  const checked = pasted.map((f, i) => {
    const hash = sha(Buffer.from(f.bytes));
    assert.equal(hash, sha(fs.readFileSync(files[i])));
    return { name: f.name, type: f.type, size: f.size, sha256: hash };
  });
  const evidence = path.join(root, '.3things/acceptance/evidence/multi-image-copy');
  fs.mkdirSync(evidence, { recursive: true });
  const report = { at: new Date().toISOString(), electron: process.versions.electron, success: true, checks: ['real IPC/preload', 'system pasteboard three paths', 'Chromium real paste three ordered files', 'original bytes unchanged'], files: checked };
  fs.writeFileSync(path.join(evidence, 'clipboard.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  // 仅在剪贴板仍是本次测试数据时清理，避免覆盖中途用户的新复制内容。
  if (clipboard.readBuffer('NSFilenamesPboardType').toString('utf8') === xml) clipboard.clear();
  win.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
