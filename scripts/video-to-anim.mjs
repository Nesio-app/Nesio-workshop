#!/usr/bin/env node
/**
 * video-to-anim — 动作视频 → 定格动图帧。
 *
 * 从一段动作视频里均匀抽 N 帧、缩放、存成 public/exercise-anim/<id>/fNN.webp,
 * 供 <ExerciseFigure> 步进循环播放。把「平滑视频」工程化成「轻量定格循环」。
 *
 * 用法:
 *   node scripts/video-to-anim.mjs <video> <exercise-id> [选项]
 *   选项:
 *     --frames N     抽帧数(默认 12)
 *     --fps N        建议播放帧率,写进提示(默认 8)
 *     --width N      帧宽像素(默认 480)
 *     --pingpong     建议乒乓来回(写进提示)
 *     --license L    版权归属: own | public-domain | licensed(默认 licensed)
 *                    own/public-domain → 放行进 git;
 *                    licensed(如 Gym visual 等第三方版权)→ 自动 gitignore,只留本地。
 *
 * ffmpeg 解析顺序: $FFMPEG_PATH → PATH 上的 ffmpeg。找不到会给出安装提示。
 *
 * ⚠️ 第三方版权媒体(licensed)默认不进 git —— 往 GitHub 推 = 再分发,可能侵权。
 *    脚本会把该动作目录写进 public/exercise-anim/.gitignore 的忽略区,本地照常可用。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve as pathResolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANIM_ROOT = join(ROOT, 'public', 'exercise-anim');
const GITIGNORE = join(ANIM_ROOT, '.gitignore');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function findFfmpeg() {
  const cand = process.env.FFMPEG_PATH || 'ffmpeg';
  try { execFileSync(cand, ['-version'], { stdio: 'ignore' }); return cand; } catch { /* fall through */ }
  console.error('找不到 ffmpeg。请装 ffmpeg,或用 FFMPEG_PATH=/path/to/ffmpeg 指定。');
  process.exit(1);
}

function probeDuration(ffmpeg, video) {
  try { execFileSync(ffmpeg, ['-i', video], { stdio: ['ignore', 'ignore', 'pipe'] }); }
  catch (e) {
    const s = String(e.stderr || '');
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  }
  return 0;
}

/** own/public-domain 放行进 git;licensed 写进忽略区。 */
function updateGitignore(id, license) {
  const header = '# 动作定格帧目录。第三方版权媒体(licensed)默认忽略——推 GitHub = 再分发,可能侵权。\n'
    + '# 自有/公共领域动图用 `!<id>/` 显式放行。\n';
  let lines = existsSync(GITIGNORE)
    ? readFileSync(GITIGNORE, 'utf8').split('\n')
    : [header.trimEnd(), '*/', '!.gitignore'];
  lines = lines.filter((l) => l.trim() !== `!${id}/`); // 先移除旧放行
  if (license === 'own' || license === 'public-domain') {
    lines.push(`!${id}/`); // 放行进 git
  }
  writeFileSync(GITIGNORE, `${lines.join('\n').replace(/\n+$/, '')}\n`);
}

function main() {
  const [video, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!video || !id) {
    console.error('用法: node scripts/video-to-anim.mjs <video> <exercise-id> [--frames 12] [--fps 8] [--width 480] [--license own|public-domain|licensed]');
    process.exit(1);
  }
  if (!existsSync(video)) { console.error(`视频不存在: ${video}`); process.exit(1); }

  const frames = Math.max(2, Math.min(48, parseInt(arg('frames', '12'), 10) || 12));
  const fps = parseInt(arg('fps', '8'), 10) || 8;
  const width = parseInt(arg('width', '480'), 10) || 480;
  const pingpong = arg('pingpong', false) === true;
  const license = String(arg('license', 'licensed'));

  const ffmpeg = findFfmpeg();
  const dur = probeDuration(ffmpeg, video);
  if (!dur) { console.error('读不到视频时长,无法均匀抽帧。'); process.exit(1); }

  const outDir = join(ANIM_ROOT, id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // 均匀抽 N 帧:输出帧率 = frames / 时长;缩放到目标宽;webp 输出。
  const rate = frames / dur;
  const vf = `fps=${rate.toFixed(6)},scale=${width}:-2`;
  try {
    execFileSync(ffmpeg, [
      '-y', '-i', video, '-vf', vf, '-frames:v', String(frames),
      '-c:v', 'libwebp', '-lossless', '0', '-q:v', '80', '-compression_level', '6',
      '-start_number', '0', join(outDir, 'f%02d.webp'),
    ], { stdio: ['ignore', 'ignore', 'ignore'] });
  } catch (e) {
    console.error('抽帧失败(可能该 ffmpeg 不含 libwebp)。stderr:\n', String(e.stderr || e.message).slice(-800));
    process.exit(1);
  }

  const got = readdirSync(outDir).filter((f) => /^f\d+\.webp$/.test(f)).length;
  if (got < 2) { console.error(`只抽到 ${got} 帧,失败。`); process.exit(1); }

  updateGitignore(id, license);
  const tracked = license === 'own' || license === 'public-domain';

  console.log(`\n✅ ${id}: 抽出 ${got} 帧 → public/exercise-anim/${id}/`);
  console.log(`   授权=${license} → ${tracked ? '进 git(已在 .gitignore 放行)' : '本地保留,不进 git(第三方版权,推 GitHub 会侵权)'}`);
  console.log('\n把下面这段填进 lib/portal/exercise-library.ts 该动作对象:');
  console.log(`    anim: { frames: ${got}, fps: ${fps}${pingpong ? ', pingpong: true' : ''} },\n`);
}

main();
