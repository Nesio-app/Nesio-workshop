/**
 * 行为契约:全局「记给某人」(拍一拍入档 1c)。
 * 锁死:matchPerson 跨人名匹配(精确>包含>无);PersonExtractSheet 拍/说→提取→人选→存;
 * 关系 tab 顶部有入口;imageToDataUrl 抽成共享工具(详情页与本 sheet 复用)。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

// ── matchPerson 纯逻辑 ──
const mod = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(new URL('../lib/portal/person-match.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module: mod, exports: mod.exports, String, Array, Object },
);
const { matchPerson } = mod.exports;
const contacts = [{ key: '小美', name: '小美' }, { key: 'libing@x.com', name: '李冰冰' }, { key: 'bob', name: 'Bob' }];
assert.equal(matchPerson('小美', contacts), '小美', '精确名匹配');
assert.equal(matchPerson('李冰冰', contacts), 'libing@x.com', '按名匹配到邮箱 key 的人');
assert.equal(matchPerson('冰冰', contacts), 'libing@x.com', '包含匹配');
assert.equal(matchPerson('libing@x.com', contacts), 'libing@x.com', 'key(邮箱)匹配');
assert.equal(matchPerson('查无此人', contacts), '', '无匹配返回空');
assert.equal(matchPerson('', contacts), '', '空名返回空');

// ── PersonExtractSheet 接线(源码级) ──
const sheet = fs.readFileSync(new URL('../components/portal/relationships/PersonExtractSheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes("fetch('/api/portal/person-extract'"), '调 person-extract');
assert.ok(sheet.includes('matchPerson') && sheet.includes('personKey'), '跨人匹配 + 可选人');
assert.ok(sheet.includes('<select') && sheet.includes('addPersonRecord'), '人选下拉 + 存进档案');
assert.ok(sheet.includes('imageToDataUrl') && sheet.includes("capture=\"environment\""), '照片路径(调摄像头)');
assert.ok(sheet.includes('不上传') || sheet.includes('只存本机'), '本机提示');

// ── 关系 tab 顶部入口 ──
const panel = fs.readFileSync(new URL('../components/portal/relationships/RelationshipsPanel.tsx', import.meta.url), 'utf8');
assert.ok(panel.includes('PersonExtractSheet') && panel.includes('setExtractOpen'), '关系 tab 挂载记给某人 sheet');
assert.ok(panel.includes('记给某人'), '顶部入口按钮');

// ── imageToDataUrl 抽成共享工具,两处复用 ──
const util = fs.readFileSync(new URL('../lib/portal/image-util.ts', import.meta.url), 'utf8');
assert.ok(util.includes('export function imageToDataUrl'), '共享缩图工具');
const hang = fs.readFileSync(new URL('../components/portal/relationships/HangNoteSheet.tsx', import.meta.url), 'utf8');
assert.ok(hang.includes("from '@/lib/portal/image-util'"), '挂一条复用共享缩图工具(不重复实现)');

console.log('person-extract-sheet: OK');
