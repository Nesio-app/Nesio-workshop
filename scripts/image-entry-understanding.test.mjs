/**
 * image-entry-understanding —— **每个取图入口都得先在这台设备上认一遍字。**
 *
 * ## 病灶
 *
 * 全仓有 20 多个取图入口,各自决定「这张图要不要识别、怎么识别」。查下来是三种病:
 *
 *   · **只存不识别**:财务给交易挂发票、记忆详情附照片、资产附单据、见面记录贴图 ——
 *     图存下来了,上面写的金额日期商家一个字都没进系统。用户以为「附上去了就记下了」。
 *   · **顺序反了**:相机/批量导入/分享先把图发去云,等云读完再用关键词判「哦这是张小票」。
 *     可那些关键词本来就印在图上,端上认一遍就知道 —— 根本不用先发出去。
 *   · **假的端上**:聊天那条 Tier 0 叫 `recognizeImageLocally`,实现是统计平均 RGB,
 *     产出 `blue-toned` / `bright`,OCR 那行写着「简化为空」。它把这些当**节点名**
 *     显示给用户。比「没有识别」更糟 —— 一条走不通的路,伪装成走通了。
 *
 * ## 这道守卫管什么
 *
 * ① 有 `<input type=file accept=image>` 的组件,必须能到达 `understandImage`
 *    (自己调,或调 `attachImageUnderstanding` / `recognizeImageLocally` 这两个包装)。
 *    不在名单上的例外 = 红。
 * ② 例外必须在下面的 `EXEMPT` 里,**每条都带理由**。头像、封面照、非图片文件
 *    (CSV/JSON/PDF/音频)不该被识别,那不是漏网。
 * ③ `recognizeImageLocally` 必须真的走 `understandImage` —— 不许退回像素统计。
 *    这条最阴:退回去之后 UI 照样显示「识别到:…」,tsc 全绿、测试全绿。
 * ④ 端上这条路不许改走云。化验单是病历,发票上是税号和金额。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 不该(或不必)在本文件里识别的取文件口。**每条都要有理由** —— 「先放着」不是理由。
 * 加一条之前问自己:这张图是**内容**(该认),还是**装饰/标识/非图片**(不该认)?
 *
 * 第二个字段 `to` 是给「转交型」用的:这个口自己不认,把文件交给了别人认。
 * 填了 `to`,下面会**连带断言那个文件真的在认** —— 否则这类豁免就是个后门:
 * 「我转交给 X 了」写上去,X 那边的识别被删掉,守卫照样绿。
 */
const EXEMPT = new Map([
  // ── 不是内容,是标识/装饰 ──
  ['components/portal/NesioProfileCard.tsx', { why: '头像 —— 是「这是谁的账号」的标识,不是内容。认出头像上的字没有任何用处。' }],
  ['components/portal/relationships/RelationshipDetailSheet.tsx', { why: '联系人头像 —— 同 NesioProfileCard,是标识不是内容。' }],
  ['components/portal/insights/TimelineTab.tsx', { why: '地点卡封面照 —— 用户挑的一张好看的图,当背景用。认字改不了它是封面这件事。' }],

  // ── 端上答不了这个问题 ──
  ['components/portal/insights/WardrobePanel.tsx', { why: '认衣服要「看懂图」,端上 OCR 一个字也答不了(衣服上没写着自己是深蓝羊毛大衣)。加前置只会每张白等一次 OCR。理由写在该文件 recognize() 的注释里。' }],

  // ── 转交型:自己不认,交给 to 认。to 那边会被连带断言。 ──
  ['components/portal/today/CaptureBar.tsx', { why: '今天页加号 —— 只把 File 交给 onFiles;识别在 TodayFeed.captureFiles → recognizeSavedImage。', to: 'components/portal/TodayFeed.tsx' }],
  ['components/portal/PortalBottomNav.tsx', { why: '底部中键只把拍到的 File 转交给 CameraSheet(onCamera)。', to: 'components/portal/CameraSheet.tsx' }],
  ['components/portal/SnapButton.tsx', { why: '派 nesio-open-camera 事件,自己不处理图。', to: 'components/portal/CameraSheet.tsx' }],
  ['components/portal/cooking/CookingSheet.tsx', { why: '进货/记一餐都转交 CameraSheet(intakeSubtype 模式)。', to: 'components/portal/CameraSheet.tsx' }],

  // ── 走更底层的桥,或本来就是端上入口 ──
  ['components/portal/health/LabScanSheet.tsx', { why: '化验单 —— 直接走 recognizeOnDevice(比 understandImage 更底层)。端上认不了时**默认仍不发**,只多一颗要逐次点头的「发到云端认一次」(见下面 ⑤)。' }],
  ['components/portal/finance/ReceiptScanRow.tsx', { why: '本来就是端上识别的入口(走 lib/native/vision)。' }],

  // ── 根本不取图 ──
  ['components/portal/VoiceInputSheet.tsx', { why: '问一问 —— 打的是 type:ask 文本路由,不取图。' }],
  ['components/portal/NotePanelEnhanced.tsx', { why: '念念(flomo)配图 —— 图是**发给外部服务**的,不入记忆库。把 OCR 文本塞进用户写给 flomo 的正文是污染。' }],
  ['components/portal/music/MusicPanel.tsx', { why: 'accept=audio/* —— 不是图。' }],
  ['components/portal/InventorySheet.tsx', { why: 'accept=.csv —— 不是图。' }],
  ['components/portal/SettingsSheets.tsx', { why: 'accept=application/json(备份恢复)—— 不是图。' }],
  ['components/portal/finance/ReconcileSheet.tsx', { why: 'accept=application/pdf —— 不是图;VNRecognizeText 不吃 PDF。' }],
  ['components/portal/travel/TravelPlanPanel.tsx', { why: 'accept=.txt/.eml —— 不是图。' }],
  ['components/portal/travel/TripTimelineSheet.tsx', { why: '同 TravelPlanPanel:accept=.txt/.eml 的行程单文件,不是图。' }],
]);

