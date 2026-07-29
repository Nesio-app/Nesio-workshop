/**
 * 行为契约:拍一下能不能找回已经记过的东西(lib/portal/photo-recall.ts)。
 *
 * 用户报的原话:「刚存了一个笔,再拍一下就不认识了」。这条路上有两个独立的坑,
 * 修了一个另一个照样让人看到「记忆库里暂时没有找到相关记录」:
 *
 *   ① 长词查短名对不上 ——「黑色钢笔」查不到记忆里那条「笔」。widen() 负责。
 *   ② **零条目不等于零线索** —— 抽取返回 nodes:[] 时,模型往往已经在 summary 里
 *      写了「一支黑色的钢笔」。旧代码见 nodes 为空就连找都不找。chunksOf() 负责
 *      把那句描述切成能查的词块。
 *
 * 这里只测纯函数(widen/chunksOf 的切分口径),召回本身要读本机图谱,交给真机。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { stripComments } from './lib/strip-comments.mjs';

const SRC = fs.readFileSync(new URL('../lib/portal/photo-recall.ts', import.meta.url), 'utf8');
const code = stripComments(SRC);

// ── 两条路都必须跑召回(零条目那条最容易被漏)────────────────────────────────
{
  // 在**原始**源码上数,只排掉 import 行。
  // 剥注释在这里不能用:相册那条 handler 是一整行 JSX,块注释正则会连着吃掉代码
  // (实测把 4 处数成 2 处)。这条断言要的是调用点数量,不怕注释里的同名字符串 ——
  // 下面那条 `recallByRecognition([], summary)` 的形状断言才是真正防伪的那道。
  const chat = fs.readFileSync(new URL('../components/portal/NesioChatSheet.tsx', import.meta.url), 'utf8')
    .split('\n').filter((l) => !/^\s*import\b/.test(l)).join('\n');
  const calls = (chat.match(/recallByRecognition\(/g) || []).length;
  assert.ok(
    calls >= 4,
    `聊天里应有 4 处召回(相册/拍摄 × 有条目/零条目),现在只有 ${calls} 处 —— `
    + '少的那处会让用户看到「记忆库里暂时没有找到相关记录」,而描述里明明写着那个东西',
  );
  // 零条目分支必须拿 summary 去召回,不能传空
  assert.ok(
    (chat.match(/recallByRecognition\(\s*\[\]\s*,\s*(data\.summary|summary)/g) || []).length >= 2,
    '零条目分支必须用 summary 召回(两条路各一处)',
  );
}

// ── chunksOf 必须真的被 recallByRecognition 用上 ──────────────────────────────
// 变异测试抓到的:光测 chunksOf 这个纯函数是不够的 —— 把它从召回里删掉,
// 函数还在、单测还绿,而「零条目用描述召回」这条修复已经死了。
{
  assert.match(
    code, /for \(const chunk of chunksOf\(summary\)\)/,
    'recallByRecognition 没有用 chunksOf 切描述 —— 整段描述直接查几乎必然落空,'
    + '「零条目用描述召回」等于没做',
  );
}

// ── 纯函数 ────────────────────────────────────────────────────────────────────
function loadPure() {
  const start = SRC.indexOf('function widen');
  const end = SRC.indexOf('export function recallByRecognition');
  assert.ok(start > 0 && end > start, 'photo-recall.ts 结构变了,这条测试要跟着改');
  const js = ts.transpileModule(SRC.slice(start, end).replace(/^function widen/m, 'exports.widen = function widen'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, String, Array, Object, RegExp });
  return mod.exports;
}
const M = loadPure();

// ① 长词要能退到短名
{
  const w = M.widen('黑色钢笔');
  assert.ok(w.includes('黑色钢笔'), '原词要留着(最精确)');
  assert.ok(w.includes('钢笔') || w.includes('笔'), '「黑色钢笔」必须能退到「钢笔」/「笔」—— 否则记忆里那条「笔」永远找不到');
  assert.equal(M.widen('').length, 0);
  assert.equal(M.widen('   ').length, 0);
  // 英文按词切,短词不放大(避免 the/and 这类噪声)
  const e = M.widen('black fountain pen');
  assert.ok(e.includes('black fountain pen'));
  assert.ok(e.includes('fountain') && e.includes('pen'));
}

// ② 描述切块 —— 这是「零条目」那条路唯一的线索来源
{
  const c = M.chunksOf('图像显示了一张木桌，上面有一些物品，包括一支黑色的钢笔、一把钥匙，以及一张便签。');
  assert.ok(c.length > 0, '描述必须能切出词块,否则零条目那条路等于没修');
  const joined = c.join('|');
  assert.ok(/钢笔/.test(joined), `切不出「钢笔」——「一支黑色的钢笔」的数量词前缀没剥干净:${joined}`);
  assert.ok(/钥匙/.test(joined), `切不出「钥匙」:${joined}`);
  // 数量词前缀要剥掉,否则 widen 出来的都是「一支黑色的钢笔」这种查不中的长串
  assert.ok(!c.some((x) => /^[一二三四五六七八九十两几数][只支个把条张台部件套双]/.test(x)), `还留着数量词前缀:${joined}`);
  // 太短/太长的块不要(单字噪声、整句)
  assert.ok(c.every((x) => x.length >= 2 && x.length <= 12), `块长度失控:${joined}`);
  // 空描述不许抛
  assert.equal(M.chunksOf('').length, 0);
  assert.equal(M.chunksOf('，。、').length, 0);
}

// ③ 不许悄悄改成上传/云调用 —— 召回是纯本地的
{
  assert.ok(!/fetch\s*\(/.test(code), '召回必须纯本地(读本机图谱),不许发请求');
}

console.log('photo-recall: OK(长词退短名 · 零条目用描述召回 · 纯本地)');
