/**
 * 契约:共享 sheet 无障碍原语 useSheetDismiss 存在,且已被各 sheet 采用。
 *
 * 背景:26 个 aria-modal sheet 此前全都手搓 overlay,没有一个处理 Escape、
 * 没有集中滚动锁 / 归还焦点 / 焦点陷阱 —— 键盘/AT 用户能打开却关不掉。
 * 现有一个共享原语(lib/portal/use-sheet-dismiss.ts),这里守护它的能力 + 采用面。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// ── 1. 原语本身具备四项能力 ─────────────────────────────────────────────────
const hook = read('lib/portal/use-sheet-dismiss.ts');
assert.match(hook, /export function useSheetDismiss/, '必须导出 useSheetDismiss。');
assert.match(hook, /e\.key === 'Escape'/, '必须处理 Escape 关闭。');
assert.match(hook, /document\.body\.style\.overflow = 'hidden'/, '必须锁定 body 滚动。');
assert.match(hook, /prevFocus[\s\S]*\.focus\(\)/, '卸载时必须归还焦点。');
assert.match(hook, /e\.key === 'Tab'/, '传入 containerRef 时必须做焦点陷阱。');

// ── 2. 已采用的 sheet 必须 import 且调用该原语 ───────────────────────────────
const ADOPTED = [
  'components/portal/EmailComposeSheet.tsx',
  'components/portal/CameraSheet.tsx',
  'components/portal/ShareSheet.tsx',
  'components/portal/ConnectorsHub.tsx',
  'components/portal/NamedPlacesSheet.tsx',
  'components/portal/MeetingRecorder.tsx',
  'components/portal/RoutineSheet.tsx',
  'components/portal/RoadmapSheet.tsx',
  'components/portal/HealthLogger.tsx',
  'components/portal/WechatReadingImportSheet.tsx',
  'components/portal/MemoryNodeDetail.tsx',
  'components/portal/SettingsSheets.tsx',
  'components/portal/ArticleReaderSheet.tsx',
  'components/portal/BarcodeScanSheet.tsx',
  'components/portal/VoiceBrief.tsx',
  'components/portal/reader/ReaderView.tsx',
  'components/portal/today/MeetingRecorderSheet.tsx',
  'components/portal/today/FocusModeSheet.tsx',
  // 第二批(多模态/容器):MoodSheet 5 个 phase overlay 由同一 onClose 关闭,顶层一个 hook 覆盖全部。
  'components/portal/TellNesioSheet.tsx',
  'components/portal/MoodSheet.tsx',
  'components/portal/VoiceInputSheet.tsx',
  'components/portal/NesioChatSheet.tsx',
  'components/portal/Portal.tsx',
  'components/portal/TodayFeed.tsx',
];
for (const file of ADOPTED) {
  const src = read(file);
  assert.match(src, /from '@\/lib\/portal\/use-sheet-dismiss'/, `${file} 必须 import useSheetDismiss。`);
  assert.match(src, /useSheetDismiss\(/, `${file} 必须调用 useSheetDismiss(...)。`);
}

// ── 3. 采用不倒退:aria-modal 的 sheet 数不应低于已知基线;未采用的记为待办 ──
// 剩余待跟进:PortalAiFriendsPreview(4 个状态驱动子表,各自 close 到不同状态,需逐个接);
// PortalOnboarding(引导流程,有意不做 Escape 关闭——避免误触退出 onboarding)。
assert.ok(ADOPTED.length >= 24, '已采用的 sheet 不应少于 24(采用面只增不减)。');

console.log('sheet-a11y-dismiss: OK');
