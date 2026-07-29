/**
 * 行为契约:内部诊断不许当回复显示给用户(2026-07-29 QA #17)。
 *
 * 用户翻念念的历史,看到它自己说过「识别到:未检测到任何生命图谱条目」。
 * 产生这句话的三个入口 07-28/29 已经修好了 —— 但**已经存下的对话在 localStorage 里**,
 * 每次打开还会再显示一遍。修了源头不等于修了现场,这条测试管的是现场那一层。
 *
 * 判据用「内部词汇」而不是「那两句原话」:照原话匹配只能挡住这两句,
 * 下一句换个说法就漏。「生命图谱 / 节点 / 条目」是数据模型的说法,
 * 产品里从来不该出现在给用户的句子里。
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { stripComments } from './lib/strip-comments.mjs';

const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const code = stripComments;

// TS → JS(这个模块是纯正则,没有依赖,直接剥掉类型注解跑真函数,不做字符串断言)
const ts = read('lib/portal/chat-internal-text.ts');
const js = ts
  .replace(/:\s*RegExp\[\]/g, '')
  .replace(/\(text:\s*string\):\s*boolean/g, '(text)')
  .replace(/^export /gm, 'export ');
const tmp = path.join(os.tmpdir(), `chat-internal-${process.pid}.mjs`);
fs.writeFileSync(tmp, js);
const { isInternalDiagnostic } = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

// ── ① 用户真的看到过的那两句,必须认出来 ────────────────────────────────────
for (const s of [
  '识别到：未检测到任何生命图谱条目',
  '识别到：用户未提供任何输入信息，无法提取生命图谱节点',
  'No life graph entries detected.',
]) {
  assert.ok(isInternalDiagnostic(s), `没认出内部诊断:${s}`);
}

// ── ①b 换个说法也得认出来 ─────────────────────────────────────────────────
// 这一组才是「判据是词汇、不是原话」的**证明**。第一版只有上面那三句,
// 于是把判据退化成照抄原话,测试照样全绿(变异测试当场抓到)——
// 那样下次模型换个措辞就漏,而漏掉的表现和这次一模一样:内部话原样发给用户。
// 下面每一句都只有靠「内部词汇」那条才拦得住,照原话匹配一句也接不住。
for (const s of [
  '已扫描生命图谱，共 0 项。',                    // 只有 /生命图谱/ 接得住
  '本次请求未检测到任何条目。',                   // 只有 /未检测到任何…条目/ 接得住
  '解析完成，但无法提取有效节点。',               // 只有 /无法提取…节点/ 接得住
  'Query returned undefined',                     // 只有末尾那条裸值接得住
]) {
  assert.ok(isInternalDiagnostic(s), `换个说法就漏了:${s}`);
}

// ── ② 正常回复不许误伤 ─────────────────────────────────────────────────────
// 这一组是这条测试的重点:判据宁可漏一句,也不能把好好的回答换成「这条没答好」。
for (const s of [
  '识别到：黑色钢笔、笔记本\n\n可以继续问我关于这张图的问题。',
  '你 7 月 28 日有三个会：站会、评审、和 Ana 的一对一。',
  '这张图没看清，换个角度再拍一张试试。',
  '冰箱里的黄瓜还有 2 根，周四前用掉比较好。',
  '我把「买咖啡豆」记下来了。',
]) {
  assert.ok(!isInternalDiagnostic(s), `误伤了正常回复:${s}`);
}

// ── ③ 空/空白不算(没有内容就不该冒出一句「这条没答好」)────────────────────
for (const s of ['', '   ', '\n']) assert.ok(!isInternalDiagnostic(s), '空文本被判成了内部诊断');

// ── ④ 渲染那一层真的接上了,而且只对模型说的话生效 ──────────────────────────
// 用户自己完全可以打「生命图谱」这四个字提问 —— 那是正常提问,不该被换掉。
{
  const ui = code(read('components/portal/NesioChatSheet.tsx'));
  assert.ok(/from '@\/lib\/portal\/chat-internal-text'/.test(ui), '聊天面板没引这条判据');
  assert.ok(
    /msg\.role === 'model' && isInternalDiagnostic\(msg\.text\)/.test(ui),
    '判据没绑到 role === \'model\' —— 用户自己打「生命图谱」提问会被当成内部诊断换掉',
  );
  // 换掉的是**显示**,不是存储:万一判重了,原文还得在
  assert.ok(
    !/saveHistory\([^)]*isInternalDiagnostic/.test(ui),
    '不要在存储层改写历史 —— 判重了就再也找不回原文了',
  );
}

console.log('chat-internal-text: OK(认得出 · 不误伤 · 只管模型的话 · 只改显示不改存储)');
