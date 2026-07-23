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

// ── 英文动作名 → 中文(术语词典 + 贪心最长匹配) ──
// 动作名是组合式(器械+修饰+部位+动作),按术语拼接即可得可读中文名。
const TERMS = [
  ['body weight', '徒手'], ['bodyweight', '徒手'], ['ez barbell', 'EZ 杠'], ['ez bar', 'EZ 杠'],
  ['smith machine', '史密斯机'], ['leverage machine', '器械'], ['sled machine', '雪橇机'],
  ['medicine ball', '药球'], ['stability ball', '稳定球'], ['bosu ball', 'BOSU 球'], ['resistance band', '阻力带'],
  ['barbell', '杠铃'], ['dumbbell', '哑铃'], ['kettlebell', '壶铃'], ['cable', '绳索'], ['band', '弹力带'],
  ['machine', '器械'], ['weighted', '负重'], ['assisted', '辅助'], ['roller', '滚轮'], ['wheel', '健腹轮'], ['sled', '雪橇'],
  ['bent over', '俯身'], ['bent-over', '俯身'], ['single leg', '单腿'], ['single-leg', '单腿'],
  ['one arm', '单臂'], ['single arm', '单臂'], ['one-arm', '单臂'], ['incline', '上斜'], ['decline', '下斜'],
  ['seated', '坐姿'], ['standing', '站姿'], ['lying', '仰卧'], ['prone', '俯卧'], ['kneeling', '跪姿'], ['hanging', '悬垂'],
  ['alternating', '交替'], ['alternate', '交替'], ['reverse', '反向'], ['overhead', '过顶'],
  ['wide grip', '宽握'], ['close grip', '窄握'], ['underhand', '反握'], ['neutral grip', '中立握'],
  ['rear delt', '后束'], ['front', '前'], ['rear', '后'], ['lateral', '侧'], ['side', '侧'], ['half', '半'],
  ['triceps', '三头'], ['tricep', '三头'], ['biceps', '二头'], ['bicep', '二头'], ['shoulders', '肩'], ['shoulder', '肩'],
  ['chest', '胸'], ['glutes', '臀'], ['glute', '臀'], ['calves', '小腿'], ['calf', '小腿'],
  ['hamstrings', '腘绳'], ['hamstring', '腘绳'], ['quads', '股四头'], ['quad', '股四头'], ['forearms', '前臂'], ['forearm', '前臂'],
  ['obliques', '腹斜肌'], ['oblique', '腹斜肌'], ['abs', '腹'], ['abdominal', '腹'], ['lats', '背阔'], ['lat', '背阔'],
  ['traps', '斜方肌'], ['trap', '斜方肌'], ['hips', '髋'], ['hip', '髋'], ['thigh', '大腿'], ['legs', '腿'], ['leg', '腿'],
  ['arms', '臂'], ['arm', '臂'], ['back', '背'], ['neck', '颈'], ['wrist', '手腕'], ['ankle', '踝'], ['knee', '膝'],
  ['romanian deadlift', '罗马尼亚硬拉'], ['sumo deadlift', '相扑硬拉'], ['stiff leg deadlift', '直腿硬拉'],
  ['good morning', '早安式'], ['mountain climber', '登山者'], ['jumping jack', '开合跳'],
  ['lateral raise', '侧平举'], ['front raise', '前平举'], ['leg raise', '举腿'], ['leg press', '腿举'],
  ['leg curl', '腿弯举'], ['leg extension', '腿屈伸'], ['calf raise', '提踵'], ['step up', '登阶'], ['step-up', '登阶'],
  ['hip thrust', '臀推'], ['push up', '俯卧撑'], ['push-up', '俯卧撑'], ['pushup', '俯卧撑'],
  ['pull up', '引体向上'], ['pull-up', '引体向上'], ['pullup', '引体向上'], ['chin up', '引体'], ['chin-up', '引体'],
  ['sit up', '仰卧起坐'], ['sit-up', '仰卧起坐'], ['situp', '仰卧起坐'], ['pull down', '下拉'], ['pulldown', '下拉'],
  ['pull-down', '下拉'], ['pullover', '上拉'], ['pull through', '拉过'], ['face pull', '面拉'], ['upright row', '直立划船'],
  ['skull crusher', '仰卧臂屈伸'], ['bench press', '卧推'], ['military press', '军推'], ['overhead press', '过顶推举'],
  ['push press', '借力推'], ['shoulder press', '肩推'], ['chest press', '胸推'], ['squat', '深蹲'], ['lunge', '箭步蹲'],
  ['deadlift', '硬拉'], ['press', '推举'], ['row', '划船'], ['curl', '弯举'], ['extension', '伸展'], ['fly', '飞鸟'],
  ['flye', '飞鸟'], ['raise', '举'], ['crunch', '卷腹'], ['bridge', '臀桥'], ['plank', '平板支撑'], ['dip', '臂屈伸'],
  ['shrug', '耸肩'], ['kickback', '后踢'], ['twist', '转体'], ['thruster', '推举深蹲'], ['thrust', '推'], ['swing', '摆动'],
  ['clean', '翻'], ['snatch', '抓举'], ['jerk', '挺举'], ['burpee', '波比'], ['hold', '保持'], ['march', '高抬腿'],
  ['crossover', '交叉'], ['pushdown', '下压'], ['pull', '拉'], ['push', '推'], ['rotation', '旋转'], ['circle', '绕环'],
  ['stretch', '拉伸'], ['walk', '行走'], ['jump', '跳'], ['run', '跑'], ['wide', '宽'], ['close', '窄'], ['high', '高'], ['low', '低'],
  // 补充常见词 + 连接词(映射到 '' = 丢弃)
  ['hammer', '锤式'], ['floor', '地面'], ['bench', '长凳'], ['wall', '墙'], ['chair', '椅'], ['ball', '球'],
  ['grip', '握'], ['straight', '直'], ['toe', '脚尖'], ['toes', '脚尖'], ['heel', '脚跟'], ['bent', '弯'],
  ['twisting', '转体'], ['rotating', '旋转'], ['squeeze', '夹'], ['raises', '举'], ['curls', '弯举'], ['rows', '划船'],
  ['presses', '推举'], ['extensions', '伸展'], ['lunges', '箭步蹲'], ['squats', '深蹲'], ['deadlifts', '硬拉'],
  ['pulses', '小幅', ], ['isometric', '静力'], ['iso', '静力'], ['static', '静态'], ['dynamic', '动态'],
  ['with', ''], ['on', ''], ['the', ''], ['to', ''], ['and', ''], ['of', ''], ['a', ''], ['in', ''], ['for', ''], ['your', ''],
  ['bend', '体侧屈'], ['female', ''], ['male', ''], ['plyo', '爆发式'], ['plyometric', '爆发式'], ['version', ''],
  ['self', ''], ['assisted', '辅助'], ['using', ''], ['band', '弹力带'], ['both', ''], ['one', '单'], ['two', '双'],
  ['legs', '腿'], ['arms', '臂'], ['up', ''], ['down', ''], ['inner', '内侧'], ['outer', '外侧'], ['upper', '上'], ['lower', '下'],
  ['flexion', '屈'], ['abduction', '外展'], ['adduction', '内收'], ['drag', '拖曳'], ['spider', '蜘蛛'], ['preacher', '牧师'],
  ['concentration', '集中'], ['zottman', '佐特曼'], ['arnold', '阿诺德'], ['hack', '哈克'], ['pistol', '手枪'], ['goblet', '高脚杯'],
];
const MAP = new Map(TERMS.map(([en, zh]) => [en, zh]));

function translateName(en) {
  const words = en.toLowerCase().replace(/[^a-z0-9/ -]/g, ' ').split(/\s+/).filter(Boolean);
  const zh = [];
  let i = 0; let translated = 0; let total = 0;
  while (i < words.length) {
    let matched = null; let adv = 1;
    for (let len = Math.min(3, words.length - i); len >= 1; len--) {
      const hit = MAP.get(words.slice(i, i + len).join(' '));
      if (hit !== undefined) { matched = hit; adv = len; break; }
    }
    total += 1;
    if (matched != null) { if (matched) zh.push(matched); translated += 1; } else { zh.push(words[i]); }
    i += adv;
  }
  // 半数以上术语翻出 → 用中文名;否则保留英文(避免半英半中乱码)。
  return total > 0 && translated / total >= 0.5 ? zh.join('') : en;
}

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
      nameZh: translateName(clean(e.name)),
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
