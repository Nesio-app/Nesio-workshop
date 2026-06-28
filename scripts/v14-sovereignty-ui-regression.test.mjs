import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const cameraSheet = read('components/portal/CameraSheet.tsx');
const memoryTab = read('components/portal/MemoryTab.tsx');
const todayFeed = read('components/portal/TodayFeed.tsx');
const dailyBrief = read('components/portal/DailyBriefCard.tsx');
const lifeState = read('components/portal/LifeStateCard.tsx');
const profileCard = read('components/portal/NesioProfileCard.tsx');
const loginPage = read('components/portal/LoginPageClient.tsx');
const shareSheet = read('components/portal/ShareSheet.tsx');
const nodeDetail = read('components/portal/MemoryNodeDetail.tsx');
const bottomNav = read('components/portal/PortalBottomNav.tsx');
const portal = read('components/portal/Portal.tsx');
const onboarding = read('components/portal/PortalOnboarding.tsx');
const settingsSheets = read('components/portal/SettingsSheets.tsx');
const mirrorProfile = read('components/portal/MirrorProfileCard.tsx');
const lifeGraph = read('lib/portal/life-graph.ts');
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
assert.doesNotMatch(todayFeed, /需要你的输入|还没有足够记忆|告诉 Nesio 一件事|告诉 Nesio 新事情/, 'Today empty state should not sound like a data requirement.');
assert.match(todayFeed, /先放进来一件事就好|从一件小事开始|先记一件事|说一句、拍一下，Nesio 会帮你留到以后找得到/, 'Today empty state should invite one low-pressure first record.');
assert.doesNotMatch(todayFeed, /今天，\$\{cards\.length\} 件事|<h1 className="nesio-today-greeting-title">\{greeting\}，\{displayName\}/, 'Today must not repeat the greeting/name below the daily brief.');
assert.match(todayFeed, /先看最重要的一件|把最该看的放前面/, 'Today greeting should frame attention support instead of repeated salutation.');
assert.doesNotMatch(dailyBrief, /播客/, 'Daily brief action copy should not say podcast on the home surface.');
assert.match(dailyBrief, /听简报|文字简报/, 'Daily brief should use home-appropriate briefing language.');
assert.match(dailyBrief, /href="\/login"[\s\S]*登录后生成/, 'Signed-out daily brief generation must be a real login link, not a disabled button.');
assert.doesNotMatch(dailyBrief, /disabled=\{playState === 'loading' \|\| !canUsePrivateData\}/, 'Signed-out daily brief CTA must not be disabled.');
assert.doesNotMatch(lifeState, /Life State|overallScore|nesio-lifestate-ring-num|偏高|良好|需关注|偏低/, 'Life state card must not expose scoring or evaluative labels.');
assert.match(lifeState, /今天的负荷|事项较多|安排稳定|先看最重要的一件/, 'Life state card should describe workload facts gently.');
assert.doesNotMatch(domains, /不用翻笔记/, 'Meeting cards should use natural assistant wording, not system-summary language.');
assert.match(domains, /已经整理好了|关键提醒/, 'Meeting cards should explain that key reminders are ready.');
assert.match(memoryTab, /散落的线索，回头找得到|重要的事，慢慢连起来/, 'Memory title should use sovereignty-oriented retrieval language.');
assert.doesNotMatch(memoryTab, /你的生活，连成一张图|Life Graph|识别图中/, 'Memory copy must avoid omniscient graph or machine-task phrasing.');
assert.doesNotMatch(memoryTab, /登录后查看你的 Memory|去登录|接入 Gmail/, 'Memory empty state should not force login or early Gmail connection.');
assert.match(memoryTab, /这里会放你以后想找回的东西|娃娃在蓝盒子里|上次买的药|Jim 的会议提醒|放进来第一件|登录同步/, 'Memory empty state should prioritize local-first value before login sync.');
assert.doesNotMatch(memoryTab, /aria-label="语音问宝盒"|nesio-memory-search-voice/, 'Memory search should stay focused on typed retrieval; voice ask belongs to the center N long press.');
assert.match(bottomNav, /onPointerDown=\{startLongPress\}[\s\S]*长按提问/, 'Center N button must expose long-press ask behavior.');
assert.match(portal, /onAsk=\{\(\) => \{[\s\S]*setCaptureMode\('voice'\)/, 'Portal must route center N long press to the voice ask surface.');
assert.match(portal, /nesio-memory-received[\s\S]*收好了，以后可以找回来|MemoryReceipt/, 'Portal must show a calm receipt animation after the first user record.');
assert.match(portal, /onboardingActive[\s\S]*!\s*onboardingActive[\s\S]*<TodayFeed/s, 'Portal must hide private Today surfaces while first-login onboarding is visible.');
assert.match(onboarding, /nesio-onboarding-visibility-change/, 'Onboarding must notify Portal so the private background layer can be hidden.');
assert.doesNotMatch(profileCard, /已整理|已使用第|daysUsed/, 'Profile summary must not foreground usage-day counters.');
assert.match(profileCard, /api\/auth\/logout|退出登录/, 'Profile/settings surface must expose a logout action when signed in.');
assert.match(loginPage, /注册|Create account|发送注册链接|sign-up/, 'Login page must expose a create-account path.');
assert.match(shareSheet, /你分享进来的内容[\s\S]*可确认的信息/, 'Share sheet should say user-shared content is organized into confirmable information.');
assert.match(domains, /确认，放到门口/, 'Domain actions should read as user confirmation, not AI obedience.');

assert.doesNotMatch(settingsSheets, /像朋友一样|Moment|Today Feed 的卡片会按此过滤|按能力层计费|Remember|Understand|Steer|Operate|Future Steering|Mirror Profile|全自动 Life Graph|API 接入/, 'Settings sheets should use user-sovereignty copy instead of internal product or SaaS terms.');
assert.match(settingsSheets, /只整理你放进来的内容|哪些内容不会被使用|主动提醒|保持安静|选中的生活空间，会优先出现在 Today|先记住|帮你理解|主动提醒|家庭与自动化/, 'Settings sheets should expose trust, quiet mode, spaces, and user-value subscription copy.');
assert.doesNotMatch(mirrorProfile, /Nesio 学到了什么|你最在意的领域|100%|Math\.round\(weight \* 100\)|Math\.round\(g\.score \* 100\)/, 'Mirror profile must avoid surveillance-like learning titles and percentage scores.');
assert.match(mirrorProfile, /Nesio 目前怎么理解你|经常出现|不再这样理解我|基于 \{profile\.feedbackCount\} 次反馈/, 'Mirror profile should show editable observations with evidence.');
assert.match(lifeGraph, /nesio-memory-received/, 'Life Graph should emit a user-record receipt event for calm feedback.');
assert.match(settingsSheets, /触感反馈|细微音效/, 'Settings should let users control haptics and subtle sounds.');

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