/** 到达 understandImage 的三条路:自己调,或调这两个包装。 */
const REACHES = /\bunderstandImage\s*\(|\battachImageUnderstanding\s*\(|\brecognizeImageLocally\s*\(/;
/**
 * 认得出「这是个取文件口」的判据。
 *
 * ⚠️ **不能只认 `accept=image/*`**。今天页的加号(today/CaptureBar.tsx)是个**不写 accept**
 * 的通用 file input —— 它按体积收、按能力分流,「都能收」是它的设计。而用户点名的
 * 「今天输入框的加号里添加的图片居然都不识别」说的就是它。
 * 判据只认 image 的话,这道守卫会漏掉正是问题所在的那个口,还一路绿灯。
 *
 * 所以判据放宽到**所有 `type="file"`**,再靠 EXEMPT 把 CSV/JSON/PDF/音频那些挑出去 ——
 * 挑出去要写理由,漏掉不会。
 */
const FILE_INPUT = /type\s*=\s*["']file["']/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e.name)) out.push(path.relative(ROOT, p));
  }
  return out;
}

const files = walk(path.join(ROOT, 'components'));
const imageEntries = files.filter((rel) => FILE_INPUT.test(stripComments(read(rel))));

assert.ok(
  imageEntries.length >= 15,
  `只找到 ${imageEntries.length} 个取图入口 —— 判据大概率失效了(以前是 20+)。\n`
  + '  量具坏了比违规更危险:它会让这道守卫从此永远绿着。',
);

// ── ① 每个取图入口要么能到达 understandImage,要么在名单上 ──────────────────
const missing = imageEntries.filter((rel) => !REACHES.test(stripComments(read(rel))) && !EXEMPT.has(rel));
assert.deepEqual(
  missing, [],
  '这些地方取了图却不认字:\n'
  + missing.map((f) => `    · ${f}`).join('\n')
  + '\n  → 图存下来了,上面写的金额/日期/单号一个字都进不了系统,搜也搜不到。\n'
  + '    接上 lib/portal/image-understand 的 understandImage / attachImageUnderstanding;\n'
  + '    真不该认(头像、封面照、非图片文件),加进这个脚本的 EXEMPT 并**写清理由**。',
);

// ── ② 名单不许烂掉:例外文件必须还在,而且理由不能是空的 ──────────────────────
const staleExempt = [...EXEMPT.keys()].filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
assert.deepEqual(
  staleExempt, [],
  `EXEMPT 里这些文件已经不存在了:${staleExempt.join(', ')}\n`
  + '  → 豁免名单跟着代码烂掉的结果是:哪天有人新建同名文件,它自动被放行。',
);
const noReason = [...EXEMPT.entries()].filter(([, v]) => !v.why || v.why.trim().length < 10).map(([f]) => f);
assert.deepEqual(noReason, [], `EXEMPT 里这些条目没写理由:${noReason.join(', ')}`);

// ── ②b 转交型豁免:被转交的那个文件必须真的在认字 ────────────────────────────
// 不锁这条,「我转交给 X 了」就是一句免死金牌:X 那边的识别删掉了,这里照样绿。
// CameraSheet 就是这么被 4 个口指着的 —— 它一坏,今天页/底部中键/做饭/快拍全哑。
const brokenDelegates = [...EXEMPT.entries()]
  .filter(([, v]) => v.to)
  .filter(([, v]) => !fs.existsSync(path.join(ROOT, v.to)) || !REACHES.test(stripComments(read(v.to))))
  .map(([f, v]) => `${f} → ${v.to}`);
assert.deepEqual(
  brokenDelegates, [],
  '这些口说「识别在别处」,可那个别处并不认字:\n'
  + brokenDelegates.map((x) => `    · ${x}`).join('\n')
  + '\n  → 转交型豁免链断了。表现是:用户从这个口传图,什么也没发生,而全仓测试全绿。',
);

// ── ③ 「端上识别」不许退回像素统计 ──────────────────────────────────────────
const TIER0 = 'lib/portal/local-tier0-handlers.ts';
const tier0 = stripComments(read(TIER0));
// ⚠️ 切函数体别用 `[\s\S]*?\n\}` —— 返回类型里的 `}>>` 会先命中,切出来的只有签名,
//    后面两条断言就变成对着一段类型声明做检查,永远绿。改成「切到下一个顶层 export」。
const fnStart = tier0.indexOf('export async function recognizeImageLocally');
assert.ok(fnStart >= 0, `${TIER0} 里找不到 recognizeImageLocally 了`);
const nextExport = tier0.indexOf('\nexport ', fnStart + 1);
const fn = tier0.slice(fnStart, nextExport < 0 ? undefined : nextExport);
assert.ok(fn.includes('return'), 'recognizeImageLocally 切出来没有函数体 —— 切法坏了,后面的断言会永远绿');
assert.match(
  fn, /understandImage/,
  'recognizeImageLocally 没在走 understandImage —— 它以前的实现是统计平均 RGB,\n'
  + '  产出 blue-toned / bright 当「识别结果」,OCR 恒为空字符串。\n'
  + '  而聊天把这些当**节点名**显示给用户。退回去的话 tsc 全绿、测试全绿,\n'
  + '  真机上表现为「识别到:blue-toned」——一条走不通的路伪装成走通了。',
);
assert.doesNotMatch(
  fn, /getImageData|createElement\(\s*['"]canvas/,
  'recognizeImageLocally 又开始画 canvas 数像素了 —— 色调不是识别。',
);

// ── ④ 端上这条路不许改走云 ──────────────────────────────────────────────────
const UNDERSTAND = 'lib/portal/image-understand.ts';
const understand = stripComments(read(UNDERSTAND));
assert.doesNotMatch(
  understand, /fetch\(\s*['"`]\/api\//,
  `${UNDERSTAND} 打了云接口 —— 这一层的职责是「在这台设备上认字」,打不打云是调用方看了\n`
  + '  needsCloud 之后自己决定的。在这里偷偷发出去,等于全站每个入口都跟着发,\n'
  + '  而每个入口的注释都还写着「图不出手机」。',
);
assert.match(
  understand, /needsCloud/,
  'image-understand 不再给出 needsCloud —— 调用方就没法知道「端上够不够」,\n'
  + '  只能一律打云,这一轮做的事就白做了。',
);

// ── ⑤ 化验单走云:只能是「问过才发」,而且不许记住 ──────────────────────────
//
// 2026-07-31 用户定案:允许云兜底,但**每一张都要重新问一次**。
// 这条最容易在后面某次「优化体验」里被悄悄改掉 —— 加一个「以后不再问」的勾,
// 交互上顺了,实际是把一次性授权变成了长期授权,而对象是病历。
{
  const LAB = 'components/portal/health/LabScanSheet.tsx';
  const lab = stripComments(read(LAB));

  // 默认不发:云那条必须经过 asking 这一步,不能从 blocked 直接 fetch
  assert.match(lab, /s:\s*'asking'/, `${LAB} 少了「先问一次」那一步 —— 云兜底不能是点一下就发`);
  assert.ok(
    /setPhase\(\{\s*s:\s*'asking'/.test(lab),
    `${LAB} 里没有进入 asking 的入口 —— 那颗「发到云端认一次」要么点不动,要么绕过了确认`,
  );

  // 不许记住选择:任何形式的持久化同意都是把一次性授权变成长期授权
  assert.doesNotMatch(
    lab, /localStorage|sessionStorage|不再提醒|dontAskAgain|rememberChoice/,
    `${LAB} 开始持久化「发不发云」的选择了 —— 用户定的是**每一张都重新问**。\n`
    + '  病历的一次性同意不该被一个勾选框变成长期同意。',
  );

  // 云那条只当 OCR:判定必须留在本机
  assert.match(
    lab, /mode:\s*'ocr'/,
    `${LAB} 发云时没有指定 mode:'ocr' —— 那就不只是认字了,\n`
    + '  等于把「哪项偏高」交给会猜的东西判。临床数值判错不会报错,只会静静变成一条假记录。',
  );
  assert.match(
    lab, /parseLabReport|finishWithText/,
    `${LAB} 不再用本机的确定性解析器 —— 云认完字之后的判定必须回到 parseLabReport`,
  );
}

// 计数按**实际测到的**来,不拿 EXEMPT.size 去减 —— 名单里有些文件根本不在取文件口列表里
// (它们是留给判据放宽后的),相减出来的数是假的。报错的数字自己先得是真的。
const wired = imageEntries.filter((rel) => REACHES.test(stripComments(read(rel))));
console.log(
  `image-entry-understanding: OK(${imageEntries.length} 个取文件入口 · `
  + `${wired.length} 个接了端上识别 · ${imageEntries.length - wired.length} 个有理由的例外)`,
);
