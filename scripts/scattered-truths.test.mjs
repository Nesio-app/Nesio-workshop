/**
 * 行为契约:散条一批(2026-07-30 真机,bug #8 / #18 / #25 / #31 / #35 / #36)。
 *
 * 六条报告长得完全不相干,凑成一条契约是因为它们都是同一种失手:
 * **一个东西被放在它不属于的位置上,而没人问一句「它是这个吗」。**
 *
 *   #8  九宫格那一格从「车」改名成「资产」(房产 + 车),图标还是一辆小汽车。
 *   #18 日程记忆的「地点」字段里塞的是一整条 Zoom 链接 —— 一条 URL 不是一个地方。
 *   #25 首页输入框里的草稿从来不会消失:存的只有文字,没有「什么时候留下的」,
 *       于是几个月前语音听岔的半句今天打开还躺在框里,看起来像刚打的。
 *   #31 同一时刻两条相距约 10 米的坐标被记成两次独立到访 ——
 *       合并的判据是「同名」,而这两条都还没认出名字。**没有名字的点,坐标才是身份。**
 *   #35 「前提·事实·逻辑·情绪」套在一条「PROD Install Zoom Bridge 会议通知」上,
 *       「情绪」一栏只能生硬地编。这些镜头是给**人说的话**设计的。
 *   #36 「你也提过 Fidelity —— 在这之前一共 58 次 —— 也许是个值得留意的模式」。
 *       可 Fidelity 是每天日程同步里固定出现的托管方名字,它**本来就该天天出现**。
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
    Date, Math, Number, Array, Object, String, Set, Map, JSON, isNaN, RegExp, Boolean, URL,
  });
  return mod.exports;
}

/* ══ #8 名字改了,图标也得改 ═══════════════════════════════════════ */
{
  const src = read('components/portal/InsightsSheet.tsx');
  assert.match(src, /case 'tesla': return <IconHome \/>;/,
    '这一格叫「资产」(房产 + 车两个子 tab),图标却是一辆小汽车 —— ' +
    '名字和图标说的不是一件事,用户点进去才发现里面还有房产');
  assert.match(src, /t === 'tesla' \? L\(dict, '资产', 'Assets'\)/, '名字还是「资产」');
}

/* ══ #18 一条 URL 不是一个地方 ═════════════════════════════════════ */
{
  const { splitEventLocation, shortUrlLabel } = loadTs('lib/portal/meeting-location.ts');

  // 截图里那一条:整段 location 就是一条 Zoom 链接
  const only = splitEventLocation('https://fmr.zoom.us/j/12345?pwd=abc');
  assert.equal(only.place, '', '摘掉链接什么都不剩 → 这条记录根本没有地点');
  assert.equal(only.knownMeeting, true, 'zoom.us 一眼能认出是会议');
  assert.match(only.meetingUrl, /zoom\.us/);

  // 上一版只认「整段就是一条 URL」—— 现实里常见的是混着写的,全漏了
  const mixed = splitEventLocation('Zoom Meeting https://fmr.zoom.us/j/1 (Room 3)');
  assert.match(mixed.place, /Room 3/, '还剩文字的话,那才是真地点');
  assert.match(mixed.meetingUrl, /zoom\.us/, '链接单独给出来');

  const real = splitEventLocation('123 Main St, Cary NC');
  assert.equal(real.meetingUrl, '', '真地址里没有链接');
  assert.equal(real.place, '123 Main St, Cary NC', '真地址一个字都不能动');

  assert.equal(splitEventLocation('').place, '');
  assert.equal(splitEventLocation(null).meetingUrl, '');
  assert.equal(shortUrlLabel('https://fmr.zoom.us/j/1'), 'fmr.zoom.us', '一长串 URL 没法看,给域名');
  assert.equal(shortUrlLabel('不是链接'), '不是链接', '解析不了就原样,不崩');

  const detail = read('components/portal/MemoryNodeDetail.tsx');
  assert.match(detail, /splitEventLocation\(location\)/, '详情页要用这份判据');
  assert.doesNotMatch(detail, /const meetingUrl = \/\^https\?:\\\/\\\/\/i\.test\(location\.trim\(\)\)/,
    '旧判据(整段必须就是一条 URL)要拆掉 —— 它漏掉了所有混着写的');
}

