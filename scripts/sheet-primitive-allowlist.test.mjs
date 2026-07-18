/**
 * 行为契约:NesioSheet 原语白名单(模态语义单源,2026-07-18 施工单 W4)。
 *
 * 迁移目标:所有 sheet/modal 的「模态语义」(aria-modal / role="dialog")只准由
 * 一个地方铸造 —— `components/portal/ui/NesioSheet.tsx` 原语(焦点陷阱自持 aria-modal、
 * Vaul/Radix 提供 role="dialog")。原语之外每一处手写的 aria-modal / role="dialog"
 * 都是「尚未迁移」或「明确豁免」的旧壳,必须登记在 ALLOWLIST 里。
 *
 * 锁死:
 *  ① 原语之外不得出现白名单外的新模态标记(逼新面板走 NesioSheet,而不是再自写一个);
 *  ② 计数不得膨胀(同一文件里新增一处手写模态标记 → 红);
 *  ③ 白名单不得腐化(某文件已迁完、模态标记归零 → 必须把它从 ALLOWLIST 摘除);
 *  ④ 原语本体必须仍自持模态语义(焦点陷阱 setAttribute aria-modal),不得被改回「撒谎壳」。
 *
 * 迁移一个 sheet 到 NesioSheet 后:它的手写标记会减少/归零 → 按 ③ 把对应条目降数/摘除。
 * 新增合法的手写模态点(或新豁免)时:先确认确实无法走原语,再登记进 ALLOWLIST。
 *
 * 注:workshop(lab)比 nesio(产品)多若干实验面板(Tesla/Wechat/fitness/Montage/
 * NotePanel/PreviewGuides/ConnectorsHub 等)——ALLOWLIST 因此比 nesio 长,这是预期漂移。
 *
 * 复用 dangerous-html-allowlist.test.mjs 的四断言模式。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;

/** 唯一合法的模态语义来源;从扫描中排除,单独在断言 ④ 校验。 */
const PRIMITIVE = 'components/portal/ui/NesioSheet.tsx';

/**
 * file(相对根) → 允许的手写模态标记出现次数(regex 匹配数,非行数)。
 * 每一项都是一个「尚未迁 NesioSheet」或「明确豁免」的旧壳。迁完即降数/摘除。
 *
 * 豁免(短期不迁):Camera/Barcode(实时相机取景,react-remove-scroll 干扰手势先例)。
 * 其余为叠放组 / 多子 sheet / 带嵌套子 sheet 的复杂件,待整组一起迁(见 STATE.md 欠账)。
 */
const ALLOWLIST = new Map([
  ['components/portal/BarcodeScanSheet.tsx', 2],
  ['components/portal/CameraSheet.tsx', 2],
  ['components/portal/ConnectorsHub.tsx', 2],
  ['components/portal/DailyBriefSheet.tsx', 2],
  ['components/portal/EmailComposeSheet.tsx', 2],
  ['components/portal/InstallPrompt.tsx', 1],
  ['components/portal/MemoryNodeDetail.tsx', 6],
  ['components/portal/MoodSheet.tsx', 10],
  ['components/portal/NesioChatSheet.tsx', 3],
  ['components/portal/NotePanelEnhanced.tsx', 1],
  ['components/portal/PlacesShareSheet.tsx', 2],
  ['components/portal/Portal.tsx', 2],
  ['components/portal/PortalOnboarding.tsx', 4],
  ['components/portal/PreviewGuidesSheet.tsx', 2],
  ['components/portal/SettingsSheets.tsx', 2],
  ['components/portal/TellNesioSheet.tsx', 2],
  ['components/portal/TeslaSheet.tsx', 2],
  ['components/portal/TodayFeed.tsx', 2],
  ['components/portal/ToolsTreasureSheet.tsx', 1],
  ['components/portal/VoiceInputSheet.tsx', 4],
  ['components/portal/WechatReadingImportSheet.tsx', 2],
  ['components/portal/fitness/ExerciseLibrary.tsx', 2],
  ['components/portal/fitness/WorkoutPlayer.tsx', 2],
  ['components/portal/insights/MirrorLetterTab.tsx', 1],
  ['components/portal/insights/MontageTab.tsx', 2],
  ['components/portal/insights/TimelineTab.tsx', 4],
  ['components/portal/relationships/RelationshipDetailSheet.tsx', 2],
]);

const SCAN_DIRS = ['app', 'components', 'lib'];
const MARKER = /aria-modal|role=["']dialog["']/g;
const found = new Map();

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { scan(full); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
    const rel = path.relative(root, full);
    if (rel === PRIMITIVE) continue; // 原语单独校验(断言 ④)
    const count = (fs.readFileSync(full, 'utf8').match(MARKER) || []).length;
    if (count > 0) found.set(rel, count);
  }
}
for (const d of SCAN_DIRS) scan(path.join(root, d));

// ① 原语之外无白名单外的新模态标记;② 计数不膨胀
for (const [file, count] of found) {
  const allowed = ALLOWLIST.get(file);
  assert.ok(
    allowed !== undefined,
    `${file} 出现未登记的手写模态标记(aria-modal / role="dialog")—— 新面板请走 NesioSheet 原语;` +
    `确实无法走原语时,再登记进本测试 ALLOWLIST 并说明原因`,
  );
  assert.ok(
    count <= allowed,
    `${file} 的手写模态标记从 ${allowed} 处增至 ${count} 处 —— 别再自写模态壳,走 NesioSheet`,
  );
}

// ③ 白名单不得腐化:迁完(标记归零)的文件必须摘除登记
for (const [file] of ALLOWLIST) {
  assert.ok(
    found.has(file),
    `${file} 已无手写模态标记(大概率已迁 NesioSheet)—— 请把它从 ALLOWLIST 摘除`,
  );
}

// ④ 原语本体仍自持模态语义(焦点陷阱真实 setAttribute aria-modal,不是「撒谎壳」)
const primitive = fs.readFileSync(path.join(root, PRIMITIVE), 'utf8');
assert.match(
  primitive,
  /setAttribute\('aria-modal', 'true'\)/,
  'NesioSheet 原语必须在焦点陷阱里真实置 aria-modal=true(单源模态语义)',
);
assert.match(
  primitive,
  /useFocusTrap/,
  'NesioSheet 原语必须自持 useFocusTrap(库的焦点管理在本栈不可靠,原语兜底)',
);

console.log('sheet-primitive-allowlist contract passed');
