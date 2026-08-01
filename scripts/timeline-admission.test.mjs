/**
 * 行为契约:什么东西有资格占今天的时间线(2026-07-30 真机实锤)。
 *
 * 截图里时间线上出现了「摇椅盖毯」和「灰色高领毛衣」,还都标着「明天」。
 * 两个源头,都是同一族的病 —— 没有正向判据,「凡是没被拦住的就算数」:
 *
 *   ① FocusSection 的 rawTaskNodes 是**反向**过滤:只排掉「划掉的 / 做完的 /
 *      没钉今天的 event」,剩下一切节点都能占今天。拍一张毯子就成了今天要紧的事。
 *   ② focusTimeHint 的时标兜底是**子串猜测**:文本里出现「明天」就说明天,
 *      而它前面用的 nearestNodeDate 会扫描**全部属性值**,任何 ad-hoc 键上
 *      能被 Date 解析的字符串都冒充成日期 —— 物品节点因此长出了假「明天」。
 *
 * 这和「GitHub 邮件标题里的『健身』被认成健康打卡」是同一件事的两个化身,
 * 所以钉死判据本身,而不是钉某个变量名。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** 去注释 —— 免得「注释里写了」被当成「代码里做了」。 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const focus = code(read('components/portal/today/FocusSection.tsx'));
const vm = code(read('lib/platform/view-models/today-view-model.ts'));

// ── ① 进时间线必须走正向判据 ──
{
  assert.match(
    focus, /qualifiesForTimeline/,
    '时间线准入必须是一条**正向**判据(哪些够格进),不能只靠排除法 —— ' +
    '排除法等于「凡是没被拦住的都算数」,一张毯子的照片就会变成今天要紧的事',
  );
  // 正向判据的四条要件都在
  assert.match(focus, /focusPinnedOn === todayKey/, '① 用户自己钉到今天的必须放行');
  assert.match(focus, /n\.type === 'task'/, '② 承诺/待办类型够格');
  assert.match(focus, /firstNodeDate\(n\.attributes\)/, '③ 带**明确日期键**的够格');
  assert.match(focus, /nodeExpiryDate\(n\.attributes\)/, '④ 快到期的够格(到期本身就是今天的事)');

  // 用 firstNodeDate 而不是 nearestNodeDate —— 后者扫全部属性值,会把杂字段认成日期
  assert.doesNotMatch(
    focus, /nearestNodeDate\(/,
    '时间线准入不许用 nearestNodeDate —— 它扫描全部属性值,' +
    'ad-hoc 键上任何能被 Date 解析的字符串都会冒充成日期',
  );
}

// ── ② 时标不许靠文本子串猜 ──
{
  const hint = vm.slice(vm.indexOf('export function focusTimeHint'));
  const body = hint.slice(0, hint.indexOf('\n}\n') + 1);
  for (const word of ['今天', '今日', '明天', '明日']) {
    // 引号形式不限(单/双/反引号),也不限 includes —— indexOf / 正则 / match 一样是猜。
    assert.ok(
      !new RegExp(`(includes|indexOf|match|test|search)\\s*\\(\\s*[/'"\`][^)]*${word}`).test(body),
      `focusTimeHint 不许用「文本里出现『${word}』就当它是那天」的子串猜测 —— ` +
      '「明天要还的钱」和「明天见」在字面上没有区别,它会把两者都标成明天',
    );
  }
  assert.match(body, /firstNodeDate\(/, '时标只认明确的日期键');
}

console.log('timeline-admission: OK(正向准入四要件 / 不扫全属性猜日期 / 时标不猜子串)');
