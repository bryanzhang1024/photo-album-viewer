/* eslint-disable no-console */
/**
 * 验证：图片文件头闸门
 *
 * 运行: npx electron scripts/verify-image-header-gate.js
 *
 * 两件必须同时成立的事：
 *   1. 真图不能被误杀 —— 对真实图库抽样，全部应通过闸门
 *   2. 非图片必须被挡住 —— 被改名的文本文件不能产出缩略图，更不能写进缓存
 *
 * 只读源图；测试用假文件写在系统临时目录。
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_DIR = path.join(os.tmpdir(), 'thumb-header-gate-verify');
const WORK = path.join(BASE_DIR, 'fixtures');
app.setPath('userData', BASE_DIR);

const LIST = process.env.BENCH_LIST || '/tmp/thumb-bench-sample.txt';
const RES = 600;
const HEIGHT = Math.round(RES * 1.5);
const N_REAL = Number(process.env.GATE_N_REAL || 60);

const PASS = [];
const FAIL = [];

function check(name, condition, detail) {
  if (condition) {
    PASS.push(name);
    console.log(`  ✓ ${name}${detail ? `  ${detail}` : ''}`);
  } else {
    FAIL.push(name);
    console.log(`  ✗ ${name}${detail ? `  ${detail}` : ''}`);
  }
}

const section = (title) => console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`);

async function main() {
  const samples = fs
    .readFileSync(LIST, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter((f) => f && fs.existsSync(f));

  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  // 制造「扩展名是图片、内容不是图片」的文件
  const fixtures = {
    fakeJpg: path.join(WORK, 'renamed.jpg'),
    fakePng: path.join(WORK, 'renamed.png'),
    fakeHeic: path.join(WORK, 'renamed.heic'),
    textFile: path.join(WORK, 'notes.txt'),
    emptyFile: path.join(WORK, 'empty.jpg')
  };
  const garbage = Buffer.from('这不是图片，只是被改名的纯文本内容。'.repeat(50), 'utf8');
  fs.writeFileSync(fixtures.fakeJpg, garbage);
  fs.writeFileSync(fixtures.fakePng, garbage);
  fs.writeFileSync(fixtures.fakeHeic, garbage);
  fs.writeFileSync(fixtures.textFile, 'plain text\n');
  fs.writeFileSync(fixtures.emptyFile, Buffer.alloc(0));

  // eslint-disable-next-line global-require
  const ThumbnailService = require('../src/main/services/ThumbnailService');
  const service = ThumbnailService.thumbnailService;
  const { looksLikeImageHeader } = ThumbnailService;

  console.log(`样本 ${samples.length} 张   真实图库抽样 ${N_REAL} 张`);

  // ── 1：真图不能误杀 ──────────────────────────────────────
  section('1. 真实图库抽样全部通过闸门（不误杀）');
  const realSample = samples.slice(0, N_REAL);
  const rejected = [];
  for (const file of realSample) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await service.isDecodableImageSource(file);
    if (!ok) rejected.push(file);
  }
  check(
    `真实图片全部通过文件头检查（${N_REAL} 张）`,
    rejected.length === 0,
    rejected.length ? `被误判 ${rejected.length} 张：${rejected.slice(0, 3).map((f) => path.basename(f)).join(', ')}` : ''
  );

  // 顺带覆盖后缀多样性：库里的 .jfif / .png 等也应通过
  const byExt = new Map();
  for (const file of realSample) {
    const ext = path.extname(file).toLowerCase();
    if (!byExt.has(ext)) byExt.set(ext, file);
  }
  const extResults = [];
  for (const [ext, file] of byExt) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await service.isDecodableImageSource(file);
    extResults.push(`${ext}:${ok ? 'ok' : 'REJECT'}`);
  }
  console.log(`  后缀覆盖  ${extResults.join('  ')}`);

  // ── 2：非图片必须被挡住 ──────────────────────────────────
  section('2. 非图片文件被闸门挡住（不产缩略图、不写缓存）');
  const fakeResults = {};
  for (const [name, file] of Object.entries(fixtures)) {
    // eslint-disable-next-line no-await-in-loop
    const url = await service.generateThumbnail(file, RES, HEIGHT, 0);
    const webp = service.generateCacheFilename(file, RES, HEIGHT, 'webp');
    const png = service.generateCacheFilename(file, RES, HEIGHT, 'png');
    fakeResults[name] = {
      url,
      wroteWebp: fs.existsSync(webp),
      wrotePng: fs.existsSync(png)
    };
    console.log(
      `  ${name.padEnd(10)} 结果=${url === null ? 'null' : '有缩略图'}  webp落盘=${fakeResults[name].wroteWebp}  png落盘=${fakeResults[name].wrotePng}`
    );
  }

  check(
    '改名 .jpg 不产出缩略图',
    fakeResults.fakeJpg.url === null && !fakeResults.fakeJpg.wroteWebp && !fakeResults.fakeJpg.wrotePng
  );
  check(
    '改名 .png 不产出缩略图',
    fakeResults.fakePng.url === null && !fakeResults.fakePng.wroteWebp && !fakeResults.fakePng.wrotePng
  );
  check(
    '改名 .heic 不产出缩略图',
    fakeResults.fakeHeic.url === null && !fakeResults.fakeHeic.wroteWebp && !fakeResults.fakeHeic.wrotePng
  );
  check('纯文本不产出缩略图', fakeResults.textFile.url === null && !fakeResults.textFile.wroteWebp);
  check('空文件不产出缩略图', fakeResults.emptyFile.url === null && !fakeResults.emptyFile.wroteWebp);

  const skipped = service.getRuntimeStats().nonImageFallbacksSkipped;
  check('闸门计数已记录', skipped >= Object.keys(fixtures).length, `nonImageFallbacksSkipped=${skipped}`);

  // ── 3：真图仍能正常生成 ──────────────────────────────────
  section('3. 真图仍能正常生成缩略图（闸门不放宽也不过度收紧）');
  const realFile = realSample[0];
  const realUrl = await service.generateThumbnail(realFile, RES, HEIGHT, 0);
  check('真图产出缩略图', typeof realUrl === 'string', `${realUrl === null ? 'null' : 'ok'}`);
  const realWebp = service.generateCacheFilename(realFile, RES, HEIGHT, 'webp');
  check('真图确实落盘', fs.existsSync(realWebp), `${fs.existsSync(realWebp) ? (fs.statSync(realWebp).size / 1024).toFixed(0) + 'KB' : '无文件'}`);

  // ── 4：现有缓存无污染 ────────────────────────────────────
  section('4. 用户现有缩略图缓存的污染现状');
  const userCache = path.join(os.homedir(), 'Library', 'Application Support', 'photo-album-viewer', 'thumbnail-cache');
  if (fs.existsSync(userCache)) {
    const entries = fs.readdirSync(userCache);
    const pngCount = entries.filter((f) => f.endsWith('.png')).length;
    console.log(`  条目 ${entries.length}：webp ${entries.filter((f) => f.endsWith('.webp')).length}，png ${pngCount}`);
    check(
      '缓存中没有原生回退产物（.png）说明尚未被污染',
      pngCount === 0,
      pngCount === 0 ? '0 个 .png' : `${pngCount} 个 .png 需清理`
    );
  } else {
    console.log('  用户缓存目录不存在，跳过');
  }

  // ── 5：闸门函数本身的边界 ────────────────────────────────
  section('5. 闸门边界');
  const cases = [
    ['JPEG 头', Buffer.from([0xff, 0xd8, 0xff]), true],
    ['HEIC 头', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic')]), true],
    ['mp4 头', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42')]), false],
    ['纯文本', Buffer.from('hello'), false],
    ['空', Buffer.alloc(0), false]
  ];
  let boundaryOk = true;
  for (const [label, buffer, expected] of cases) {
    const actual = looksLikeImageHeader(buffer);
    if (actual !== expected) {
      boundaryOk = false;
      console.log(`  ✗ ${label} 期望 ${expected} 实际 ${actual}`);
    } else {
      console.log(`  ✓ ${label} → ${actual}`);
    }
  }
  check('闸门边界判定符合预期', boundaryOk);

  section('结果');
  console.log(`  通过 ${PASS.length}   失败 ${FAIL.length}`);
  FAIL.forEach((name) => console.log(`  ✗ ${name}`));
  console.log(FAIL.length === 0 ? '\n全部通过。' : '\n存在失败项。');

  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  return FAIL.length;
}

app.whenReady()
  .then(main)
  .then((failed) => app.exit(failed === 0 ? 0 : 1))
  .catch((error) => {
    console.error('\n验证脚本异常:', error);
    app.exit(2);
  });
