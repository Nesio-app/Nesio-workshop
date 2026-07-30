/**
 * 健康 bug3 契约(用户标注 p36–p41 的防回潮锁)。
 *
 * 这一批大半是「删」和「搬」,最容易被下一次改动悄悄搬回去:
 *   ① 删的文案不许回来(护理标题/小字、今日已记、健康月报标题、底部隐私小字)。
 *   ② 搬走的东西必须落在新家:念卡 + 蛋白琥珀卡 → 分析页;记一条 → 身体账本;
 *      稳/飙 → 健康提示(同一种行样式,标注要求「风格一致」)。
 *   ③ 「拍一拍」必须直达智能相机(SnapButton 带图派事件),不能停在选择页。
 *   ④ 就诊多了医生(可关联 People)/保险/价格 —— 存进 payload 且在时间线上看得见,
 *      否则「填了看不见」等于没填。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// 剥注释再查「已删文案」——本仓踩过多次「注释里提了一句就把断言喂饱」。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── ① 护理页:标题 + 空态小字删除;拍一拍直达智能相机 ──
const care = read('components/portal/health/BeautyCarePanel.tsx');
const careCode = strip(care);
assert.ok(!careCode.includes('护理 · 护肤与美容'), '「护理 · 护肤与美容」标题已按标注删除');
assert.ok(!careCode.includes('还没有护肤类物品'), '空态那句小字已按标注删除');
assert.ok(/<SnapButton/.test(care), '「拍一拍」必须走 SnapButton(带图派事件,直达识别),不能只派空的 nesio-open-camera');
assert.ok(!/dispatchEvent\(new CustomEvent\('nesio-open-camera'\)\)/.test(careCode),
  '不许再派不带图的 nesio-open-camera —— 那会停在相机的选择页');

// ── ② 身体账本:今日已记删除;念卡/琥珀卡搬去分析;记一条 + 加号在这里 ──
const bl = read('components/portal/health/BodyLedgerPanel.tsx');
const blCode = strip(bl);
for (const dead of ['今日已记', '去美味记一餐', '蛋白目标会随今日锻炼分钟轻轻上调']) {
  assert.ok(!blCode.includes(dead), `「${dead}」已按标注删除,不许回来`);
}
assert.ok(/export function BodyLedgerAnalysisCards/.test(bl),
  '念卡 + 蛋白琥珀卡必须抽成 BodyLedgerAnalysisCards 供分析页挂载');
// 念符号删掉:账本和分析都不许再渲染那个头像
assert.ok(!/nesio-health-nen-avatar/.test(bl), '「念」符号(头像方块)已按标注删除');
assert.ok(!/nesio-health-nen-avatar/.test(read('app/globals.css')), '「念」头像的 CSS 规则也要跟着清掉,不留死样式');
// 这两块只能在分析页那一个组件里渲染,不能账本再渲染一遍(否则等于没搬)
const analysisCards = bl.slice(bl.indexOf('export function BodyLedgerAnalysisCards'));
assert.ok(/nesio-bl-prompt/.test(analysisCards), '蛋白琥珀卡(nesio-bl-prompt)必须在分析卡组件里');
assert.ok(/healthNarrative/.test(analysisCards), '念卡文字(healthNarrative)必须在分析卡组件里');
const ledgerBody = bl.slice(0, bl.indexOf('export function BodyLedgerAnalysisCards'));
assert.ok(!/nesio-bl-prompt/.test(strip(ledgerBody)), '琥珀卡不许还留在账本本体里 —— 那就不叫「挪到分析」了');
// 记一条 + 加号
assert.ok(blCode.includes("'记一条'"), '「记一条」入口必须落在身体账本');
assert.ok(/nesio-bl-logplus/.test(bl), '「记一条」后面要有一个加号(上传或智能拍照)');
assert.ok(/onScan\?: \(\) => void/.test(bl), '加号要能开拍化验单(里面既能上传也能端上拍照)');

// ── ③ 分析页:智能解读 / 月报两按钮 / 删标题与底部小字 / 稳飙并入健康提示 ──
const dash = read('components/portal/health/HealthDashboard.tsx');
const dashCode = strip(dash);
assert.ok(dashCode.includes("'智能解读'"), '按钮改名「智能解读」');
assert.ok(!dashCode.includes('让 AI 解读我的健康数据'), '「让 AI 解读我的健康数据」已改名,旧文案不许回来');
for (const dead of ['打印 / 存 PDF', '数据只存本机 · 随时可断开', '化验 · 用药 · 就诊', '拍化验单']) {
  assert.ok(!dashCode.includes(dead), `「${dead}」已按标注删除,不许回来`);
}
assert.ok(!/{L\(dict, '健康月报', 'Monthly report'\)}<\/p>/.test(dashCode), '「健康月报」这个标题已删');
assert.ok(dashCode.includes("'彩色月报'") && dashCode.includes("'存记忆'"), '月报只留「彩色月报」「存记忆」两个按钮');
assert.ok(!/function HealthLensRow/.test(dash), '概览页顶上那行记录入口(HealthLensRow)整条已删');
assert.ok(/<BodyLedgerAnalysisCards/.test(dash), '念卡 + 琥珀卡必须挂在分析页');
// 稳/飙:折叠删掉,内容并进健康提示,且两个来源共用同一套行样式
assert.ok(!dashCode.includes("'稳 / 飙'"), '「稳 / 飙」这个折叠按钮已按标注删除');
assert.ok(!/ReactionBody/.test(dash), 'ReactionBody 已不再单独渲染');
assert.ok(!/export function ReactionBody/.test(bl), 'ReactionBody 组件本体已删,不留孤儿');
const findings = dash.slice(dash.indexOf('function FindingsCard'), dash.indexOf('function RiskCard'));
assert.ok(/rankFoodReactions\(/.test(findings), '稳/飙排序必须并进健康提示卡(仍用同一个确定性函数)');
assert.ok((findings.match(/style=\{rowStyle\}/g) || []).length >= 2,
  '指南判定和稳/飙两种行必须共用同一个 rowStyle —— 标注要的是「风格一致」,复制粘贴保不住');
assert.ok(!/'var\(--status-risk\)'/.test(findings.slice(findings.indexOf('reactions.map'), findings.indexOf('findings.map'))),
  '吃饭这类模式观察不许用风险红(红只留给真红旗)');

// ── ④ 就诊:医生(关联 People)/ 保险 / 价格 ──
const sig = read('lib/health/health-signals.ts');
for (const field of ['doctor?: string', 'doctorKey?: string', 'insurance?: string', 'price?: number']) {
  assert.ok(sig.includes(field), `HealthVisitPayload 必须有 ${field}`);
}
const sheet = read('components/portal/health/HealthRecordSheet.tsx');
assert.ok(sheet.includes("'医生'") && sheet.includes("'保险'") && sheet.includes("'价格'"),
  '就诊表单要有医生 / 保险 / 价格三个字段');
assert.ok(/setDoctor\(p\.name\); setDoctorKey\(p\.key\);/.test(sheet),
  '从 People 里挑医生时必须同时记下归一 key,否则关联不回关系页');
assert.ok(/doctorKey: doctorKey \|\| undefined/.test(sheet),
  '手打的名字不许伪造 doctorKey —— 只有真挑过的人才带 key');
const lens = read('components/portal/health/HealthLensCards.tsx');
assert.ok(/p\?\.doctor, p\?\.insurance, money, p\?\.note/.test(lens),
  '就诊时间线要显示医生 / 保险 / 价格 —— 填了看不见等于没填');

console.log('health-bug3: OK');