/* ══ #25 草稿要有尽头,而且不是今天的要说清楚 ═════════════════════ */
{
  const { parseDraft, draftAgeNote, DRAFT_TTL_DAYS, MAX_DRAFT_CHARS } = loadTs('lib/portal/jot-draft.ts');
  const NOW = Date.parse('2026-07-30T12:00:00Z');
  const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();

  assert.equal(parseDraft(JSON.stringify({ text: '买牛奶', at: ago(1) }), NOW).text, '买牛奶', '昨天的草稿照样恢复');
  assert.equal(parseDraft(JSON.stringify({ text: '关注chong', at: ago(DRAFT_TTL_DAYS + 1) }), NOW), null,
    `放了 ${DRAFT_TTL_DAYS} 天以上的不再恢复 —— 它是 cache 类数据,丢了本来就没关系;` +
    '而留着它就是用户说的「从未被清空过」');

  // 老格式(裸字符串)是用户的字,不能因为没有日期就扔掉
  assert.equal(parseDraft('买牛奶', NOW).text, '买牛奶');
  assert.equal(parseDraft('买牛奶', NOW).at, '', '老格式没有日期');
  assert.equal(draftAgeNote({ text: 'x', at: '' }), null, '不知道哪天的就别说 —— 那是噪音');

  assert.equal(parseDraft('x'.repeat(MAX_DRAFT_CHARS + 1), NOW), null, '超长的一律丢(读入防线)');
  assert.equal(parseDraft('   ', NOW), null);
  assert.equal(parseDraft(null, NOW), null);
  assert.equal(parseDraft('{坏 json', NOW), null, '坏数据不崩');
  assert.equal(parseDraft(JSON.stringify({ text: '买牛奶', at: '不是日期' }), NOW).text, '买牛奶',
    '日期读不出来就当没有日期用,不能因为脏数据把用户的字扔了');

  const note = draftAgeNote({ text: 'x', at: '2026-07-20T09:00:00' }, new Date(2026, 6, 30, 12));
  assert.ok(note && /7\/20/.test(note.zh), '不是今天留下的要说清是哪天的');
  assert.equal(draftAgeNote({ text: 'x', at: new Date(2026, 6, 30, 9).toISOString() }, new Date(2026, 6, 30, 12)), null,
    '今天刚写的不用解释');

  const feed = read('components/portal/TodayFeed.tsx');
  assert.match(feed, /readJotDraft\(\)/, '今天页要用这套读法');
  assert.doesNotMatch(feed, /localStorage\.getItem\('nesio-jot-draft-v1'\)/, '旧的裸读法要拆掉');
  assert.match(feed, /staleNote=/, '不是今天的草稿要在输入条下面说清楚');
  assert.match(read('components/portal/today/CaptureBar.tsx'), /capture\.staleNote && capture\.value\.trim\(\)/,
    '有字才说 —— 空框下面挂一句解释是噪音');
}

/* ══ #31 没有名字的点,坐标才是身份 ═══════════════════════════════ */
{
  const src = read('lib/portal/place-trail.ts');
  assert.match(src, /eitherUnnamed && dist != null && dist < 0\.15/,
    '相距 10 米的两条坐标被记成两次到访,是因为合并只认「同名」—— ' +
    '而这两条都还没认出名字。没有名字时该只看距离');
  assert.match(src, /isGenericPlaceLabel\(last\.label\) \|\| isGenericPlaceLabel\(v\.label\)/,
    '「没认出名字」用的是全站同一份占位符判据(lib/portal/geo)');
  assert.match(src, /sameName\n?\s*\? \(dist == null \|\| dist < 0\.5\)/,
    '同名仍然按 500 米走(两家同名店不会挨这么近)');
  assert.match(src, /两个\*\*不同的真地名\*\*永远不合/,
    '真的去了两个地方就是两次到访 —— 这一条不能被顺手放宽');
}

