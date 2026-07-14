/**
 * 行为契约:说一句 → 自动记进某人档案(拍一拍入档 Phase 1·文本)。
 * 锁死:clampRecords 钳制不可信模型输出 —— 只收 6 个合法分类、title 必填、金额仅 spending;
 * 路由走 guardAiRoute + completeText + parseJsonBlock,并进 docs;详情页有说一句→预览→确认保存接线。
 */
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function compile(rel) {
  const src = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const mod = { exports: {} };
vm.runInNewContext(compile('../app/api/portal/person-extract/route.ts'), {
  module: mod, exports: mod.exports, console, JSON, Object, Array, String, Number, Math, Set, RegExp,
  require: () => ({}),
});
const { clampRecords } = mod.exports;
assert.equal(typeof clampRecords, 'function', 'clampRecords 导出');

// ── 钳制:合法 6 类进、金额仅 spending、无 title 丢、非法分类丢 ──
{
  const r = clampRecords({
    personName: '  小美 妹妹  ',
    records: [
      { category: 'achievement', title: ' 期末年级第一 ', date: '2026-06-02' },
      { category: 'medication', title: '氨氯地平', detail: '每天一片,一个月量' },
      { category: 'spending', title: '生日礼物', amount: 600.005 },
      { category: 'health', title: '身高 158', amount: 600 }, // 非 spending 的金额应被丢
      { category: 'bogus', title: '非法分类' },                 // 非法分类丢
      { category: 'achievement' },                              // 无 title 丢
      { category: 'medical', title: '复诊', date: '不是日期' },  // 坏日期丢字段,记录仍保留
    ],
  });
  assert.equal(r.personName, '小美 妹妹', 'personName 去空白');
  const byTitle = Object.fromEntries(r.records.map((x) => [x.title, x]));
  assert.equal(r.records.length, 5, '只留 5 条合法记录(丢非法分类 + 无标题)');
  assert.equal(byTitle['期末年级第一'].category, 'achievement');
  assert.equal(byTitle['期末年级第一'].date, '2026-06-02', '合法日期保留');
  assert.equal(byTitle['氨氯地平'].detail, '每天一片,一个月量', '药物剂量入 detail');
  assert.equal(byTitle['生日礼物'].amount, 600.01, '消费金额保留(两位)');
  assert.equal(byTitle['身高 158'].amount, undefined, '非消费类金额被丢');
  assert.equal(byTitle['复诊'].date, undefined, '坏日期被丢,记录仍在');
}

// 非记录(闲聊)→ 空
{
  const r = clampRecords({ personName: '', records: [] });
  assert.equal(r.records.length, 0, '空记录');
  assert.equal(r.personName, '', '无人名');
}
// 非对象输入不崩
assert.equal(clampRecords(null).records.length, 0, 'null 安全');
assert.equal(clampRecords('x').records.length, 0, '字符串安全');

// ── 路由:guardAiRoute + completeText + parseJsonBlock + 分类白名单(源码级) ──
const route = fs.readFileSync(new URL('../app/api/portal/person-extract/route.ts', import.meta.url), 'utf8');
assert.ok(route.includes("guardAiRoute(req, 'person-extract'"), '走 guardAiRoute(花钱/私密路由)');
assert.ok(route.includes('completeText') && route.includes('parseJsonBlock'), '共享 AI 客户端 + JSON 解析');
assert.ok(route.includes("'achievement'") && route.includes("'medication'"), '分类白名单');
// 照片:接受 image、校验 data:image、限大小、传给 completeText
assert.ok(route.includes('body?.image') && /data:image\\?\/\(png\|jpe\?g\|webp\|gif\)/.test(route), '接受并校验 data:image 照片');
assert.ok(route.includes('8_000_000') || route.includes('8000000'), '照片大小上限(防打爆)');
assert.ok(route.includes('image ? { image }') || route.includes('...(image ? { image }'), '照片传给 completeText');

// ── 共享 AI 客户端加视觉(callClaude 图块 / Gemini inlineData / completeText 透传 image) ──
const aic = fs.readFileSync(new URL('../lib/portal/ai-complete.ts', import.meta.url), 'utf8');
assert.ok(aic.includes('parseDataUrl'), 'data URL 解析');
assert.ok(aic.includes("type: 'image'") && aic.includes("type: 'base64'") && aic.includes('media_type'), 'Claude 图块(base64)');
assert.ok(aic.includes('inlineData') && aic.includes('mimeType'), 'Gemini inlineData');
assert.ok(/completeText[\s\S]{0,400}image\?: string/.test(aic), 'completeText 支持 image 参数');

// docs
const docs = fs.readFileSync(new URL('../docs/api-routes.md', import.meta.url), 'utf8');
assert.ok(docs.includes('/api/portal/person-extract'), 'person-extract 进 api-routes 文档');

// ── 挂一条(说一句→预览→确认保存)源码级 —— 该流程已从详情页抽到 HangNoteSheet ──
const sheet = fs.readFileSync(new URL('../components/portal/relationships/HangNoteSheet.tsx', import.meta.url), 'utf8');
assert.ok(sheet.includes("fetch('/api/portal/person-extract'"), '挂一条调 person-extract');
assert.ok(sheet.includes('pending') && sheet.includes('savePending') && sheet.includes('addPersonRecord'), '预览 → 确认保存入档');
assert.ok(sheet.includes('setErr') && sheet.includes('role="alert"'), 'AI 失败有可见错误态(每个异步动作可见失败)');
// 照片路径:拍/传照片 → 缩图 → 提取
assert.ok(sheet.includes('onPickPhoto') && sheet.includes('imageToDataUrl'), '照片 → 缩图 → 提取');
assert.ok(sheet.includes('photoRef') && sheet.includes("capture=\"environment\""), '拍照入口(调摄像头)');
assert.ok(sheet.includes('doExtract({ image'), '照片走 person-extract');

console.log('person-extract: OK');
