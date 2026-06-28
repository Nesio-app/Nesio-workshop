import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const cameraSheet = read('components/portal/CameraSheet.tsx');
const memoryTab = read('components/portal/MemoryTab.tsx');
const todayFeed = read('components/portal/TodayFeed.tsx');
const profileCard = read('components/portal/NesioProfileCard.tsx');
const shareSheet = read('components/portal/ShareSheet.tsx');
const nodeDetail = read('components/portal/MemoryNodeDetail.tsx');
const bottomNav = read('components/portal/PortalBottomNav.tsx');
const portal = read('components/portal/Portal.tsx');
const domains = read('lib/intelligence/domains.ts');
const globals = read('app/globals.css');
const storageCss = read('storage-web/styles.css');

assert.match(
  cameraSheet,
  /phase === 'idle'[\s\S]*nesio-camera-fallback/,
  'Camera idle state must render a visible permission/upload fallback, not an empty shell.',
);
assert.match(
  cameraSheet,
  /先选一张照片|从相册 \/ 文件中选择/,
  'Camera fallback must include an upload alternative for blocked or unsupported camera access.',
);

assert.match(
  globals,
  /@media \(max-width: 340px\)[\s\S]*\.nesio-memory-grid[\s\S]*grid-template-columns:\s*1fr/,
  'Memory grid must collapse to one column at 320px.',
);
assert.match(
  globals,
  /\.nesio-memory-card-title[\s\S]*overflow-wrap:\s*anywhere/,
  'Memory card titles must wrap safely instead of pushing the card outside the viewport.',
);

for (const source of [todayFeed, nodeDetail, profileCard, shareSheet, domains]) {
  assert.doesNotMatch(source, /[0-9]{2,3}%\s*(把握|置信|confidence)|置信度\s*[0-9{]/i, 'User-facing copy must not expose pseudo-precise confidence percentages.');
}
assert.doesNotMatch(todayFeed, /你的生活，连成一张图。|Nesio 已经陪你|正在聆听|自动抽取/, 'Public UI copy should avoid omniscient or over-personified phrasing.');
assert.match(memoryTab, /把散落的生活线索找回来|重要的事，慢慢连起来/, 'Memory title should use sovereignty-oriented retrieval language.');
assert.doesNotMatch(memoryTab, /aria-label="语音问宝盒"|nesio-memory-search-voice/, 'Memory search should stay focused on typed retrieval; voice ask belongs to the center N long press.');
assert.match(bottomNav, /onPointerDown=\{startLongPress\}[\s\S]*长按问宝盒/, 'Center N button must expose long-press ask-Baohe behavior.');
assert.match(portal, /onAsk=\{\(\) => \{[\s\S]*setCaptureMode\('voice'\)/, 'Portal must route center N long press to the voice ask surface.');
assert.match(profileCard, /你已经整理了 \{daysUsed\} 天生活线索/, 'Profile days copy should center user agency.');
assert.match(shareSheet, /你分享进来的内容[\s\S]*可确认的信息/, 'Share sheet should say user-shared content is organized into confirmable information.');
assert.match(domains, /确认，放到门口/, 'Domain actions should read as user confirmation, not AI obedience.');

assert.match(
  storageCss,
  /\.wrow[\s\S]*scroll-padding-inline:[\s\S]*24px/,
  'Storage horizontal rows should reserve edge scroll padding so chips/cards are not clipped.',
);
assert.match(
  storageCss,
  /\.toast[\s\S]*bottom:\s*calc\(112px \+ env\(safe-area-inset-bottom\)\)/,
  'Storage toast should sit above bottom navigation.',
);

console.log('v14 sovereignty/ui regression checks passed');
