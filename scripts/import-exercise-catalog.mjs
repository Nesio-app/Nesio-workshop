#!/usr/bin/env node
/**
 * import-exercise-catalog — 把 exercises-dataset(hasaneyldrm/exercises-dataset)的
 * MIT 元数据 link 进扩展动作库。
 *
 * 只取**元数据 + 中文分步指导**(数据集 MIT 授权),
 * **不碰任何媒体**(image/gif_url 是 © Gym visual 版权,排除)。
 * 每条保留 `media` 链接键(id-mediaid),供用户把自己转好的本地动图按此命名对应上,
 * 本地动图路径约定:public/exercise-anim/catalog/<media>/fNN.webp(默认 gitignore)。
 *
 * 用法: node scripts/import-exercise-catalog.mjs <源 exercises.json> [输出路径]
 *   默认输出 public/exercise-catalog.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as pathResolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), '..');

function clean(s) { return typeof s === 'string' ? s.trim() : ''; }

function steps(entry) {
  const st = entry.instruction_steps || {};
  const zh = Array.isArray(st.zh) ? st.zh.map(clean).filter(Boolean) : [];
  if (zh.length) return zh;
  const en = Array.isArray(st.en) ? st.en.map(clean).filter(Boolean) : [];
  if (en.length) return en;
  // 退回整段
  const ins = entry.instructions || {};
  const raw = clean(ins.zh) || clean(ins.en);
  return raw ? raw.split(/(?<=[。.!?！？])\s+/).map(clean).filter(Boolean) : [];
}

/** gif_url「videos/0001-2gPfomN.gif」→ 链接键「0001-2gPfomN」。 */
function mediaKey(entry) {
  const g = clean(entry.gif_url) || clean(entry.image);
  const m = /([0-9A-Za-z_-]+)\.(gif|jpg|jpeg|png|webp|mp4)$/i.exec(g);
  if (m) return m[1];
  return entry.id && entry.media_id ? `${entry.id}-${entry.media_id}` : clean(entry.id);
}

function main() {
  const src = process.argv[2];
  if (!src) { console.error('用法: node scripts/import-exercise-catalog.mjs <源 exercises.json> [输出]'); process.exit(1); }
  const out = process.argv[3] || join(ROOT, 'public', 'exercise-catalog.json');

  const raw = JSON.parse(readFileSync(src, 'utf8'));
  if (!Array.isArray(raw)) { console.error('源不是数组'); process.exit(1); }

  const seen = new Set();
  const exercises = [];
  for (const e of raw) {
    const id = clean(e.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    exercises.push({
      id,
      name: clean(e.name),
      category: clean(e.category),
      bodyPart: clean(e.body_part),
      equipment: clean(e.equipment),
      target: clean(e.target),
      secondary: Array.isArray(e.secondary_muscles) ? e.secondary_muscles.map(clean).filter(Boolean) : [],
      muscleGroup: clean(e.muscle_group),
      media: mediaKey(e),          // 链接键:对应本地动图目录,媒体本身不含
      cues: steps(e),              // 中文分步(缺则英文)
    });
  }

  const doc = {
    source: 'hasaneyldrm/exercises-dataset',
    dataLicense: 'MIT (© Hasan Emir Yıldırım) — metadata & instructions only',
    mediaNote: '媒体(图/GIF/视频)© Gym visual,未包含;本地动图用 media 键对应 public/exercise-anim/catalog/<media>/',
    count: exercises.length,
    exercises,
  };
  writeFileSync(out, JSON.stringify(doc));
  console.log(`✅ 导出 ${exercises.length} 条 → ${out}`);
  const zhCount = exercises.filter((x) => x.cues.length && /[一-鿿]/.test(x.cues[0])).length;
  console.log(`   含中文分步: ${zhCount}/${exercises.length};大小 ${(JSON.stringify(doc).length / 1024 / 1024).toFixed(2)} MB`);
}

main();
