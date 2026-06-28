import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const cameraSheet = read('components/portal/CameraSheet.tsx');
const memoryTab = read('components/portal/MemoryTab.tsx');
const todayFeed = read('components/portal/TodayFeed.tsx');
const tellSheet = read('components/portal/TellNesioSheet.tsx');
const voiceSheet = read('components/portal/VoiceInputSheet.tsx');
const dailyBrief = read('components/portal/DailyBriefCard.tsx');
const lifeState = read('components/portal/LifeStateCard.tsx');
const profileCard = read('components/portal/NesioProfileCard.tsx');
const accountSettings = read('components/portal/AccountSettings.tsx');
const loginPage = read('components/portal/LoginPageClient.tsx');
const authStartRoute = read('app/api/auth/start/route.ts');
const analyzeRoute = read('app/api/portal/analyze/route.ts');
const ingestRoute = read('app/api/portal/ingest/route.ts');
const authClient = read('lib/portal/auth-client.ts');
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
  /if \(open\)[\s\S]*startCamera\('environment'\)/,
  'Camera should open the camera directly from the user tap on 拍一下.',
);
assert.doesNotMatch(
  cameraSheet,
  /启动相机/,
  'Camera should not show an extra start-camera intermediate page.',
);
assert.match(
  cameraSheet,
  /先选一张照片|从相册 \/ 文件中选择/,
  'Camera fallback must include an upload alternative for blocked or unsupported camera access.',
);
assert.match(
  cameraSheet,
  /onContextMenu=\{\(e\) => e\.preventDefault\(\)\}|draggable=\{false\}|camera-callout-none/,
  'Camera captured preview must suppress iOS image callout/context menu.',
);
assert.doesNotMatch(
  cameraSheet,
  /存入 Life Graph|已存入 Life Graph/,
  'Camera user-facing copy must say Memory instead of Life Graph.',
);
assert.match(
  cameraSheet,
  /待确认图片线索|登录或 Lab 模式后可自动识别标签|ai_auth_required/,
  'Camera must degrade honestly when AI image analysis is not authorized.',
);
assert.match(
  cameraSheet,
  /#钥匙|#门口|extraTags|parseInlineTags/,
  'Camera result should let users add tags before saving an image clue.',
);
assert.match(
  cameraSheet,
  /x-baohe-access-mode['"]\s*:\s*['"]personal_lab|personal_lab/,
  'Camera image analysis should request lab AI when lab mode is enabled.',
);
assert.match(
  analyzeRoute,
  /ai_auth_required/,
  'Analyze API must not silently run fake image extraction when anonymous AI is blocked.',
);
assert.match(
  analyzeRoute,
  /baohe_auth_access|cookies\.get/,
  'Analyze API should allow real AI for authenticated sessions while anonymous calls remain gated.',
);

assert.match(
  globals,
  /@media \(max-width: 340px\)[\s\S]*\.nesio-memory-grid[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  'Memory grid must keep two compact columns at 320px.',
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
assert.doesNotMatch(todayFeed, /今天有点多，先看最重要的一件。/, 'Today Feed must not hard-code the daily overview sentence outside DailyBriefCard.');
assert.match(dailyBrief, /buildDailyOverview[\s\S]*今天有点多，先看最重要的一件|events\.length|memoryCount/, 'Daily overview should be generated from current user state in DailyBriefCard.');
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
assert.match(memoryTab, /isPrivateExternalNode|visibleMemoryNodes/, 'Memory should show local records while filtering private external calendar/email nodes when signed out.');
assert.doesNotMatch(memoryTab, /setNodes\(\[\]\);\s*return undefined;/, 'Signed-out Memory must not hide local voice/photo/manual records.');
assert.doesNotMatch(memoryTab, /aria-label="语音问宝盒"|nesio-memory-search-voice/, 'Memory search should stay focused on typed retrieval; voice ask belongs to the center N long press.');
assert.match(memoryTab, /showAll|visibleItems|slice\(0,\s*6\)|更多线索/s, 'Memory should show at most six cards first and fold the rest behind a more button.');
assert.match(memoryTab, /deleteLifeNode|左滑删除|长按分享|navigator\.share|clipboard/, 'Memory cards should support left-swipe delete and long-press share.');
assert.doesNotMatch(memoryTab, /nesio-today-header[\s\S]*nesio-memory-brand-icon|aria-label="我的设置"/, 'Memory page should not show the top logo/settings buttons.');
assert.match(todayFeed, /\/icons\/treasurebox\.svg/, 'Today logo should use the transparent SVG asset instead of the light-background PWA icon.');
assert.doesNotMatch(todayFeed, /nesio-today-brand-name">Nesio/, 'Today header should not render the Nesio word next to the logo.');
assert.match(bottomNav, /onPointerDown=\{startLongPress\}[\s\S]*长按提问/, 'Center N button must expose long-press ask behavior.');
assert.match(bottomNav, /draggable=\{false\}|onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/, 'Center N image must suppress iOS image callout/share sheet during long press.');
assert.match(tellSheet, /label:\s*'上传'/, 'Center N third fan action should say 上传, not 分享.');
assert.doesNotMatch(tellSheet, /分享 · 上传|分享<\/span>/, 'Center N fan should not show the word 分享 under the upload action.');
assert.doesNotMatch(tellSheet, /nesio-tell-fan-icon--voice/, 'Center N fan action colors should be consistent; voice should not use a separate blue background.');
assert.match(voiceSheet, /setTimeout\(\(\) => inputRef\.current\?\.focus\(\),\s*120\)/, 'Voice and Ask sheets should focus typed input first.');
assert.match(voiceSheet, /!\s*isAskMode[\s\S]*会议记录/s, 'Meeting recorder entry should be hidden from Ask mode.');
assert.match(voiceSheet, /nesio-ask-answer|我找到了这些可能相关的线索|还没找到相关线索/s, 'Ask mode should show the answer below the input after asking.');
assert.match(portal, /ASK_GUIDE_KEY|setAskGuideOpen\(true\)|问宝盒/, 'Portal must show a first-use ask guide when the center N is long-pressed.');
assert.match(portal, /openAskVoice|setVoiceIntent\('ask'\)[\s\S]*setCaptureMode\('voice'\)/, 'Portal must route center N long press to the voice ask surface after the guide.');
assert.match(portal, /nesio-memory-received[\s\S]*收好了，以后可以找回来|MemoryReceipt/, 'Portal must show a calm receipt animation after the first user record.');
assert.match(portal, /onboardingActive[\s\S]*!\s*onboardingActive[\s\S]*<TodayFeed/s, 'Portal must hide private Today surfaces while first-login onboarding is visible.');
assert.match(onboarding, /nesio-onboarding-visibility-change/, 'Onboarding must notify Portal so the private background layer can be hidden.');
assert.doesNotMatch(profileCard, /已整理|已使用第|daysUsed/, 'Profile summary must not foreground usage-day counters.');
assert.doesNotMatch(profileCard, /className="nesio-profile-name"|<p className="nesio-profile-name">\{displayName\}<\/p>/, 'Profile top should not duplicate the user name next to the avatar.');
assert.match(profileCard, /className="nesio-profile-stat"[\s\S]*aria-label="打开 Nesio 整理出的线索"[\s\S]*scrollIntoView/, 'Profile memory count should open the organized-clues section.');
assert.match(profileCard, /api\/auth\/logout|退出登录/, 'Profile/settings surface must expose a logout action when signed in.');
assert.match(profileCard, /clearProfileIdentity/, 'Profile logout must clear local identity so the old customer name is not shown after sign-out.');
assert.match(profileCard, /loggedIn\?:\s*boolean|Boolean\(d\?\.loggedIn\)/, 'Profile card must use session.loggedIn, not ok, to avoid fake signed-in state.');
assert.match(loginPage, /注册|Create account|发送注册链接|sign-up/, 'Login page must expose a create-account path.');
assert.match(loginPage, /nesio-login-logo-img/, 'Login page must use a non-inverted logo class so the logo is visible on the white card.');
assert.match(authClient, /\/api\/auth\/callback/, 'Login/OAuth helper must redirect through the auth callback route so sessions are created.');
assert.match(authClient, /FALLBACK_AUTH_ORIGIN|treasurebox-nu\.vercel\.app|isLocalShell/, 'Login/OAuth helper must not use localhost callbacks inside the iOS/local shell.');
assert.match(loginPage, /getAuthRedirectTo/, 'Login page should use the shared auth callback helper.');
assert.match(onboarding, /getAuthRedirectTo/, 'First-launch onboarding should use the shared auth callback helper.');
assert.doesNotMatch(onboarding, /redirectTo:\s*window\.location\.href/, 'First-launch onboarding must not send OAuth back to localhost/current page.');
assert.doesNotMatch(loginPage, /redirectTo:\s*window\.location\.origin \+ '\/'/, 'Login/OAuth must not redirect straight to home and skip callback.');
assert.match(loginPage, /provider_not_configured|supabase_otp_failed|auth_start_exception|friendlyAuthError/, 'Login page must show specific account setup/send failures instead of one vague error.');
assert.match(authStartRoute, /auth_start_exception|try\s*\{[\s\S]*const auditId|catch \(err/, 'Auth start route must fail closed with JSON instead of returning an empty 500.');
assert.match(shareSheet, /你分享进来的内容[\s\S]*可确认的信息/, 'Upload sheet should say user-shared content is organized into confirmable information.');
assert.doesNotMatch(shareSheet, /navigator\.share|从系统分享导入|handleAppShare/, 'Upload sheet should not expose the system share action.');
assert.match(domains, /确认，放到门口/, 'Domain actions should read as user confirmation, not AI obedience.');

assert.doesNotMatch(settingsSheets, /像朋友一样|Moment|Today Feed 的卡片会按此过滤|按能力层计费|Remember|Understand|Steer|Operate|Future Steering|Mirror Profile|全自动 Life Graph|API 接入/, 'Settings sheets should use user-sovereignty copy instead of internal product or SaaS terms.');
assert.match(settingsSheets, /只整理你放进来的内容|哪些内容不会被使用|主动提醒|保持安静|选中的生活空间，会优先出现在 Today|先记住|帮你理解|主动提醒|家庭与自动化/, 'Settings sheets should expose trust, quiet mode, spaces, and user-value subscription copy.');
assert.doesNotMatch(mirrorProfile, /Nesio 学到了什么|你最在意的领域|100%|Math\.round\(weight \* 100\)|Math\.round\(g\.score \* 100\)/, 'Mirror profile must avoid surveillance-like learning titles and percentage scores.');
assert.match(mirrorProfile, /Nesio 目前怎么理解你|经常出现|不再这样理解我|基于 \{profile\.feedbackCount\} 次反馈/, 'Mirror profile should show editable observations with evidence.');
assert.match(mirrorProfile, /resetMirrorProfile|setProfile\(getMirrorProfile\(\)\)/, 'Mirror profile clear-understanding button must perform a real local reset.');
assert.match(lifeGraph, /nesio-memory-received/, 'Life Graph should emit a user-record receipt event for calm feedback.');
assert.match(settingsSheets, /触感反馈|细微音效/, 'Settings should let users control haptics and subtle sounds.');
assert.doesNotMatch(accountSettings, /portal-personal-profile-card|portal-personal-profile-main|portal-personal-settings-arrow|accountSettingsHomepage/, 'Advanced settings should not repeat the old "My/Home" identity block.');
assert.match(voiceSheet, /parseInlineTags|stripInlineTags|mergeTags/, 'Voice input should parse inline #tags and remove them from the display text.');
assert.doesNotMatch(voiceSheet, /setTimeout\(startListening,\s*300\)/, 'Voice input must not auto-start recording when opened.');
assert.match(voiceSheet, /setAskResults\(matches\.slice\(0,\s*4\)\)[\s\S]*setText\(''\)/, 'Ask mode should clear the input after each question while keeping the answer visible.');
assert.match(todayFeed, /feedback === 'too_much' \|\| feedback === 'useful' \|\| feedback === 'not_now'/, 'Today not-now feedback should dismiss the card so 稍后 has a visible result.');
assert.match(globals, /@keyframes tellFanIn[\s\S]*from \{ opacity: 0; \}[\s\S]*to\s+\{ opacity: 1; \}/, 'Center N fan animation must not override button transforms.');
assert.match(globals, /nesio-tell-fan-btn--left[\s\S]*rotate\(-10deg\)[\s\S]*nesio-tell-fan-btn--right[\s\S]*rotate\(10deg\)/, 'Center N actions should be positioned as a visible fan.');
assert.match(ingestRoute, /ingest_auth_required|isIngestAllowed|baohe_auth_access|NESIO_STAGE5_INVOCATION_SECRET/, 'Ingest endpoint must fail closed for anonymous public parsing.');

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
