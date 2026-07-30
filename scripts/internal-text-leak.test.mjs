/**
 * 行为契约:说给程序听的话,不许发给人(2026-07-30 真机,bug #13 / #16 / #19 / #20)。
 *
 * 四条报告,同一句话的四种走法 ——「内部的东西没换成人话就端出去了」:
 *
 *   #13 首页问候语正下方出现过一整条系统级报错。判据的最后一行是 `return err;`:
 *       **认不出来的错误码就原样印到首页最显眼的地方**。降级要可见(承诺④),
 *       但可见不等于用内部语言喊出来。
 *
 *   #16 记忆库搜「健身」,第一条是「#主题/健身」,详情的「原始记录」也是这一串 ——
 *       flomo 里建标签时随手留的一行,导进来成了一条「记忆」。
 *       同步侧的门 07-29 加过了,但**已经进来的还在图里**,每次搜索照样再出现一次。
 *       修了源头不等于修了现场。
 *
 *   #19 念念的历史对话里能看到它自己说过「识别到:未检测到任何生命图谱条目」。
 *       气泡那一层挡住了,**历史列表的标题**没走这道 —— 一个漏口就够用户看见一次。
 *
 *   #20 模型用 markdown 列表回答,而渲染是纯文本,星号原样糊在正文里。
 *       念念那边修过(markdownToPlain),健康「智能解读」漏了 ——
 *       同一个 bug 在两个模块各犯一遍,就是因为没走同一个函数。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, require: () => ({}),
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean,
  });
  return mod.exports;
}

/* ══ #13 认不出来的错误码,不许原样印出去 ═════════════════════════ */
{
  const src = read('components/portal/TodayFeed.tsx');
  const fn = src.slice(src.indexOf('function judgeReason'), src.indexOf('import { resolveCardTarget'));

  assert.doesNotMatch(fn, /\n\s*return err;/,
    '最后那行 `return err;` 就是 #13 本身 —— 认不出来的错误码直接印到问候语底下。' +
    '判据必须是正向的:只说我们认识的那几个原因');
  assert.match(fn, /didn't get through|这次没连上/,
    '认不出来也要有一句人话,不能什么都不说(降级必须可见,承诺④)');

  // 原始错误留给能查的人,不摊在脸上
  assert.match(src, /title=\{judgeFailed\}/,
    '原始错误码放 title 里 —— 要查的人查得到,用户不用看见');
  assert.doesNotMatch(src, /AI 判断这次没成/,
    '这句话是站在系统角度说的。用户不关心「AI 判断」这个内部动作,' +
    '只关心「今天这一列还能不能看」');
}

/* ══ #16 只有标签没有正文的导入条目:入库挡 + 展示也认得出 ═════════ */
{
  const { isTagOnlyText } = loadTs('lib/portal/topic-tags.ts');

  assert.equal(isTagOnlyText('#主题/健身'), true,
    '截图里那一条:名字是它、正文也是它。搜「健身」第一条命中的就是这个内部分类标签本身');
  assert.equal(isTagOnlyText('  #主题/健身   #运动 '), true, '好几个标签也一样');
  assert.equal(isTagOnlyText('#健身 今天练了腿'), false,
    '有正文的**必须留着** —— 那是真笔记。把它一起滤掉是另一种数据丢失');
  assert.equal(isTagOnlyText('今天练了腿'), false);
  assert.equal(isTagOnlyText(''), false);
  assert.equal(isTagOnlyText('   '), false);
  assert.equal(isTagOnlyText('###'), false,
    '光几个井号不是标签,别把它当成「只有标签」的条目滤掉');

  // 两处共用同一份判据
  const sync = read('lib/portal/providers/connector-sync.ts');
  assert.match(sync, /isTagOnlyText\(plain\)/,
    '入库门要调这一份,不能再内联一套 —— 两套判据必然漂移');
  assert.doesNotMatch(sync, /const withoutTags = plain\.replace/,
    '旧的内联判据要拆掉');

  const vis = read('lib/portal/memory-visibility.ts');
  assert.match(vis, /isTagOnlyImport/, '展示层也要认得出已经进来的那些');
  assert.match(vis, /!isWeatherNode\(n\) && !isTagOnlyImport\(n\)/,
    'visibleMemoryNodes 是「一条记忆算不算数」的唯一判据 —— ' +
    '记忆页和设置页的计数都走它,滤在这里两边才不会又各报一个数');
}

/* ══ #19 历史列表的标题也要挡 ═════════════════════════════════════ */
{
  const { isInternalDiagnostic } = loadTs('lib/portal/chat-internal-text.ts');
  assert.equal(isInternalDiagnostic('识别到：未检测到任何生命图谱条目'), true);

  const src = read('components/portal/NesioChatSheet.tsx');
  assert.match(src, /real\.find\(\(m\) => !isInternalDiagnostic\(m\.text\)\)\?\.text/,
    '一段没有用户发言的对话,标题原来直接取了模型那句内部诊断');
  const list = src.slice(src.indexOf('nesio-chat-history-item-title'), src.indexOf('nesio-chat-history-item-title') + 400);
  assert.match(list, /isInternalDiagnostic\(s\.title\)/,
    '早先存下的标题里可能已经躺着一句 —— 渲染这一层也挡一道,不改历史数据');
}

/* ══ #20 模型回复的 markdown:两个模块走同一个函数 ═══════════════ */
{
  const { markdownToPlain } = loadTs('lib/portal/chat-markdown.ts');
  assert.equal(markdownToPlain('* 7月28日（周二）'), '• 7月28日（周二）',
    '截图里那一行:星号原样糊在正文里');
  assert.equal(markdownToPlain('**重要**：下午三点开会'), '重要：下午三点开会');

  const dash = read('components/portal/health/HealthDashboard.tsx');
  assert.match(dash, /markdownToPlain\(text\)\.split/,
    '健康「智能解读」也是模型生成的文字,漏了这道 —— ' +
    '同一个 bug 在两个模块各犯一遍,就是因为没走同一个函数');
  assert.doesNotMatch(dash, /\{text\.split\('\\n'\)\.filter\(Boolean\)/,
    '旧的裸渲染要拆掉');

  // 仍然不许渲染 HTML:这段文字里带着健康读数/邮件正文这类外部数据
  const md = read('lib/portal/chat-markdown.ts');
  assert.doesNotMatch(md, /dangerouslySetInnerHTML/, '只脱记号,不渲染 HTML');
  assert.doesNotMatch(dash, /dangerouslySetInnerHTML=\{\{ __html: text/, '健康这块同理');
}

console.log('internal-text-leak: OK(错误码不外泄 / 标签壳两处同判据 / 历史标题也挡 / markdown 走同一个函数)');
