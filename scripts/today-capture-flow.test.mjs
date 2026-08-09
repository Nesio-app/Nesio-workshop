/**
 * 行为契约:2026-07-29 真机标注那批改动的防回退锁。
 *
 * 这批里值得锁的,都是**回退了也不会立刻有人发现**的那种:
 *   ① 中间键一按直达相机 —— click() 必须留在同步手势栈里,挪进 setTimeout/await
 *      在 iOS 上就是「点了没反应,也不报错」,而桌面浏览器一切正常。
 *   ② 存进去要有回执 —— 这个 state 之前被 set 了却从来没渲染,传完文件界面毫无反应。
 *   ③ 今天页删掉的那几处不许长回来(标题重复讲同一件事、心情行的元数据、孤立圆点)。
 *   ④ 心情趋势挪到健康页之后,它的层级必须够高 —— 洞察是 fullscreen(z-930),
 *      普通 bottom sheet 是 901,会被整个盖住,表现又是「点了没反应」。
 *      这个坑本会话已经踩过一次(收纳页从洞察打开时同样被盖)。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = stripComments;

// ── ① 中间键直达相机,且 click 在同步手势栈里 ────────────────────────────────
{
  const nav = code(read('components/portal/PortalBottomNav.tsx'));
  assert.ok(/onCamera/.test(nav), '底部中间键没有相机出口');
  const at = nav.indexOf('const endPress');
  assert.ok(at > 0, 'endPress 不见了');
  const fn = nav.slice(at, nav.indexOf('\n  };', at));
  assert.ok(
    /cameraInputRef\.current\?\.click\(\)/.test(fn),
    '中间键点一下不再直接开相机了 —— 又变回先弹「拍/说/收」那一层中转',
  );
  assert.ok(
    !/setTimeout|await |\.then\(/.test(fn),
    'click() 被挪出了同步手势栈(setTimeout/await/then)—— iOS 的 WKWebView 会静默忽略它,'
    + '表现是「点中间键没反应」,而桌面浏览器照开',
  );
  // 那个 input 不能是 display:none —— 同一条 iOS 规律的另一半
  const tag = /<input[\s\S]{0,400}?capture="environment"[\s\S]{0,300}?\/>/.exec(nav)?.[0] || '';
  assert.ok(tag, '相机 input 不见了');
  assert.ok(
    /nesio-visually-hidden/.test(tag) && !/display:\s*['"]?none/.test(tag),
    '相机 input 用了 display:none —— 不参与布局的 file input 在 WKWebView 上会忽略 click()',
  );
  // 三按钮那一层必须真的没了(留着就是死代码,而且和「一按直达」是两套说法)
  assert.ok(
    !fs.existsSync(new URL('../components/portal/TellNesioSheet.tsx', import.meta.url)),
    'TellNesioSheet 又回来了 —— 中间键的中转层已经删掉,留着它只会让两套交互并存',
  );
}

// ── ② 存进去要有看得见的回执 ────────────────────────────────────────────────
{
  const feed = code(read('components/portal/TodayFeed.tsx'));
  // 2026-07-31:回执从一个字符串升级成带**语气**的对象(busy / done / note)——
  // 用户实测「点发送、选照片选文件完了,任何反馈都没有」:原来只有一行灰字,
  // 而且只在最后一步才出现。判断没变(回执必须存在且被渲染),形状变了。
  assert.ok(
    /const \[quickSaved, setQuickSaved\] = useState<\{ tone: 'busy' \| 'done' \| 'note'; text: string \} \| null>/.test(feed),
    '回执 state 不见了',
  );
  // 关键:它必须**被渲染**。之前正是「set 了但没渲染」——
  // 传完文件界面毫无反应,而代码里看着像是有提示的。
  assert.ok(
    /\{quickSaved && \(/.test(feed) && /nesio-tl-capture-receipt/.test(feed),
    '回执又变回「只 set 不渲染」了 —— 传完东西界面上什么都不会出现',
  );
  const css = read('app/globals.css');
  assert.ok(/\.nesio-tl-capture-receipt\s*\{/.test(css), '回执没有样式,会渲染成一行裸文字');

  // 识别是**加分项**,不能反过来毁掉已经存好的那条
  const at = feed.indexOf('const recognizeSavedImage');
  assert.ok(at > 0, '「+」传图不再顺手识别了');
  const fn = feed.slice(at, feed.indexOf('\n  }, [uiLocale]);', at));
  // 2026-08-01 合并(两边独立改了同一个函数):先端上认字(免费/离线/省钱),
  // 端上认不出单据字段才谈得上云,而云是付费能力 —— 两条判据都要防,不是二选一。
  //
  // 端上先行的原因:小票上写的就是那些字,端上认一遍就有,不该为一张图白发一趟云。
  // 2026-08:「+」传图必须走主相机三步(本机+Storage+memory_assets),否则换端无图。
  assert.ok(/attachPhotoToMemoryNode/.test(fn) || /attachPhotoToMemoryNode/.test(feed),
    '「+」传图没走 attachPhotoToMemoryNode —— 换端永远看不到图');
  assert.ok(/understandImage\(/.test(fn), '「+」传图不再先在端上认字 —— 每张图都会白发一趟云');
  assert.ok(
    /needsCloud[\s\S]*?return;/.test(fn),
    '端上认出来了却还是往下走云 —— 那趟往返白花钱、白等,还把票据发出了门',
  );
  assert.ok(/canUsePaidCloudAi\(\)/.test(fn), '后台识别没查权益 —— 免费账号会白跑一趟云');
  // 但**查了之后不许静默走开**:用户实测「照片直接存成附件,没有识别过程」,
  // 根因就是免费档那条 `return` 一个字都不说 —— 他无从知道识别压根没发生。
  assert.ok(
    /智能识别是 Pro/.test(fn),
    '权益不够时要把这件事说出来,不能静默 return(那正是「没有识别过程」的根因)',
  );
  assert.ok(/fileToUploadPayload/.test(fn), '识别前没缩图 —— 原图会 413');
  assert.ok(
    /catch \{/.test(fn),
    '识别失败没有兜住 —— 东西已经存好了,认不出来不该把这条流程也带崩',
  );
}

// ── ③ 今天页删掉的不许长回来 ────────────────────────────────────────────────
{
  const focus = code(read('components/portal/today/FocusSection.tsx'));
  assert.ok(
    !/todayFocusTitle/.test(focus) && !/todayFocusSubtitle/.test(focus),
    '「接下来 · 今天要紧的几件」标题又回来了 —— 它和下面那条时间线讲的是同一件事',
  );
  const mood = code(read('components/portal/MoodBeat.tsx'));
  assert.ok(
    !/nesio-tl-sub--mood/.test(mood),
    '心情那一拍的第二行(时间 · 记录 · 再记一次 · 这周趋势)又回来了',
  );
  // 但**要留下的那半**必须还在:情绪词 + 能量环
  assert.ok(/nesio-mood-word/.test(mood) && /<EnergyRing/.test(mood), '情绪词或能量环被一起删掉了');
  assert.ok(!/onOpenTrend/.test(mood), '今天页又挂上了趋势入口 —— 那是回顾,已经挪去健康页');
}

// ── ④ 趋势挪到健康页,层级要够 ──────────────────────────────────────────────
{
  const health = code(read('components/portal/health/HealthDashboard.tsx'));
  assert.ok(
    /<MoodTrendCard\b/.test(health),
    '健康页没有心情趋势入口 —— 从今天页删掉之后就没地方看走势了',
  );
  const trend = code(read('components/portal/MoodTrendSheet.tsx'));
  assert.ok(
    /\n\s*elevated\b/.test(trend),
    '情绪趋势面板不是 elevated —— 它现在从洞察(fullscreen z-930)里打开,'
    + '普通 bottom 是 901,会被整个盖住,表现是「点了没反应」',
  );
}

// ── ⑤ 设置页:配色搬到外观、三个删除收进危险区 ──────────────────────────────
{
  const st = read('components/portal/SettingsSheets.tsx');
  const apAt = st.indexOf('export function AppearanceSheet(');
  const labAt = st.indexOf('export function LabSheet(');
  const palAt = st.indexOf('nesio-palette-grid');
  assert.ok(apAt > 0 && labAt > 0 && palAt > 0, '找不到相关的 sheet');
  assert.ok(
    palAt > apAt && palAt < labAt,
    '配色色卡不在「外观与语言」里 —— 它是日常设置(和明暗/字号/语言并列),不该藏在 Lab',
  );
  const code2 = code(st);
  assert.ok(/nesio-settings-danger-zone/.test(code2), '三个删除按钮又平铺回去了');
  assert.ok(
    /<details className="nesio-settings-danger-zone">/.test(code2),
    '危险区没有用 <details> —— 折叠这件事不需要 React,原生元素自带无障碍语义',
  );
  const dz = code2.slice(code2.indexOf('nesio-settings-danger-zone'));
  assert.equal(
    (dz.match(/tone="risk"/g) || []).length, 3,
    '危险区里的三个删除动作没齐(清记忆 / 删本机 / 删账号)',
  );
}

// ── ⑨ 日历条目的正文:整条就是一个链接时别占一行 ─────────────────────────
//
// 用户实测(2026-07-31 图4):「第二个显示的一串网址内容没有意义」。
// 从待办类应用同步来的日历项,description 常常整条就是一个回原应用的深链
// (https://dida365.com/webapp#p/inbox/tasks/68f…):读不出信息、还把行撑破,
// 而同一块里旁边就有一颗「链接」按钮 —— 那才是它该有的样子。
{
  const ts = await import('typescript');
  const vm = await import('node:vm');
  const js = ts.default.transpileModule(read('components/portal/today/CalendarCards.tsx'), {
    compilerOptions: { module: ts.default.ModuleKind.CommonJS, target: ts.default.ScriptTarget.ES2022, jsx: ts.default.JsxEmit.React },
  }).outputText;
  const mod = { exports: {} };
  vm.default.runInNewContext(js, {
    module: mod, exports: mod.exports, require: () => new Proxy({}, { get: () => () => null }),
    console, Object, Array, String, Number, Math, JSON, Set, Map, Boolean, RegExp,
  });
  const { meaningfulDesc } = mod.exports;

  assert.equal(meaningfulDesc('https://dida365.com/webapp#p/inbox/tasks/68f0a1'), '', '整条就是一个深链 → 不显示');
  assert.equal(meaningfulDesc('  https://example.com/x?y=1  '), '', '前后空白不影响判断');
  assert.equal(meaningfulDesc(''), '', '空的就是空的');
  assert.equal(meaningfulDesc(undefined), '', 'undefined 不许抛');
  // **判据是「去掉链接后还剩不剩人话」,不是「以 http 开头就砍」**——
  // 砍错的代价是把用户真写的字弄丢,那比多显示一行网址严重得多。
  assert.equal(
    meaningfulDesc('地址 https://maps.example.com/abc 记得带表'),
    '地址 https://maps.example.com/abc 记得带表',
    '链接**旁边**有内容的必须原样留下 —— 这是用户自己写的字',
  );
  // 链接**在开头**、后面才是正文 —— 日历描述里极常见(会议链接 + 一句说明)。
  // 这一条专门用来区分两种判据:偷懒写成 /^https?:/ 就会把「记得带表」一起砍掉,
  // 而上面那条(链接在中间)是抓不住这个错的。
  assert.equal(
    meaningfulDesc('https://maps.example.com/abc 记得带表'),
    'https://maps.example.com/abc 记得带表',
    '判据是「去掉链接后还剩不剩人话」,不是「以 http 开头就砍」—— 砍错就把用户写的字弄丢了',
  );
  assert.equal(meaningfulDesc('带上泳衣'), '带上泳衣', '压根没链接的当然留');
  assert.equal(meaningfulDesc('https://a.com https://b.com'), '', '整条全是链接,几条都一样没意义');
}

console.log('today-capture-flow: OK(直达相机 · 回执看得见 · 删掉的没长回来 · 趋势层级够 · 设置已整合 · 裸链接不占行)');