/* ══ #35 心理镜头是给「人说的话」准备的 ═══════════════════════════ */
{
  const { hasPersonalVoice, lensesForMemory } = loadTs('lib/portal/lens.ts');

  assert.equal(hasPersonalVoice('PROD Install Zoom Bridge 会议通知'), false,
    '一条系统通知里没有「你」—— 拆出来的「情绪」只能是编的');
  assert.equal(hasPersonalVoice('今天被说了一顿,我觉得挺没用的'), true);
  assert.equal(hasPersonalVoice('I feel like I messed this up'), true);

  const notice = lensesForMemory('PROD Install Zoom Bridge 会议通知');
  assert.ok(notice.withheldPersonal >= 2,
    '「前提·事实·逻辑·情绪」和「认知扭曲识别」都该收起来');
  assert.ok(![...notice.recommended, ...notice.rest].some((l) => l.id === 'argue' || l.id === 'cbt'),
    '收起来就是真的不出现在列表里,不是排到后面 —— ' +
    '排到后面用户照样会点开,然后看到很勉强的输出');
  assert.ok(notice.rest.length > 0, '别的镜头(五问根因、事前验尸)照常提供:它们不依赖情绪');

  const personal = lensesForMemory('今天被说了一顿,我觉得挺没用的');
  assert.equal(personal.withheldPersonal, 0);
  assert.ok([...personal.recommended, ...personal.rest].some((l) => l.id === 'cbt'), '该有的时候一个不少');

  assert.match(read('components/portal/MemoryLensSheet.tsx'), /withheldPersonal > 0 &&/,
    '收起来了要说一句为什么 —— 否则用户只会觉得「怎么少了几个」');
}

/* ══ #36 天天出现的东西不是模式 ═══════════════════════════════════ */
{
  const { lensEcho, BACKGROUND_MIN_COUNT } = loadTs('lib/portal/lens.ts');
  const isTopic = () => true;
  const day = (n) => new Date(2026, 5, n, 9).toISOString();

  // Fidelity:每天的日程同步通知里都带着它
  const all = [];
  for (let i = 1; i <= 20; i++) all.push({ id: `f${i}`, createdAt: day(i), tags: ['Fidelity'] });
  const self = { id: 'self', createdAt: day(21), tags: ['Fidelity'] };
  all.push(self);

  const bg = lensEcho(self, all, isTopic);
  assert.equal(bg.background, true,
    `它出现在几乎每一个有记录的日子里(${bg.count} 条 ≥ ${BACKGROUND_MIN_COUNT})—— ` +
    '这描述的是「你每天都会收到这类通知」,不是「你最近在关注它」');
  assert.equal(bg.many, false,
    '所以不许说「也许是个值得留意的模式」。它是背景,不是信号');
  assert.equal(bg.count, 20, '条数本身还是如实报出来 —— 藏起来是另一种不老实');

  // 真的偶尔提起:同样 3 条,但夹在一堆别的记录里
  const sparse = [];
  for (let i = 1; i <= 20; i++) sparse.push({ id: `o${i}`, createdAt: day(i), tags: ['别的'] });
  sparse.push({ id: 'a', createdAt: day(3), tags: ['装修'] });
  sparse.push({ id: 'b', createdAt: day(9), tags: ['装修'] });
  const s2 = { id: 's2', createdAt: day(21), tags: ['装修'] };
  sparse.push(s2);
  const hit = lensEcho(s2, sparse, isTopic);
  assert.equal(hit.background, false, '偶尔提起的才是真模式');
  assert.equal(hit.many, true);

  assert.match(read('components/portal/MemoryLensSheet.tsx'), /relatedHint\.background &&/,
    '背景常量要说清它为什么天天出现 —— 否则用户会以为自己在反复关注它');
}

console.log('scattered-truths: OK(图标跟着名字 / URL 不是地点 / 草稿有尽头 / 无名点看坐标 / 心理镜头看人话 / 背景不是模式)');
