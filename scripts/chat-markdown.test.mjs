/**
 * 行为契约:聊天气泡里的 markdown 记号(lib/portal/chat-markdown.ts,QA #18)。
 *
 * 两条底线:
 *   ① 记号要脱干净 —— 否则用户看到的是「* 7月28日（周二）」这种星号糊在正文里;
 *   ② **输出必须仍是纯文本**。聊天内容里混着邮件正文、日程标题这些外部数据,
 *      哪天有人图省事改成 dangerouslySetInnerHTML,这条测试要挡住。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SRC = read('lib/portal/chat-markdown.ts');
const js = ts.transpileModule(SRC, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, String, RegExp, Array, Object });
const { markdownToPlain } = mod.exports;

// ── ① 列表:用户实际撞见的那一条 ──────────────────────────────────────────────
{
  const out = markdownToPlain('这周的日程：\n* 7月28日（周二）开会\n* 7月30日（周四）体检');
  assert.ok(!out.includes('*'), `列表星号没脱干净:${JSON.stringify(out)}`);
  assert.ok(out.includes('• 7月28日（周二）开会'), `列表没变成圆点:${JSON.stringify(out)}`);
  // 缩进要留着,否则嵌套列表全平了
  assert.ok(markdownToPlain('- 一级\n  - 二级').includes('  • 二级'), '嵌套列表的缩进没保住');
}

// ── ② 粗体/斜体/代码/标题/链接 ───────────────────────────────────────────────
{
  assert.equal(markdownToPlain('**重要**：三点开会'), '重要：三点开会');
  assert.equal(markdownToPlain('## 本周安排'), '本周安排');
  assert.equal(markdownToPlain('字段 `startISO` 缺失'), '字段 startISO 缺失');
  assert.equal(markdownToPlain('见 [日程页](https://x.com/a)'), '见 日程页(https://x.com/a)');
  // 落单星号不能被当成斜体吃掉内容。**必须用贴着字的那种**(a*b*c):
  //「3 * 4 = 12」两边都有空格,松紧两种规则都不会误伤,测不出差别(变异测试抓到的)。
  assert.equal(markdownToPlain('3 * 4 = 12'), '3 * 4 = 12');
  assert.equal(markdownToPlain('查询 a*b*c 的结果'), '查询 a*b*c 的结果', '斜体规则太松,把乘号之间的内容吃掉了');
}

// ── ③ 输出仍是纯文本,而且渲染层没走 innerHTML ────────────────────────────────
{
  const evil = markdownToPlain('<img src=x onerror=alert(1)> **粗**');
  assert.ok(evil.includes('<img'), '不该替用户改写内容 —— 只脱 markdown 记号');
  const chat = read('components/portal/NesioChatSheet.tsx');
  assert.ok(
    !/dangerouslySetInnerHTML/.test(chat),
    '聊天气泡用上 dangerouslySetInnerHTML 了 —— 气泡里有邮件正文和日程标题这类外部数据,不能当 HTML 渲染',
  );
  assert.ok(/markdownToPlain\(msg\.text\)/.test(chat), '气泡没有经过 markdown 清洗 —— 星号会原样显示');
}

// ── ④ 不许把正常内容改坏 ─────────────────────────────────────────────────────
{
  assert.equal(markdownToPlain(''), '');
  assert.equal(markdownToPlain('就是一句普通的话。'), '就是一句普通的话。');
  assert.equal(markdownToPlain('C:\\path_to\\file'), 'C:\\path_to\\file', '下划线路径被当成斜体了');
}

console.log('chat-markdown: OK(列表 · 记号 · 纯文本 · 不误伤)');
