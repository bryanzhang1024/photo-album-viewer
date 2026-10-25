#!/usr/bin/env node
/**
 * 假入口扫描（规格 D18）：找出「画了/暴露了但没人用」的东西。
 *
 * 检查四类：
 *   1. src/ui/icons.jsx 里导出、但除自己外没人 import 的图标；
 *   2. src/common/ipc-channels.js 里定义、但 src/ui 从不调用的通道（主进程专用通道走允许清单）；
 *   3. src/ui/data/settings.js 里定义、但数据层之外没人读的设置键；
 *   4. src/ui 里 `onX?.()` 形式的可选回调，父组件从不传（靠人工允许清单压制）。
 *
 * 用法：node scripts/check-unwired.mjs [--json]
 * 退出码：发现未登记的问题时非零。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = path.join(ROOT, 'src/ui');

// 主进程专用 / 由 preload 事件监听消费，不需要渲染层 invoke 的通道
const MAIN_ONLY_CHANNELS = new Set([
  'COS_INDEX_PROGRESS',
  'COS_LIBRARY_UPDATED',
  'FAVORITES_UPDATED',
  'SCAN_NAVIGATION_PROGRESS'
]);

// 允许暂不接线的设置键（空表示全都要有消费者）
const ALLOWED_UNUSED_SETTINGS = new Set([]);

// 旧版遗留、新界面不用的 IPC 通道：保留是为了兼容旧窗口/外部调用，
// 不是「本该接线却没接线」。每条都要写理由。
const ALLOWED_LEGACY_CHANNELS = new Map([
  ['SCAN_NAVIGATION_LEVEL', '旧版整级扫描，新界面走 GET_DIRECTORY_LEVEL_V1'],
  ['VALIDATE_NAVIGATION_TARGET_V1', '旧版窗口启动时校验目标，新界面在打开前已校验'],
  ['GET_IMAGE_THUMBNAIL', '旧版按绝对路径取图，新界面用自定义协议加载缩略图'],
  ['GET_BATCH_THUMBNAILS', '旧版批量取图，新界面用自定义协议'],
  ['CANCEL_THUMBNAILS', '旧版取消请求，新界面无批量队列'],
  ['GET_ALBUM_IMAGE_COUNT', '旧版相册计数，新界面快照自带计数'],
  ['UPDATE_PERFORMANCE_SETTINGS', '旧版性能设置入口，新界面设置页未接'],
  ['CREATE_NEW_WINDOW', '旧版单窗口打开，新界面用 CREATE_NEW_INSTANCE'],
  ['GET_WINDOWS_INFO', '旧版多窗口面板，新界面无界面入口'],
  ['SCAN_DIRECTORY_TREE', '旧版递归扫描，新界面只用单层快照'],
  ['COS_GET_SET_ALBUM_PATH', '旧版 PictureView 入口，新界面用 CosSetAlbumPage'],
  ['COS_OPEN_IN_PICTUREVIEW', '旧版外部看图程序，新界面无此入口']
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function readAll(files) {
  return files.map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
}

function rel(file) {
  return path.relative(ROOT, file);
}

const problems = [];

// 1) 图标导出但没人 import
const iconsFile = path.join(UI_DIR, 'icons.jsx');
const iconsText = fs.readFileSync(iconsFile, 'utf8');
const iconNames = [...iconsText.matchAll(/export const ([A-Za-z0-9_]+Icon)\b/g)].map((m) => m[1]);
const otherFiles = readAll(walk(UI_DIR)).filter((entry) => entry.file !== iconsFile);
for (const name of iconNames) {
  const used = otherFiles.some((entry) => new RegExp(`\\b${name}\\b`).test(entry.text));
  if (!used) problems.push({ kind: 'icon', name, detail: 'icons.jsx 导出但从没被使用' });
}

// 2) IPC 通道定义但渲染层从不引用
const channelsFile = path.join(ROOT, 'src/common/ipc-channels.js');
const channelsText = fs.readFileSync(channelsFile, 'utf8');
const channelNames = [...channelsText.matchAll(/^\s{4}([A-Z0-9_]+):/gm)].map((m) => m[1]);
const uiFiles = readAll(walk(UI_DIR));
for (const name of channelNames) {
  if (MAIN_ONLY_CHANNELS.has(name)) continue;
  if (ALLOWED_LEGACY_CHANNELS.has(name)) continue;
  const usedInUi = uiFiles.some((entry) => new RegExp(`CHANNELS\\.${name}\\b`).test(entry.text)
    || new RegExp(`['"]${name.toLowerCase().replace(/_/g, '-')}['"]`).test(entry.text));
  if (!usedInUi) {
    problems.push({ kind: 'channel', name, detail: 'IPC 通道在 src/ui 里没有调用者' });
  }
}

// 3) 设置键没有消费者
const settingsFile = path.join(UI_DIR, 'data/settings.js');
const settingsText = fs.readFileSync(settingsFile, 'utf8');
const defaultBlock = settingsText.slice(
  settingsText.indexOf('DEFAULT_SETTINGS'),
  settingsText.indexOf('};', settingsText.indexOf('DEFAULT_SETTINGS'))
);
const settingKeys = [...defaultBlock.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
const settingsPage = fs.readFileSync(path.join(UI_DIR, 'features/settings/SettingsPage.jsx'), 'utf8');
for (const key of settingKeys) {
  if (ALLOWED_UNUSED_SETTINGS.has(key)) continue;
  const consumers = uiFiles.filter((entry) => (
    entry.file !== settingsFile
    && entry.file !== path.join(UI_DIR, 'features/settings/SettingsPage.jsx')
    && new RegExp(`settings\\.${key}\\b|\\.${key}\\b`).test(entry.text)
  ));
  if (consumers.length === 0) {
    problems.push({ kind: 'setting', name: key, detail: '设置键在设置页之外没有读取方' });
  }
}

// 4) 可选回调从不传参：粗扫 `on[A-Z]*?.()`，父组件文件里没有同名 prop 传值
const optionalCallbacks = new Map();
for (const entry of uiFiles) {
  for (const match of entry.text.matchAll(/\b(on[A-Z][A-Za-z0-9_]*)\?\.\(/g)) {
    const prop = match[1];
    if (!optionalCallbacks.has(prop)) optionalCallbacks.set(prop, new Set());
    optionalCallbacks.get(prop).add(entry.file);
  }
}
for (const [prop, files] of optionalCallbacks) {
  const passedSomewhere = uiFiles.some((entry) => {
    if (files.has(entry.file)) return false;
    return new RegExp(`\\b${prop}\\s*=\\s*\\{`).test(entry.text) || new RegExp(`\\b${prop}\\s*=`).test(entry.text);
  });
  if (!passedSomewhere) {
    problems.push({
      kind: 'callback',
      name: prop,
      detail: `可选回调从不传参（定义于 ${[...files].map(rel).join(', ')}）`
    });
  }
}

const json = process.argv.includes('--json');
if (json) {
  console.log(JSON.stringify({ problems, scanned: { icons: iconNames.length, channels: channelNames.length, settings: settingKeys.length } }, null, 2));
} else {
  console.log(`扫描：图标 ${iconNames.length}、IPC 通道 ${channelNames.length}、设置键 ${settingKeys.length}`);
  if (problems.length === 0) {
    console.log('✓ 没有发现未登记的「画了没人用」');
  } else {
    for (const problem of problems) {
      console.log(`✗ [${problem.kind}] ${problem.name} — ${problem.detail}`);
    }
  }
}

process.exit(problems.length === 0 ? 0 : 1);
