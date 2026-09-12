const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const CONVERTED_FORMATS = new Set(['.tif', '.tiff', '.heic', '.heif']);
const pending = new Map();

// Only derived browser previews are written; callers authorize the original path first.
async function resolveBrowserImage(source, cacheDirectory) {
  if (!CONVERTED_FORMATS.has(path.extname(source).toLowerCase())) return source;
  const stat = await fs.stat(source);
  const key = crypto.createHash('sha256').update(`${source}\0${stat.size}\0${stat.mtimeMs}`).digest('hex');
  const target = path.join(cacheDirectory, `${key}.png`);
  if (pending.has(target)) return pending.get(target);
  const task = (async () => {
    try { await fs.access(target); return target; } catch { /* cache miss */ }
    await fs.mkdir(cacheDirectory, { recursive: true });
    const temporary = `${target}.${process.pid}.tmp.png`;
    try {
      try {
        await require('sharp')(source).rotate().png().toFile(temporary);
      } catch (error) {
        if (process.platform !== 'darwin') throw error;
        await run('/usr/bin/sips', ['-s', 'format', 'png', source, '--out', temporary], { timeout: 30000 });
      }
      // Reject incomplete system conversion before publishing it.
      await require('sharp')(temporary).metadata();
      await fs.rename(temporary, target);
      return target;
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  })();
  pending.set(target, task);
  try { return await task; } finally { pending.delete(target); }
}
module.exports = { resolveBrowserImage };
