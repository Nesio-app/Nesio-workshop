/**
 * node-date-keys —— 「这件事发生的时候」只能有一个新名字。
 *
 * ## 病灶
 *
 * 同一个概念在 attributes 里有四个名字:`date`(22 处)· `occurredAt` · `takenAt`
 * · `start`(当它不表示区间时)。没有任何地方定义过哪个名字表示什么,
 * 所以每个消费者只能自己猜,猜法还各不相同。
 *
 * `nearestNodeDate()` 就是这个重叠的补丁 —— 它先查一份名单,查不到就
 * **扫遍所有字符串字段,谁能解析成日期就用谁**。注释里写得很直白:
 * 「AI 抽取有时把日期停在临时键上」。
 *
 * 而那份名单本身是错的:`due` / `deadline` / `datetime` / `scheduledAt` / `remindAt`
 * 五个**从来没出现过**(当时不确定有哪些,就把能想到的都列上了),
 * 真在用的 `occurredAt` 和 `takenAt` **反而不在里面**。
 *
 * ## 这道守卫管什么
 *
 * 存量不动 —— 老数据里的 `date`/`takenAt` 继续被认。
 * 但**不许再长第五个名字**:新代码写「事情发生的时候」只能用 `occurredAt`。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const srcRaw = read('lib/platform/node-dates.ts');
// 剥注释再取名单 —— 不剥的话文件头那段「原名单里有五个幻想的键」的说明
// 会被当成名单本身数进去(自查时正好踩到)。
const src = stripComments(srcRaw);

// ── ① 名单里不许有「幻想的」键 —— 全仓没出现过就不该在里面 ──────────────
// ⚠️ 只取 NODE_DATE_KEYS **数组体**里的字符串。扫整个文件的话,下面那行
// `CANONICAL_OCCURRED_KEY = 'occurredAt'` 也会被算进名单 —— 于是把 occurredAt
// 从数组里删掉,断言照样绿(自查反证时抓到的第二个空转)。
const arrBody = (() => {
  const at = src.indexOf('NODE_DATE_KEYS = [');
  if (at < 0) return '';
  return src.slice(at, src.indexOf(']', at));
})();
const listed = [...arrBody.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 收集所有 `attributes: { ... }` 块里出现的键。 */
function attributeKeys() {
  const keys = new Set();
  for (const f of [...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'components'))]) {
    const s = stripComments(fs.readFileSync(f, 'utf8'));
    for (const m of s.matchAll(/attributes:\s*\{/g)) {
      let i = m.index + m[0].length, depth = 1;
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
        i++;
      }
      for (const km of s.slice(m.index + m[0].length, i).matchAll(/(?:^|[{,\s])([a-zA-Z][a-zA-Z0-9_]*)\s*:/g)) {
        keys.add(km[1]);
      }
    }
  }
  return keys;
}

const inUse = attributeKeys();
const GHOST_OK = new Set(['end', 'dueDate']);   // 区间右端/截止:概念真实存在,写在别处也认

const ghosts = [...new Set(listed)].filter((k) => !inUse.has(k) && !GHOST_OK.has(k));
assert.deepEqual(
  ghosts, [],
  `NODE_DATE_KEYS 里有全仓从没出现过的键:${ghosts.join(', ')}\n`
  + '  → 名单要按**真实在用的**来。列一堆想象出来的名字,会让人以为这份名单是权威的,\n'
  + '    而真在用的键反而漏在外面(occurredAt / takenAt 就漏过)。',
);

// ── ② 真在用的时间键必须在名单里 ────────────────────────────────────────
// ⚠️ **不能**写成「在用的才检查」—— occurredAt 恰好没被 attributes 扫描器扫到,
// 那条断言就变成空转,删掉它照样绿(自查反证时抓到的)。
// 标准名和主力名是**无条件**必须在名单里的,跟当下用没用无关。
const MUST_LIST = ['occurredAt', 'date'];
const REAL_TIME_KEYS = ['takenAt', 'start'];
const missing = [
  ...MUST_LIST.filter((k) => !listed.includes(k)),
  ...REAL_TIME_KEYS.filter((k) => inUse.has(k) && !listed.includes(k)),
];
assert.deepEqual(
  missing, [],
  `这些时间键在用,但不在 NODE_DATE_KEYS 里:${missing.join(', ')}\n`
  + '  → 漏了就只能靠「扫所有字符串字段猜日期」那层兜底,而那一层会猜错。',
);

// ── ③ 标准名要声明出来,新代码才有得照着写 ──────────────────────────────
assert.match(
  srcRaw, /CANONICAL_OCCURRED_KEY = 'occurredAt'/,
  '没有声明标准名 —— 那下一个人还是不知道该用哪个,四个名字会变成五个',
);

// ── ④ 不许再造第五个名字 ────────────────────────────────────────────────
const BANNED_NEW = ['happenedAt', 'eventDate', 'when', 'atTime', 'occurAt', 'occurredOn'];
const offenders = BANNED_NEW.filter((k) => inUse.has(k));
assert.deepEqual(
  offenders, [],
  `又造了新的时间键:${offenders.join(', ')}\n  → 「事情发生的时候」只用 occurredAt。`,
);

console.log(`node-date-keys: OK(名单 ${[...new Set(listed)].length} 个键,全部真实在用 / 标准名 occurredAt 已声明)`);
