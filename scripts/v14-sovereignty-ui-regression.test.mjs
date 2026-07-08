import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const cameraSheet = read('components/portal/CameraSheet.tsx');
const memoryTab = read('components/portal/MemoryTab.tsx');
// Today 表面已按工程 PRD 拆分(容器+today/);契约约束整个表面
const todayFeed = [
  read('components/portal/TodayFeed.tsx'),
  read('components/portal/today/useTodayData.ts'),
  read('components/portal/today/ProactiveGuidanceCard.tsx'),
  read('components/portal/today/FocusSection.tsx'),
  read('components/portal/today/FocusCardDetail.tsx'),
  read('components/portal/today/CalendarCards.tsx'),
  read('components/portal/today/DormantReviewCard.tsx'),
  read('components/portal/today/NightTimeline.tsx'),
  // Today 表面文案已入 i18n 字典(REG-004),文案断言随之覆盖字典
  read('lib/portal/i18n.ts'),
].join('\n');
const tellSheet = read('components/portal/TellNesioSheet.tsx');
const voiceSheet = read('components/portal/VoiceInputSheet.tsx');
const profileCard = read('components/portal/NesioProfileCard.tsx');
const loginPage = read('components/portal/LoginPageClient.tsx');
const authStartRoute = read('app/api/auth/start/route.ts');
const analyzeRoute = read('app/api/portal/analyze/route.ts');
const ingestRoute = read('app/api/portal/ingest/route.ts');
const authClient = read('lib/portal/auth/auth-client.ts');
const shareSheet = read('components/portal/ShareSheet.tsx');
const nodeDetail = read('components/portal/MemoryNodeDetail.tsx');
const bottomNav = read('components/portal/PortalBottomNav.tsx');
const portal = read('components/portal/Portal.tsx');
const onboarding = read('components/portal/PortalOnboarding.tsx');
const settingsSheets = read('components/portal/SettingsSheets.tsx');
const lifeGraph = read('lib/portal/life-graph.ts');
const domains = read('lib/intelligence/domains.ts');
const globals = read('app/globals.css');

