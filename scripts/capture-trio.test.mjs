/**
 * 行为契约:首页输入条三合一 —— 记一笔 / 找 / 问(2026-07-31)。
 *
 * 起因是一条**许诺了没做**的路:用户在首页打「设一个明天下午 3 点医生提醒」,
 * intent-router 认出了意图、屏幕上显示了「设置提醒」四个字,然后那句话落成一条
 * 普通记录 —— 明天下午三点什么都不会发生。他以为设上了。
 *
 * 所以这份契约压的核心只有一条:**别再许诺做不到的事,也别替用户拿主意**。
 *
 *  ① 三条路都是**显式**的。默认(回车/↑)永远是记一笔,不做自动意图分流 ——
 *     猜错的代价不对称:把「问」猜成「记」只是多一条垃圾记录,把「记」猜成「问」
 *     是你要存的东西没存下来,而你以为存了。
 *  ② 认不出时间就**不提议**设提醒。宁可让人自己去日程页加,也不给他一条
 *     设在他没说过的时刻上的提醒 —— 那种他不会发现,直到错过了那件事。
 *  ③ 猜了什么必须**说出来**。只说了「明天」没说几点,界面要写明「先按早上 9:00」。
 *  ④ 建出来的提醒要**撤得掉**。自动识别总有认错的时候,而「已经建好了、你自己
 *     去日程页找出来删」不是一个能接受的收场。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** 去注释:免得「注释里写了」被当成「代码里做了」。 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function loadTs(rel) {
  const js = ts.transpileModule(read(rel), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => ({}),
    console, Object, Array, String, Number, Math, JSON, Date, RegExp, Boolean,
  });
  return mod.exports;
}

const { parseWhen, formatWhen, DEFAULT_HOUR } = loadTs('lib/portal/when-parse.ts');
const bar = code(read('components/portal/today/CaptureBar.tsx'));
const feed = code(read('components/portal/TodayFeed.tsx'));
const sheet = code(read('components/portal/VoiceInputSheet.tsx'));
const portal = code(read('components/portal/Portal.tsx'));

/** 2026-07-31 是周五,22:12 —— 「明天」「今晚」都相对它算。 */
const NOW = new Date(2026, 6, 31, 22, 12);

/* ── ① 时间真的被解析出来了 ─────────────────────────────────────────────── */

{
  // 这一句就是用户截图里打的那句。它必须变成 8/1 15:00,不能再落成一条普通记录。
  const g = parseWhen('设一个明天下午3点医生提醒', NOW);
  assert.ok(g, '「明天下午 3 点」必须认得出来 —— 认不出就回到了「许诺了没做」的老样子');
  assert.equal(g.at, '2026-08-01T15:00', `明天下午三点应是 8/1 15:00,得到 ${g?.at}`);
  assert.equal(g.hasExplicitTime, true, '明确说了几点');
  // 标题要把「设一个…提醒」这层外壳剥掉,否则提醒叫「设一个医生提醒」。
  assert.equal(g.title, '医生', `标题该是「医生」,得到「${g?.title}」`);
}
{
  // 「今晚 8 点」里的「晚」被日期那一步吃掉了(今晚 = 今天),留给时间解析的只剩「8 点」。
  // 不回头看整句的话会解析成早上八点 —— 实测栽过,所以钉住。
  const g = parseWhen('今晚8点看球', NOW);
  assert.equal(g?.at, '2026-07-31T20:00', `「今晚 8 点」应是 20:00,得到 ${g?.at}`);
}
{
  const g = parseWhen('提醒我后天早上8点交房租', NOW);
  assert.equal(g?.at, '2026-08-02T08:00');
  assert.equal(g?.title, '交房租');
}
{
  // 「下周二」= 下一周那个周二,不是这周的。
  assert.equal(parseWhen('下周二 15:00 面试', NOW)?.at, '2026-08-11T15:00');
  assert.equal(parseWhen('周三下午两点体检', NOW)?.at, '2026-08-05T14:00');
}
{
  // 只说钟点没说哪天,而今天这个钟点已经过去(现在 22:12)→ 说的是明天。
  // 不这样处理会拿到一条一创建就过期的提醒。
  assert.equal(parseWhen('8点提醒我吃药', NOW)?.at, '2026-08-01T08:00');
}
{
  // 没写年份的月日:已经过去的理解成明年,否则十二月说「1/5」会设到十一个月前。
  const dec = new Date(2026, 11, 20, 10, 0);
  assert.equal(parseWhen('1/5 缴税', dec)?.at, '2027-01-05T09:00');
}

