/**
 * 行为契约:免费最大化·Gmail —— labelIds 分类分流 + HTML-only 正文修复。
 * 锁死:广告(CATEGORY_PROMOTIONS)不喂 AI(extractNodes + 兜底都跳过)、
 * 通知类(CATEGORY_UPDATES)/重要(IMPORTANT)标记透传;正文提取递归遍历嵌套 part
 * 且 text/plain 缺失时回退 text/html 剥标签(修此前只取第一层 text/plain 的 bug)。
 * 路由带 auth/cookie/integrations 重依赖,整路由跑成本高;锁源码行为形状 + 纯函数逻辑抽测。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const src = fs.readFileSync(new URL('../app/api/portal/gmail/route.ts', import.meta.url), 'utf8');

// ── 源码级:分流 + 兜底 + 标记 ──
assert.ok(/CATEGORY_PROMOTIONS/.test(src), '识别广告标签');
assert.ok(/filter\(\(m\)\s*=>\s*!isPromotion\(m\)\)/.test(src.replace(/\s+/g, ' ')) || src.includes('!isPromotion(m)'), '广告不喂 AI(extractNodes 过滤)');
assert.ok(src.includes("messages.filter((m) => !isPromotion(m)).map"), '兜底节点也跳过广告');
assert.ok(src.includes('CATEGORY_UPDATES') && src.includes("'通知'"), '通知类标 tag');
assert.ok(src.includes("IMPORTANT") && src.includes("'重要'"), '重要标记透传');
assert.ok(src.includes('mailCategory: cat'), '邮件分类落到 attributes');
assert.ok(src.includes('findPartData') && /findPartData\(p, mime\)/.test(src), '正文递归遍历嵌套 part');
assert.ok(src.includes("findPartData(root, 'text/html')") && src.includes('stripHtml'), 'text/plain 缺失回退 text/html 剥标签');

// ── 纯函数逻辑:把 extractText/findPartData/stripHtml/isPromotion/mailCategory 抽出来直测 ──
// 转译整源,截取这几个函数定义(不含 Next 依赖),在沙盒里 eval 后行为验证。
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
function grab(name) {
  const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n\\}`, 'm');
  const m = js.match(re);
  assert.ok(m, `抽到 ${name}`);
  return m[0];
}
const sandbox = { Buffer };
vm.createContext(sandbox);
vm.runInContext(
  [grab('decodeBase64Url'), grab('findPartData'), grab('stripHtml'), grab('extractText'), grab('isPromotion'), grab('mailCategory'),
    'globalThis.__x = { extractText, isPromotion, mailCategory };'].join('\n'),
  sandbox,
);
const { extractText, isPromotion, mailCategory } = sandbox.__x;
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

// HTML-only 邮件(无 text/plain)→ 剥标签取正文
{
  const msg = { id: '1', payload: { parts: [{ mimeType: 'text/html', body: { data: b64('<p>Your bill is <b>$42</b></p>') } }] } };
  const t = extractText(msg);
  assert.ok(t.includes('Your bill is') && t.includes('$42') && !t.includes('<'), 'HTML-only 正文取到且剥标签');
}
// 嵌套 multipart:text/plain 藏在里层 → 递归取到
{
  const msg = { id: '2', payload: { parts: [{ mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/plain', body: { data: b64('plain body here') } },
    { mimeType: 'text/html', body: { data: b64('<p>html</p>') } },
  ] }] } };
  assert.equal(extractText(msg), 'plain body here', '嵌套 text/plain 优先递归取到');
}
// 都没有 → 退 snippet
assert.equal(extractText({ id: '3', snippet: 'snip' }), 'snip', '无 part 退 snippet');
// 分类
assert.equal(isPromotion({ labelIds: ['CATEGORY_PROMOTIONS', 'INBOX'] }), true);
assert.equal(isPromotion({ labelIds: ['INBOX'] }), false);
assert.equal(mailCategory({ labelIds: ['CATEGORY_UPDATES'] }), 'updates');
assert.equal(mailCategory({ labelIds: ['INBOX'] }), 'personal');

// ── 新:分类也叠加到 AI 提取的节点(此前只在兜底路径打)──
assert.ok(src.includes('mailClassBySender'), 'AI 提取路径用 mailClassBySender 回填分类');
assert.ok(/const byEmail = mailClassBySender\(worth\)/.test(src), 'extractNodes 按 worth 邮件建发件人分类表');
assert.ok(/emailAddrOf\(String\(attrs\.source \?\? attrs\.from/.test(src), 'AI 节点按发件人邮箱归并分类');
assert.ok(/cls\.category === 'updates'[\s\S]{0,60}'通知'/.test(src), 'AI 节点:updates → 通知 tag');
assert.ok(/cls\.important[\s\S]{0,60}'重要'/.test(src), 'AI 节点:important → 重要 tag');
assert.ok(/mailCategory: cls\.category/.test(src), 'AI 节点写 mailCategory 属性');

// 纯函数:emailAddrOf + mailClassBySender
vm.runInContext(
  [grab('header'), grab('emailAddrOf'), grab('mailClassBySender'),
    'globalThis.__y = { emailAddrOf, mailClassBySender };'].join('\n'),
  sandbox,
);
const { emailAddrOf, mailClassBySender } = sandbox.__y;
assert.equal(emailAddrOf('Chase <alerts@chase.com>'), 'alerts@chase.com', '从「名字 <地址>」抠邮箱');
assert.equal(emailAddrOf('BARE@x.com'), 'bare@x.com', '裸地址小写');
assert.equal(emailAddrOf('no email here'), '', '无地址返回空');
{
  const hdr = (v) => ({ payload: { headers: [{ name: 'From', value: v }] } });
  const map = mailClassBySender([
    { ...hdr('Chase <alerts@chase.com>'), labelIds: ['CATEGORY_UPDATES', 'IMPORTANT'] },
    { ...hdr('Ann <ann@x.com>'), labelIds: ['INBOX'] },
  ]);
  // 跨 realm 对象不能 deepEqual(原型不同),逐字段断言。
  const chase = map.get('alerts@chase.com');
  assert.equal(chase.category, 'updates', '账单发件人 → updates');
  assert.equal(chase.important, true, '账单发件人 → important');
  const ann = map.get('ann@x.com');
  assert.equal(ann.category, 'personal', '普通发件人 → personal');
  assert.equal(ann.important, false, '普通发件人 → 非 important');
}

console.log('gmail-labels: OK');
