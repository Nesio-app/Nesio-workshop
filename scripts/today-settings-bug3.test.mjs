/**
 * 今天页 + 设置 bug3 契约(用户标注 p42–p47 的防回潮锁)。
 *
 * 病根类的两条,最值得钉:
 *   ① 点话筒会弹出「说一句」sheet —— 不是设计,是**兜底路径被当成主路径**:
 *      iOS PWA 上 SpeechRecognition 根本不存在,四条 fallback 全去 dispatch
 *      nesio-open-voice,于是每次点都换页。现在一律给可见失败态 + 落到打字。
 *   ② 「稍后」那一拍缺了时间线圆点 —— 2026-07-29 按「入口不是事件」删掉了,
 *      结果这一行比上面每一拍都往左突出;标注明确要求补回「圆形中间三个点」。
 * 其余是删/并排:引导卡依据块、设置页四处。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── ① 话筒只做语音输入,不开「说一句」sheet ──
const feed = read('components/portal/TodayFeed.tsx');
const feedCode = strip(feed);
assert.ok(!/nesio-open-voice/.test(feedCode),
  '话筒的任何分支都不许再派 nesio-open-voice —— 那就是标注说的「打开原来的说一说」');
assert.ok(/const cannotListen = /.test(feed), '听不了要走统一的可见失败态(cannotListen)');
assert.ok(/setMicErr\(/.test(feed) && /micError=\{micErr\}/.test(feed),
  '失败原因要传到输入条上显示出来(红线:异步动作必须有可见失败态)');
assert.ok(/quickInputRef\.current\?\.focus\(\)/.test(feed),
  '听不了要把光标落进输入框 —— 让人能直接打字,而不是换页');
const bar = read('components/portal/today/CaptureBar.tsx');
assert.ok(/capture\.micError/.test(bar) && /role="alert"/.test(bar), '输入条要渲染话筒失败提示,且是 role=alert');

// ── ② 「稍后」那一拍的时间线圆点(圆圈 + 三个点)+ 与文字对齐 ──
const focus = read('components/portal/today/FocusSection.tsx');
const later = focus.slice(focus.indexOf('nesio-tl-more'), focus.indexOf('nesio-tl-fold'));
assert.ok(/nesio-collapsed-dot nesio-tl-more-plus/.test(later),
  '「稍后 · 还有 N 件小事」左边必须有时间线圆点(⋯ 圈),否则这一行会比上面每拍都往左突出');
assert.ok(/⋯/.test(later), '圆点里是三个点(标注:圆形中间三个点的符号)');
const css = read('app/globals.css');
assert.ok(/\.nesio-tl-more-plus \{[\s\S]*?place-items: center/.test(css), '⋯ 必须在圈里居中');

// ── ③ 输入框和时间线之间要有空间 ──
const capBlock = css.slice(css.indexOf('.nesio-tl-capture {'), css.indexOf('.nesio-tl-capture-pill'));
assert.ok(/padding: 6px 2px var\(--space-4\) 0/.test(capBlock),
  '输入条下内边距要拉开(标注:输入框和时间线中间增加空间,现在太挤了)');

// ── ④ 洞察钻石简化 ──
const nav = read('components/portal/PortalBottomNav.tsx');
const dAt = nav.indexOf('品牌晶体');
assert.ok(dAt > 0, '找不到洞察图标锚点 —— 测试锚点失效,请更新此测试');
const diamond = nav.slice(dAt, nav.indexOf('</svg>', dAt));
const paths = diamond.match(/<path /g) || [];
assert.ok(paths.length === 2, `钻石只留外轮廓 + 一条腰线(2 条 path),现在有 ${paths.length} 条`);
assert.ok(!/M9 3 7\.5 8 12 21/.test(diamond), '两条斜切面线已删 —— 22px 图标里它们只会糊成一团');

// ── ⑤ 引导卡「依据」块删除(数据保留,只删 UI)──
const card = read('components/portal/today/ProactiveGuidanceCard.tsx');
const cardCode = strip(card);
assert.ok(!/guidanceEvidenceTemplate/.test(cardCode), '「依据 ▸ N 条」展开块已按标注删除');
assert.ok(!/evidenceOpen/.test(cardCode), '展开状态一并删掉,不留孤儿 state');
assert.ok(!/guidanceEvidenceTemplate/.test(read('lib/portal/i18n.ts')), '对应的 i18n 键也要清掉,不留死文案');
// 数据不能跟着删:反馈环靠 evidenceSignalIds
assert.ok(/evidence\?: EvidenceRef\[\]/.test(read('components/portal/today/proactive-types.ts')),
  'card.evidence 字段要保留 —— 删的是展示,不是数据(evidenceSignalIds 还要喂反馈环)');
assert.ok(/recordSignalFeedback/.test(card), '反馈环仍要在(证据 UI 删了,学习不能跟着停)');

// ── ⑥ 心情趋势在健康分析页(bug2 已做,这里只是别让它漂回今天页)──
assert.ok(/nesio-open-mood-trend/.test(read('components/portal/health/HealthDashboard.tsx')),
  '「看这周趋势」入口必须在健康页(情绪卡上)');
assert.ok(!/看这周趋势/.test(feedCode), '今天页不许再挂「看这周趋势」入口');

// ── ⑦ 设置 · 数据与隐私 ──
const set = read('components/portal/SettingsSheets.tsx');
const setCode = strip(set);
const privacy = set.slice(set.indexOf("title={L(dict, '数据与隐私'"), set.indexOf('// ── Lab'));
const privacyCode = strip(privacy);
assert.ok(!privacyCode.includes("'数据接入'"), '「数据接入」小标题已按标注删除');
assert.ok(!privacyCode.includes('只整理你放进来的内容'), '底部那段说明已按标注删除');
assert.ok(!privacyCode.includes('清除记忆 / 删本机数据 / 删账号'), '「删除数据」的副标题已删,只留四个字');
assert.ok(privacyCode.includes("'删除数据'"), '「删除数据」四个字要留着');
assert.ok(!privacyCode.includes('导出全部(记忆 + 学到的偏好,下载 JSON)'), '并排后按钮上只留动词');
// 备份/从云恢复、导出/导入各成一排
const rows = privacy.match(/nesio-settings-btn-row/g) || [];
assert.ok(rows.length === 2, `要有两排成对按钮(备份/恢复 · 导出/导入),现在 ${rows.length} 处`);
assert.ok(/\.nesio-settings-btn-row \{[\s\S]*?display: flex/.test(css), '成对按钮排要有对应样式');
// 两排里的四个按钮都还接着原来的处理函数(别把功能一起排版掉了)
for (const fn of ['handleBackupChosen', 'handleRestoreChosen', 'handleExportLocal', 'importRef.current?.click()']) {
  assert.ok(privacy.includes(fn), `并排之后 ${fn} 必须还接着 —— 排版不许把功能弄掉`);
}
assert.ok(!privacyCode.includes('nesio-settings-inline-link'), '原来的文字链版本已被并排按钮取代');
void setCode;

console.log('today-settings-bug3: OK');