/* ── ② 认不出就不提议 ───────────────────────────────────────────────────── */

assert.equal(parseWhen('买牛奶', NOW), null, '没有任何时间线索时必须返回 null —— 不硬凑一个时刻');
assert.equal(parseWhen('', NOW), null, '空串也是 null');
assert.ok(
  /\{when && capture\.onRemind && \(/.test(bar),
  '没认出时间时,「设成提醒」这一条不该出现在界面上',
);

/* ── ③ 猜了什么必须说出来 ───────────────────────────────────────────────── */

{
  const g = parseWhen('明天交房租', NOW);
  assert.ok(g, '只说了「明天」也算认出来了');
  assert.equal(g.hasExplicitTime, false, '没说几点 → hasExplicitTime 必须是 false');
  assert.equal(g.at.slice(11), `${String(DEFAULT_HOUR).padStart(2, '0')}:00`, '缺省钟点用 DEFAULT_HOUR');
}
assert.ok(
  /!when\.hasExplicitTime && \([\s\S]{0,400}你没说几点[\s\S]{0,120}9:00/.test(bar),
  '时间是默认填的就必须写出来 —— 装成用户定过九点,是这条路上最容易骗到人的地方',
);
assert.ok(
  /No time given[\s\S]{0,60}9:00/.test(bar),
  '那句说明得有英文版 —— 只写中文等于英文用户看不到这个提示',
);

/* ── ④ 建出来的提醒撤得掉,失败也说得清 ─────────────────────────────────── */

assert.ok(
  /onUndo: \(\) => \{[^}]*removeReminder\(r\.id\)[^}]*setRemindReceipt\(null\)/.test(feed),
  '回执上的「撤销」必须真的把那条提醒删掉,不能只是把回执藏起来',
);
assert.ok(
  /\{L\(dict, '撤销', 'Undo'\)\}/.test(bar),
  '撤销这一步要真的渲染出来',
);

/* ── ④b 两条动作不许把你刚打的话再重复两遍 ─────────────────────────────── */

// 原来「找」和「问」是两整行文字,各自把输入内容原样再写一遍 ——
// 加上输入框本身,同一句话在屏幕上出现**三次**。要找什么、要问什么,框里写着呢。
assert.ok(
  /<IconSearch size=\{18\} \/>/.test(bar)
  && /src=\{nesioBrandAssets\.crystal\}/.test(bar),
  '「找」和「问」应该只是两枚图标',
);
// 「系统一致」不是口号:放大镜要和记忆页搜索框里那枚**同一个画法**,
// 「问念念」用品牌那颗晶体(首页角标、PWA 图标用的都是它),不自己画一个星星。
{
  const icons = read('components/portal/icons.tsx');
  const memory = read('components/portal/MemoryTab.tsx');
  const mine = icons.match(/export const IconSearch = make\(<><circle ([^/]*)\/><path d="([^"]*)"/);
  assert.ok(mine, 'IconSearch 不见了');
  assert.ok(
    memory.includes(mine[2]),
    `放大镜的画法要和记忆页那枚一致(现在是 ${mine[2]})—— 同一个动作画成两个样子,用户会以为是两件事`,
  );
}
assert.ok(
  !/在我的记忆里找「\$\{typed[\s\S]{0,40}\}」`\}\s*\n\s*<\/button>/.test(bar),
  '不许再把输入内容当按钮正文显示',
);
// 图标按钮没有可见文字 —— 读屏用户全靠 aria-label,那句话必须留着。
assert.ok(
  /aria-label=\{L\(dict, `在我的记忆里找/.test(bar) && /aria-label=\{L\(dict, `问念念/.test(bar),
  '图标按钮要有 aria-label —— 上面没有文字,读屏就只剩它了',
);
assert.ok(
  /if \(!r\) \{[\s\S]{0,400}没能设上/.test(feed),
  '存不下就要说 —— 红线:每个异步动作都要有可见失败态,不许静默回 idle',
);
assert.ok(
  /addReminder\(\{ title, at, kind: 'other'/.test(feed),
  '「设成提醒」要落到 schedule-reminders(日程页那份),不是又开一处新存储',
);
assert.ok(
  /日程和时间线里都有[\s\S]{0,240}in Schedule and your timeline/.test(feed),
  '回执要点明这条提醒落在哪 —— 不说的话回执一消失,它对用户就等于不存在了',
);

/* ── ④c 收下了要看得见 ─────────────────────────────────────────────────── */

// 用户实测:「点发送、选照片选文件完了,任何反馈都没有」。
// 原来只有一行灰字,而且**只在最后一步**才出现 —— 中间那几秒(压缩/写盘/识别)
// 屏幕上一片安静,人不知道到底在办没办。
{
  assert.ok(
    /const \[quickSaved, setQuickSaved\] = useState<\{ tone: 'busy' \| 'done' \| 'note'; text: string \} \| null>/.test(feed),
    '回执要带语气:办事中 / 办好了 / 办好了但有话说 —— 三种要长得不一样',
  );
  // 锚在**行首**:`void 0 && setQuickSaved(…)` 这种把语句架空的改法,
  // 光搜片段照样匹配得到(代码存在 ≠ 会执行)。
  assert.ok(
    /^\s*setQuickSaved\(\{ tone: 'busy', text: L\(uiLocale, `正在收下/m.test(feed),
    '开始收东西的那一刻就要给状态,不是等全办完才说一句',
  );
  assert.ok(
    /quickSaved\.tone === 'busy' \? <span className="nesio-receipt-spin" \/> : quickSaved\.tone === 'done' \? '✓'/.test(feed),
    '办事时转圈、办好了打勾 —— 光一行字看不出到底成没成',
  );
  const css = read('app/globals.css');
  assert.ok(/\.is-done \.nesio-receipt-mark \{ animation: nesio-receipt-pop/.test(css), '「✓」落下要弹一下');
  assert.ok(
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}nesio-receipt-mark \{ animation: none/.test(css),
    '动效敏感的人不该被弹一下 —— 状态照给,动作去掉',
  );
  // 同名 keyframes 只许有一份:重定义会**覆盖**原来那条,而两处位移方向还相反。
  assert.equal(
    (css.match(/@keyframes nesio-receipt-in/g) || []).length, 1,
    'nesio-receipt-in 不许重定义 —— 后一份会悄悄改掉原有回执的动画',
  );
}

/* ── ④d 照片要真的过一遍识别,过不了也要说 ─────────────────────────────── */

// 用户实测:「这里上传的照片应该要经过智能识别再存,但现在是直接存为附件,
// 没有识别过程」。识别其实在跑,但**免费档是静默 return** —— 于是它到底有没有
// 发生过、为什么没发生,用户完全无从知道。
{
  assert.ok(
    /智能识别是 Pro 的能力/.test(feed),
    '识别不可用时要说出来,不能静默跳过 —— 静默的结果就是「照片直接存成了附件」',
  );
  assert.ok(
    /setQuickSaved\(\{ tone: 'busy', text: L\(uiLocale, '正在认这张图…'/.test(feed),
    '识别过程要看得见',
  );
  assert.ok(
    /已存入 · 这次没认出来/.test(feed) && /已存入 · 识别没连上/.test(feed),
    '认不出来 / 连不上,两种都要说 —— 别让人以为识别悄悄成功了',
  );
  // 只认了第一张,就只有单张时才敢改名 —— 多张时把「3 张照片」改成第一张的内容是错的。
  assert.ok(
    /recognizeSavedImage\(imgs\[0\], node\.id, imgs\.length === 1\)/.test(feed),
    '要告诉识别这是不是唯一一张',
  );
  assert.ok(
    /\.\.\.\(only \? \{ name: first\.name \} : \{\}\)/.test(feed),
    '多张照片时不许拿第一张的识别结果改整条的名字 —— 另外几张跟那个名字没关系',
  );
}

/* ── ⑤ 三条路都显式,默认仍是记一笔 ─────────────────────────────────────── */

{
  // 回车 / ↑ 的行为一个字没改:仍然是记一笔。这是肌肉记忆,不能因为多了两条路就变。
  assert.ok(
    /onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); capture\.onSubmit\(\); \} \}\}/.test(bar),
    '回车仍然直接提交(记一笔),不经过任何意图分流',
  );
  // 自动判意图这条路**不许**在这里出现 —— 猜错「记」为「问」= 东西没存下来。
  assert.ok(
    !/routeIntent/.test(bar) && !/routeIntent/.test(feed),
    '首页输入条不许用 intent-router 自动分流:猜错的代价不对称',
  );
  // 两个字以下不打扰。
  // 只认 showActions 那一行:整份文件里搜 `typed.length >= 2` 会撞上时间解析那处,
  // 门槛改坏了照样绿(断言太宽 = 断言不存在)。
  assert.ok(
    /const showActions = typed\.length >= 2 &&/.test(bar),
    '打第一个字就弹三行动作比没有更烦 —— 两个字起',
  );
}

/* ── ⑥ 搜索不重做一套界面 ───────────────────────────────────────────────── */

assert.ok(
  /nesio-memory-search'[\s\S]{0,120}detail: \{ query: q \}/.test(feed),
  '搜索要把词带到记忆页(那套是完整的:语义理解 + 筛选 + 详情),不在输入条下面再造一个小结果列表',
);
assert.ok(
  !/smartSearch/.test(bar),
  'CaptureBar 不该自己算搜索结果 —— 双实现迟早漂移',
);

/* ── ⑦ 问念念 = 真进对话页,而且话已经发出去了 ───────────────────────────── */

/*
 * 2026-07-31 前提更新(用户实测 图3:「点击问念念,应该直接进入问一问而不是搜索对话」)。
 *
 * 上一版派 nesio-open-ask → 开的是**语音 sheet 的 ask 形态**:一次性问答,
 * 回一段摘要 + 一列「来源线索」。那是检索,不是对话 —— 追问一句就得从头再问。
 * 现在改走 nesio-ask-text → NesioChatSheet(多轮、有历史),复用阅读器划词那条现成入口。
 */
assert.ok(
  /nesio-ask-text'[\s\S]{0,120}detail: \{ text: q, send: true \}/.test(feed),
  '「问念念」要进真对话页,并且带上已经打好的那句 + send:true(打完了还要再按一次发送,就不叫一步到位)',
);
// 用**专用事件名**,不复用 nesio-open-voice —— 那个名字被 test:today-settings-bug3
// 明令禁止出现在 TodayFeed 里(用户标注过:点话筒不该跳「说一说」)。
assert.ok(
  !/nesio-open-voice/.test(feed),
  '不许在 TodayFeed 里派 nesio-open-voice —— 会撞上一条用户明确要求的保护',
);
assert.ok(
  /const onAskText = \(e: Event\) => \{[\s\S]{0,600}JSON\.stringify\(\{ text, send: detail\?\.send === true \}\)[\s\S]{0,200}setChatOpen\(true\)/.test(portal),
  'Portal 要把 text 和 send 一起接住并开对话页 —— 只接 text 的话「话已发出」就丢了',
);
assert.ok(
  /setInsightsOpen\(false\);\s*\/\/ 浮层不关会盖住聊天页/.test(portal),
  '开对话页前要先关洞察浮层 —— 仓里「表面死按钮」的老根因就是浮层盖住了新开的页',
);
{
  const chat = read('components/portal/NesioChatSheet.tsx');
  // **这次改动最容易搞坏的地方**:阅读器划词带来的是一段引用(用户还没提问),
  // 直接发出去等于把一段原文丢给念念让它干瞪眼。两种来源必须分流,不能一刀切成自动发。
  assert.ok(
    /if \(autoSend\) \{ void sendMessage\(text\); return; \}/.test(chat),
    'send:true 要真的发出去,不是只填进输入框',
  );
  assert.ok(
    /setInput\(L\(dict, `关于「\$\{snippet\}」，`/.test(chat),
    '不带 send 的(阅读器划词)仍要预填成引用等用户补问题 —— 一刀切成自动发会把划词那条路弄坏',
  );
  assert.ok(
    /JSON\.parse\(raw\)[\s\S]{0,240}catch \{ \/\* 老格式是裸字符串,当引用处理 \*\/ \}/.test(chat),
    '解析要兜住老格式的裸字符串 —— 会话里可能还躺着改版前写进去的那一条',
  );
  assert.ok(
    /sessionStorage\.removeItem\('nesio-pending-ask-text'\)/.test(chat),
    '读完要清掉,否则下次打开对话页会把上一次那句再发一遍',
  );
}

/* ── ⑧ 给人看的时刻写法 ─────────────────────────────────────────────────── */

assert.equal(formatWhen('2026-08-01T15:00'), '8/1 15:00');
assert.equal(formatWhen('不是时间'), '不是时间', '认不出的原样返回,不抛错');

console.log('capture-trio: OK(时间真解析 / 认不出不提议 / 默认值自己说 / 撤得掉 / 三路显式不猜意图 / 搜索不双实现 / 问一问带话过去)');
