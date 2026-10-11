/* eslint-disable no-console */
/**
 * 探针：在真实 BrowserWindow 上下文里核实 app.getFileIcon 的行为
 *
 * 运行: npx electron scripts/probe-file-icon.js
 *
 * 背景：此前在无 BrowserWindow 的脚本进程里观测到 app.getFileIcon 返回
 * 0x0 空图并触发 Chromium `Check failed: NOTREACHED`，导致
 * isSystemFileIcon 恒返回 false。需要确认那是否只是无窗口上下文的产物。
 *
 * 同时确认：对「扩展名是图片但内容不是图片」的文件，原生缩略图与文件图标
 * 是否无法区分 —— 这决定第 4 步该怎么重写判定。
 *
 * 只读源图；测试用的假图片写在临时目录。
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const WORK = path.join(os.tmpdir(), 'probe-file-icon');

const OUT = [];
function log(line) {
  console.log(line);
  OUT.push(line);
}

async function timed(label, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    const elapsed = Date.now() - startedAt;
    let desc = '';
    if (value && typeof value.getSize === 'function') {
      const size = value.getSize();
      const empty = typeof value.isEmpty === 'function' ? value.isEmpty() : null;
      desc = `尺寸=${size.width}x${size.height} isEmpty=${empty}`;
      if (!empty && size.width > 0) {
        const bmp = value.toBitmap();
        desc += ` bitmap=${bmp.length}B md5=${crypto.createHash('md5').update(bmp).digest('hex').slice(0, 12)}`;
      }
    } else {
      desc = `返回=${value === null ? 'null' : typeof value}`;
    }
    log(`  ok   ${String(elapsed).padStart(6)}ms  ${label.padEnd(46)} ${desc}`);
    return value;
  } catch (error) {
    log(`  FAIL ${String(Date.now() - startedAt).padStart(6)}ms  ${label.padEnd(46)} ${error.message}`);
    return null;
  }
}

function setupFixtures() {
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  const samples = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));

  const fixtures = {
    realJpeg: samples[0],
    realJpeg2: samples[1],
    // 扩展名是图片、内容不是图片
    fakeJpeg: path.join(WORK, 'fake-image.jpg'),
    fakePng: path.join(WORK, 'fake-image.png'),
    // 真文本文件
    textFile: path.join(WORK, 'notes.txt'),
    // 无扩展名
    noExt: path.join(WORK, 'barefile')
  };

  const garbage = Buffer.from('这不是图片，只是一段纯文本。'.repeat(200), 'utf8');
  fs.writeFileSync(fixtures.fakeJpeg, garbage);
  fs.writeFileSync(fixtures.fakePng, garbage);
  fs.writeFileSync(fixtures.textFile, 'plain text\n');
  fs.writeFileSync(fixtures.noExt, 'plain text\n');

  return fixtures;
}

async function main() {
  const fixtures = setupFixtures();

  // 关键：必须有真实 BrowserWindow
  const win = new BrowserWindow({ show: false, width: 480, height: 320 });
  await win.loadURL('about:blank');
  log(`BrowserWindow 已创建，可见=${win.isVisible()}`);

  log('\n─── A. 无窗口上下文对照（复现此前的观测）───');
  // 这个顺序无法真正回到无窗口状态，故此处只记录当前上下文的结果，
  // 真正的对照在 3.8.4 之前的脚本进程里已经做过。

  log('\n─── B. app.getFileIcon（有 BrowserWindow）───');
  for (const [name, file] of Object.entries(fixtures)) {
    // eslint-disable-next-line no-await-in-loop
    await timed(`getFileIcon large  ${name}`, () => app.getFileIcon(file, { size: 'large' }));
  }

  log('\n─── C. nativeImage.createThumbnailFromPath 600px ───');
  const thumbs = {};
  for (const [name, file] of Object.entries(fixtures)) {
    // eslint-disable-next-line no-await-in-loop
    thumbs[name] = await timed(`createThumbnail ${name}`, () =>
      nativeImage.createThumbnailFromPath(file, { width: 600, height: 600 })
    );
  }

  log('\n─── D. 关键问题：真图缩略图 vs 假图产物能否区分 ───');
  const fingerprint = (img) => {
    if (!img || img.isEmpty()) return null;
    const size = img.getSize();
    const bmp = img.toBitmap();
    return {
      size: `${size.width}x${size.height}`,
      md5: crypto.createHash('md5').update(bmp).digest('hex').slice(0, 16),
      bytes: bmp.length
    };
  };

  const real = fingerprint(thumbs.realJpeg);
  const fake = fingerprint(thumbs.fakeJpeg);
  const fakePng = fingerprint(thumbs.fakePng);
  const text = fingerprint(thumbs.textFile);

  log(`  真 JPEG 缩略图      ${JSON.stringify(real)}`);
  log(`  假 .jpg 缩略图      ${JSON.stringify(fake)}`);
  log(`  假 .png 缩略图      ${JSON.stringify(fakePng)}`);
  log(`  文本文件缩略图      ${JSON.stringify(text)}`);

  if (fake && real) {
    log(`\n  假 .jpg 与真图的位图相同？ ${fake.md5 === real.md5}`);
  }
  if (fake && fakePng) {
    log(`  假 .jpg 与假 .png 的位图相同？ ${fake.md5 === fakePng.md5}`);
  }
  if (fake && text) {
    log(`  假 .jpg 与真 .txt 的位图相同？ ${fake.md5 === text.md5}`);
  }

  // 与 getFileIcon 直接对比（现有实现的做法）
  log('\n─── E. 现有判定逻辑是否可用 ───');
  const iconForFake = await app.getFileIcon(fixtures.fakeJpeg, { size: 'large' });
  if (!iconForFake || iconForFake.isEmpty()) {
    log('  getFileIcon 返回空图 → 现有 isSystemFileIcon 会直接判「不是图标」，判定失效');
  } else {
    log(`  getFileIcon 返回 ${iconForFake.getSize().width}x${iconForFake.getSize().height}，可做位图比对`);
  }

  const probeFile = path.join(WORK, 'probe-result.txt');
  fs.writeFileSync(probeFile, OUT.join('\n'), 'utf8');
  log(`\n结果已写入 ${probeFile}`);

  win.destroy();
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error('探针异常:', error);
    app.exit(1);
  });