// 拍一下 evolved to the native camera input (iOS blocks programmatic
// getUserMedia outside a gesture) — same intent: no two-step launch screen.
assert.match(
  cameraSheet,
  /openNativeCamera|Native camera: opened by a user tap/,
  'Camera should open directly from the user tap on 拍一下 (native input).',
);
assert.doesNotMatch(
  cameraSheet,
  /启动相机/,
  'Camera should not show an extra start-camera intermediate page.',
);
assert.match(
  cameraSheet,
  /先选一张照片|从相册(?: \/ 文件中)?选择/,
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
  /capture="environment"/,
  'Camera fallback file input should prefer the rear camera on mobile instead of a generic picker.',
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
// DailyBriefCard(听简报卡)批次 40 下架后未回归,已作为死组件删除;Today 表面不得再硬编码那句总览。
assert.doesNotMatch(todayFeed, /今天有点多，先看最重要的一件。/, 'Today Feed must not hard-code the daily overview sentence.');
assert.doesNotMatch(domains, /不用翻笔记/, 'Meeting cards should use natural assistant wording, not system-summary language.');
assert.match(domains, /已经整理好了|关键提醒/, 'Meeting cards should explain that key reminders are ready.');
assert.match(memoryTab, /散落的线索，回头找得到|重要的事，慢慢连起来/, 'Memory title should use sovereignty-oriented retrieval language.');
assert.doesNotMatch(memoryTab, /你的生活，连成一张图|Life Graph|识别图中/, 'Memory copy must avoid omniscient graph or machine-task phrasing.');
assert.doesNotMatch(memoryTab, /登录后查看你的 Memory|去登录|接入 Gmail/, 'Memory empty state should not force login or early Gmail connection.');
// 批次 15:搜索占位精简后,本地优先意图由 hero 文案承载(由你放进来,由你随时找回)
assert.match(memoryTab, /这里会放你以后想找回的东西|由你放进来，由你随时找回|回头找得到|放进来第一件|登录同步/, 'Memory empty state should prioritize local-first value before login sync.');
assert.match(memoryTab, /isPrivateExternalNode|visibleMemoryNodes/, 'Memory should show local records while filtering private external calendar/email nodes when signed out.');
assert.doesNotMatch(memoryTab, /setNodes\(\[\]\);\s*return undefined;/, 'Signed-out Memory must not hide local voice/photo/manual records.');
assert.doesNotMatch(memoryTab, /aria-label="语音问宝盒"|nesio-memory-search-voice/, 'Memory search should stay focused on typed retrieval; voice ask belongs to the center N long press.');
assert.match(memoryTab, /showAll|visibleItems|slice\(0,\s*6\)|更多线索/s, 'Memory should show at most six cards first and fold the rest behind a more button.');
assert.match(memoryTab, /deleteLifeNode|左滑删除|长按分享|navigator\.share|clipboard/, 'Memory cards should support left-swipe delete and long-press share.');
assert.doesNotMatch(memoryTab, /nesio-today-header[\s\S]*nesio-memory-brand-icon|aria-label="我的设置"/, 'Memory page should not show the top logo/settings buttons.');
// Logo swapped to the design-system mark (user decision 2026-07-04); intent unchanged: transparent SVG, not the light-background PWA png.
assert.match(todayFeed, /\/assets\/logo\/nesio-mark\.svg/, 'Today logo should use the transparent SVG brand asset instead of the light-background PWA icon.');
assert.doesNotMatch(todayFeed, /nesio-today-brand-name">Nesio/, 'Today header should not render the Nesio word next to the logo.');
// Long-press handler renamed startLongPress → startPress; hint moved to aria-label.
assert.match(bottomNav, /onPointerDown=\{startPress\}/, 'Center N button must expose long-press ask behavior.');
assert.match(bottomNav, /问一问|长按/, 'Center N button must document the long-press ask affordance.');
assert.match(bottomNav, /draggable=\{false\}|onContextMenu=\{\(e\) => e\.preventDefault\(\)\}/, 'Center N image must suppress iOS image callout/share sheet during long press.');
// Fan label evolved 上传 → 分析文件 → 分享(批次 11 用户两次点名要「分享」;
// 原「防与向外分享混淆」的意图改由 ShareSheet 内文案承担)。
assert.match(tellSheet, /label:\s*'分享'/, 'Center N third fan action should say 分享 (batch-11 product decision).');
// Design evolved: 说一句 is the primary capture action and carries an
// explicit accent (accent: true). Guarded intent now: at most ONE accent.
assert.match(tellSheet, /accent: true/, 'Fan actions may accent exactly the primary capture action.');
assert.equal((tellSheet.match(/accent: true/g) || []).length, 1, 'Only one fan action may carry the accent.');
assert.match(voiceSheet, /setTimeout\(\(\) => inputRef\.current\?\.focus\(\),\s*120\)/, 'Voice and Ask sheets should focus typed input first.');
// 2026-07-04 批次 2:说一句 sheet 的会议记录入口按用户指示整体移除(会议记录只从 Today 焦点卡进入);
// 原守护意图「Ask 模式不得出现会议记录入口」由入口不存在自动满足。
assert.doesNotMatch(voiceSheet, /会议记录/, 'VoiceInputSheet must not re-grow a meeting recorder entry (removed per user decision 2026-07-04).');
assert.match(voiceSheet, /nesio-ask-answer|我找到了这些可能相关的线索|还没找到相关线索/s, 'Ask mode should show the answer below the input after asking.');
assert.match(portal, /ASK_GUIDE_KEY|setAskGuideOpen\(true\)|问宝盒/, 'Portal must show a first-use ask guide when the center N is long-pressed.');
assert.match(portal, /openAskVoice|setVoiceIntent\('ask'\)[\s\S]*setCaptureMode\('voice'\)/, 'Portal must route center N long press to the voice ask surface after the guide.');
assert.match(portal, /nesio-memory-received[\s\S]*收好了，以后可以找回来|MemoryReceipt/, 'Portal must show a calm receipt animation after the first user record.');
assert.match(portal, /onboardingActive[\s\S]*!\s*onboardingActive[\s\S]*<TodayFeed/s, 'Portal must hide private Today surfaces while first-login onboarding is visible.');
assert.match(onboarding, /nesio-onboarding-visibility-change/, 'Onboarding must notify Portal so the private background layer can be hidden.');
assert.doesNotMatch(profileCard, /已整理|已使用第|daysUsed/, 'Profile summary must not foreground usage-day counters.');
assert.doesNotMatch(profileCard, /className="nesio-profile-name"|<p className="nesio-profile-name">\{displayName\}<\/p>/, 'Profile top should not duplicate the user name next to the avatar.');
// 批次 6(2026-07-04):右上角从记忆数统计改为「返回今天」——设置页最常见的下一步;
// 洞察入口收敛到主页 logo(todayFeed 断言另行守护)。守住:是真实返回链接,不是死数字。
// 批次 12:文案走 L() 双语,字面随迁移;意图不变——右上角是真实返回链接
assert.match(profileCard, /className="nesio-profile-stat"[\s\S]*返回今天/, 'Profile top-right should be a real back-to-today link.');
assert.doesNotMatch(profileCard, /<MirrorProfileCard embedded \/>\s*<\/div>\s*\{\/\* Menu \*\//, 'Profile page should not show the organized-clues card inline before settings menu.');
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
assert.match(lifeGraph, /nesio-memory-received/, 'Life Graph should emit a user-record receipt event for calm feedback.');
// 批次 1(2026-07-04)把设置文案迁入 i18n 字典,断言连同字典一起检查。
const settingsI18n = read('lib/portal/i18n.ts');
assert.match(settingsSheets + settingsI18n, /触感反馈|细微音效/, 'Settings should let users control haptics and subtle sounds.');
assert.match(voiceSheet, /parseInlineTags|stripInlineTags|mergeTags/, 'Voice input should parse inline #tags and remove them from the display text.');
assert.doesNotMatch(voiceSheet, /setTimeout\(startListening,\s*300\)/, 'Voice input must not auto-start recording when opened.');
// Ask flow rewired through fetchAskResponse (AI ask + fuzzy fallback); still clears input after asking.
assert.match(voiceSheet, /fetchAskResponse[\s\S]*setText\(''\)/, 'Ask mode should clear the input after each question while keeping the answer visible.');
assert.match(voiceSheet, /searchLifeGraphFuzzy/, 'Ask mode should use fuzzy local memory search instead of only exact title search.');
assert.match(voiceSheet, /\/api\/portal\/analyze[\s\S]*type:\s*'ask'[\s\S]*searchLifeGraphFuzzy/, 'Ask mode should try AI semantic search before falling back to local fuzzy search.');
assert.doesNotMatch(voiceSheet, /isAskMode \? '输入完成 · 点「问宝盒」查找线索'/, 'Ask mode should not show the extra duplicate helper line above the answer.');
assert.match(voiceSheet, /text && !isAskMode[\s\S]*识别完成 · 点「告诉 Nesio」保存/, 'Ask mode should not show the non-ask save helper line.');
// TODAY-004 landed: guidance cards carry the feedback row writing back to
// the store the DEC filters on next run.
assert.match(todayFeed, /recordCardFeedback/, 'Today cards must write feedback back so 稍后/不再提醒 has a visible result.');
assert.doesNotMatch(todayFeed, /为什么\{why \? ' ↑' : ' ↓'\}/, 'Today card 为什么 action should not append arrow glyphs.');
// Organized-clues sheet evolved: mirror profile card → InsightsSheet.
assert.match(todayFeed, /onClick=\{[^}]*setMirrorOpen\(true\)[\s\S]*<InsightsSheet/, 'Today logo should open the organized-clues / insights sheet.');
assert.match(globals, /@keyframes tellFanIn[\s\S]*from \{ opacity: 0; \}[\s\S]*to\s+\{ opacity: 1; \}/, 'Center N fan animation must not override button transforms.');
assert.match(globals, /nesio-tell-fan-btn--left[\s\S]*translate\(-1\.45rem,\s*0\.45rem\)[\s\S]*nesio-tell-fan-btn--right[\s\S]*translate\(1\.45rem,\s*0\.45rem\)/, 'Center N actions should be positioned as a visible fan.');
assert.doesNotMatch(globals, /nesio-tell-fan-btn--left[^{]*\{[^}]*rotate|nesio-tell-fan-btn--right[^{]*\{[^}]*rotate/, 'Center N fan icons/text should stay upright, not rotated.');
assert.match(ingestRoute, /ingest_auth_required|isIngestAllowed|baohe_auth_access|NESIO_STAGE5_INVOCATION_SECRET/, 'Ingest endpoint must fail closed for anonymous public parsing.');
assert.match(lifeGraph, /searchLifeGraphFuzzy[\s\S]*rawInput[\s\S]*tags[\s\S]*relations/, 'Life Graph fuzzy search should include raw input, tags, attributes, and relations.');
// Evolved further: the pending image node no longer keeps originalFileName at all.
assert.match(shareSheet, /buildPendingImageParsed[\s\S]*图片线索待确认/, 'Upload image fallback should show a confirmable image clue.');
assert.doesNotMatch(shareSheet, /originalFileName/, 'Pending image clue must not retain the photo filename.');
assert.match(shareSheet, /analyze\('image'[\s\S]*根据这张图片里真实可见的内容/, 'Upload images should call the image analysis path.');
assert.match(shareSheet, /x-baohe-access-mode['"]\s*:\s*['"]personal_lab/, 'Upload image analysis should request lab AI access like the camera path.');
assert.match(shareSheet, /type === 'image' && nodes\.length === 0[\s\S]*ai_image_empty/, 'Upload image should not use the prompt or filename when AI returns no nodes.');
assert.doesNotMatch(shareSheet, /title:\s*nodes\[0\]\?\.name \|\| content\.slice\(0,\s*30\)[\s\S]*file\.name,\s*base64/s, 'Upload image result must not fall back to the raw filename as the recognized title.');
assert.match(globals, /\.nesio-brief-card \{[\s\S]*background:\s*var\(--glass-bg-solid\)/, 'Daily overview card should use the shared glass card background, not a blue gradient.');
// Helpers reordered in the route; assert the three pieces independently.
assert.match(authStartRoute, /sanitizeRedirectTo/, 'Auth start must sanitize redirect URLs.');
assert.match(authStartRoute, /localhost/, 'Auth start must special-case localhost callbacks.');
assert.match(authStartRoute, /\/api\/auth\/callback/, 'Auth start must target the auth callback path.');
assert.match(authClient, /NEXT_PUBLIC_SITE_URL|www\.nesio\.app/, 'Client auth redirect fallback should use the Nesio production origin instead of localhost.');
assert.match(authStartRoute, /www\.nesio\.app\/api\/auth\/callback/, 'Server auth redirect fallback should never return localhost callbacks.');
// Rule REVERSED by a real bug: apex<->www rewriting broke host-only auth
// cookies (UI looked signed out). Callbacks now stay on the caller's host.
assert.match(authStartRoute, /Keep production callbacks on the caller's current host/, 'Auth redirect must document the keep-caller-host rule.');
assert.doesNotMatch(authStartRoute, /hostname = ['"]www\.nesio\.app['"]/, 'Auth redirect must not force-rewrite the callback hostname.');
assert.match(onboarding, /\/api\/auth\/session/, 'Onboarding must read the auth session after OAuth or magic-link callbacks.');
assert.match(onboarding, /nesio-auth-session-imported|nesio-auth-session-ready/, 'Onboarding must react to session import events.');
assert.match(onboarding, /auth_callback_received|session_established|session_imported/, 'Onboarding must treat callback success URLs as authenticated bootstrap candidates.');

console.log('v14 sovereignty/ui regression checks passed');
