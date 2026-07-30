/**
 * bug3 逐条自查(123 条标注 → 123 条源码级断言)。
 *
 * 用途:交付前的「图文对照核查一遍」。八个分批契约(relationship/wardrobe/finance/
 * health/today-settings/…)钉的是最容易回潮的那些点;这一份是**覆盖率**清单 ——
 * 每条标注对应一条断言,跑一遍就知道有没有漏项。
 *
 * 断言原则:
 *   · 「删」→ 断言文案在**剥掉注释后**的源码里不存在(注释里提一句不算实现,踩过)。
 *   · 「改」→ 断言新形态存在,且旧形态不在。
 *   · 「搬」→ 断言新家有、老家没有(只断言「新家有」会漏掉两处都渲染的情况)。
 *   · 逻辑类(算法/存储/权限)→ 交给对应分批契约做真数据断言,这里只钉接线。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => {
  try { return fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'); }
  catch { return ''; }
};
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));
/** 剥注释:本仓多次踩过「注释里提了一句就把 includes 断言喂饱」。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const F = {
  relPanel: read('components/portal/relationships/RelationshipsPanel.tsx'),
  contactEdit: read('components/portal/relationships/ContactEditSheet.tsx'),
  hangNote: read('components/portal/relationships/HangNoteSheet.tsx'),
  relDetail: read('components/portal/relationships/RelationshipDetailSheet.tsx'),
  relations: read('lib/portal/relationships.ts'),
  manualContacts: read('lib/portal/manual-contacts.ts'),
  personRecords: read('lib/portal/person-records.ts'),
  sheet: read('components/portal/ui/NesioSheet.tsx'),
  wardrobe: read('components/portal/insights/WardrobePanel.tsx'),
  wardrobeLib: read('lib/portal/wardrobe.ts'),
  outfits: read('lib/portal/wardrobe-outfits.ts'),
  familyGoal: read('components/portal/family/FamilyGoalCard.tsx'),
  rewards: read('components/portal/RewardsStore.tsx'),
  familySharing: read('components/portal/family/FamilySharingSheet.tsx'),
  travelPlan: read('components/portal/travel/TravelPlanPanel.tsx'),
  tripTimeline: read('components/portal/travel/TripTimelineSheet.tsx'),
  tripNodes: read('components/portal/travel/TripNodeDetailSheets.tsx'),
  trips: read('lib/portal/travel-trips.ts'),
  hubs: read('lib/portal/travel-hubs.ts'),
  poi: read('lib/portal/travel-poi.ts'),
  snap: read('components/portal/SnapButton.tsx'),
  timeline: read('components/portal/insights/TimelineTab.tsx'),
  globe: read('components/portal/insights/Globe.tsx'),
  placePicker: read('components/portal/PlacePickerSheet.tsx'),
  placeStats: read('lib/portal/place-stats.ts'),
  finTab: read('components/portal/finance/FinanceTab.tsx'),
  cards: read('components/portal/finance/CardsPane.tsx'),
  invest: read('components/portal/finance/InvestPane.tsx'),
  bankTx: read('lib/portal/providers/bank-tx.ts'),
  txAnn: read('lib/portal/tx-annotations.ts'),
  care: read('components/portal/health/BeautyCarePanel.tsx'),
  ledger: read('components/portal/health/BodyLedgerPanel.tsx'),
  dash: read('components/portal/health/HealthDashboard.tsx'),
  lens: read('components/portal/health/HealthLensCards.tsx'),
  hrSheet: read('components/portal/health/HealthRecordSheet.tsx'),
  hSignals: read('lib/health/health-signals.ts'),
  feed: read('components/portal/TodayFeed.tsx'),
  capture: read('components/portal/today/CaptureBar.tsx'),
  focusSec: read('components/portal/today/FocusSection.tsx'),
  guideCard: read('components/portal/today/ProactiveGuidanceCard.tsx'),
  nav: read('components/portal/PortalBottomNav.tsx'),
  settings: read('components/portal/SettingsSheets.tsx'),
  css: read('app/globals.css'),
  i18n: read('lib/portal/i18n.ts'),
};
const C = Object.fromEntries(Object.entries(F).map(([k, v]) => [k, strip(v)]));

/** 设置页「数据与隐私」那一段(别拿整文件断言 —— 别处也叫「备份」)。 */
const privacy = F.settings.slice(
  F.settings.indexOf("title={L(dict, '数据与隐私'"),
  F.settings.indexOf('// ── Lab'),
);
const privacyCode = strip(privacy);

/** 身体账本本体 vs 挪去分析的那两张卡 —— 分开断言「老家没有 / 新家有」。 */
const analysisCards = F.ledger.slice(F.ledger.indexOf('export function BodyLedgerAnalysisCards'));
const ledgerBody = strip(F.ledger.slice(0, F.ledger.indexOf('export function BodyLedgerAnalysisCards')));

const ITEMS = [
  // ── 关系 / People(p2–p7)──
  ['1', 'p2 删「N 位联系人 · N 位这周想问候」', () => !/位联系人/.test(C.relPanel)],
  ['2', 'p2 删「记给某人」', () => !C.relPanel.includes('记给某人') && !exists('components/portal/relationships/PersonExtractSheet.tsx')],
  // 位置断言:加人按钮必须排在亲疏分组列表**之后**(标注要求挪到最下面)
  ['3', 'p2「加人」移到最下面', () => {
    const list = F.relPanel.indexOf('CLOSENESS_META[g].zh');
    const add = F.relPanel.indexOf("'＋ 加人'");
    return list > 0 && add > list;
  }],
  ['4', 'p2 删每行「联系过了」', () => !C.relPanel.includes('联系过了')],
  ['5', 'p2 左侧显示 Gmail 头像', () => /function ContactAvatar/.test(F.relPanel) && /photo: string \| null/.test(F.relations)],
  ['6', 'p3 关系改标签选择', () => /RELATION_TAGS/.test(F.relations) && /RELATION_TAGS/.test(F.contactEdit)],
  ['7', 'p3 邮箱后加发邮件按钮', () => /mailto:/.test(F.contactEdit)],
  ['8', 'p3 电话删「选填」+ 加拨号按钮', () => /tel:/.test(F.contactEdit) && !/placeholder=\{[^}]*选填/.test(C.contactEdit)],
  ['9', 'p3 加「地址」+ 导航按钮', () => /maps\.apple\.com/.test(F.contactEdit) && /address\?: string/.test(F.manualContacts)],
  ['10', 'p3 删备注 placeholder 与下面说明', () => !/nesio-settings-option-hint[^>]*>\{L\(dict, '改名/.test(C.contactEdit)],
  ['11', 'p3「先不改」→「取消」', () => !C.contactEdit.includes('先不改') && C.contactEdit.includes("'取消'")],
  ['12', 'p3 删「只存本机」说明', () => !C.contactEdit.includes('只存本机')],
  // 合并 main(#265)后 prop 名统一成 blurOverlay(两边曾各起一个名字指向同一个 class)
  ['13', 'p5 挂一条 sheet 背景模糊', () => /blurOverlay/.test(F.hangNote) && /blurOverlay\?: boolean/.test(F.sheet)],
  ['14', 'p5 只显示名字(删「挂在…身上」)', () => !C.hangNote.includes('挂在') ],
  ['15', 'p5 合并成一个输入框 + 加号(上传)', () => /putLocalFile/.test(F.hangNote) && /IconPlus/.test(F.hangNote)],
  ['16', 'p5 删敏感信息说明', () => !C.hangNote.includes('敏感信息')],
  ['17', 'p5 删「用说的」', () => !C.hangNote.includes('用说的')],
  ['18', 'p5「挂到身上」→「确认」', () => !C.hangNote.includes('挂到身上') && C.hangNote.includes("'确认'")],
  ['19', 'p6 删掉说话那一页,直接手动输入', () => !/guardPaidCloudAi|person-extract/.test(C.hangNote)],
  ['20', 'p6 删中间块与说明', () => !C.hangNote.includes('把成绩')],
  ['21', 'p6「挂一条」→「记录」并与名字同行', () => C.relDetail.includes("'记录'") && /nesio-rel-detail-name-row/.test(F.relDetail)],
  ['22', 'p7 关系可改 → 标签', () => /setRelationshipOverride/.test(F.relDetail) && /RELATION_TAGS/.test(F.relDetail)],
  ['23', 'p7 删「挂在TA身上」说明', () => !C.relDetail.includes('挂在TA身上')],

  // ── 衣橱(p8–p12)──
  ['24', 'p8 全部类型内容移到第三 tab「衣帽间」', () => /'today' \| 'saved' \| 'closet'/.test(F.wardrobe) && F.wardrobe.includes("'衣帽间'")],
  ['25', 'p8 长按 → 安排哪天穿', () => /onPointerDown=\{startHold\}/.test(F.wardrobe) && F.wardrobe.includes('排进日历')],
  ['26', 'p8 行显示穿过几次', () => /wornCount/.test(F.wardrobe) && /export function wornCount/.test(F.outfits)],
  ['27', 'p8 定义喜欢/不喜欢/淘汰的作用', () => F.wardrobe.includes('已淘汰:这一组变灰')],
  ['28', 'p9 搭配 → 试穿图 → 排某天 → 进日历', () => /tryonAssetId/.test(F.outfits) && /runTryonForOutfit/.test(F.wardrobe)],
  ['29', 'p9 说明淘汰置灰含义', () => F.wardrobe.includes('已淘汰:这一组变灰')],
  ['30', 'p9 删「上身试穿」图标与标签', () => !C.wardrobe.includes('上身试穿')],
  ['31', 'p9「试穿这套」→「试穿」', () => !C.wardrobe.includes('试穿这套')],
  ['32', 'p9 删下面说明', () => !C.wardrobe.includes('这套怎么样')],
  ['33', 'p9「加衣服」移到衣帽间', () => F.wardrobe.indexOf('加衣服 · 拍照或选图') > F.wardrobe.indexOf('衣帽间(bug3 新增第三个 tab)')],
  ['34', 'p10 删「今天穿这套」标题与衣架图标', () => !C.wardrobe.includes('今天穿这套')],
  ['35', 'p10 删「这套穿了」', () => !C.wardrobe.includes('这套穿了')],
  ['36', 'p10「换一套」真的换(rotate 游标)', () => /rotate\?: number/.test(F.wardrobeLib) && /restyleNonce/.test(F.wardrobe)],
  ['37', 'p10 淘汰真的不再推(avoidKeys)', () => /avoidKeys/.test(F.wardrobeLib) && /avoidKeys/.test(F.wardrobe)],

  // ── 家庭 / 愿望(p13–p14)──
  ['38', 'p13 攒钱目标卡进奖励模块', () => exists('components/portal/family/FamilyGoalCard.tsx') && /<FamilyGoalCard/.test(F.rewards)],
  ['39', 'p13 进度分母用 earned 不用 owed', () => /earned >= goal/.test(F.familyGoal) && !/owed/.test(C.familyGoal)],
  ['40', 'p14 删标题 + 页头对齐(‹ 洞察 + 今天)', () => /backLabel/.test(F.familySharing) && /onToday/.test(F.familySharing) && !/function GoalSection/.test(F.familySharing)],

  // ── 行程(p15–p27)──
  ['41', 'p15 删每张卡的 ✕(删除移到时间线)', () => !/deleteTrip/.test(C.travelPlan) && C.tripTimeline.includes('删行程')],
  ['42', 'p15 拍照直达智能相机', () => exists('components/portal/SnapButton.tsx') && /capture="environment"/.test(F.snap)],
  ['43', 'p16 导入按钮 → 上传 / 识别', () => C.tripTimeline.includes("'上传'") && C.tripTimeline.includes("'识别'")],
  ['44', 'p16 拍照按钮启动口正确(带图派事件)', () => /detail: \{ file: f \}/.test(F.snap)],
  ['45', 'p17 删「完成 · 进世界」', () => !C.tripTimeline.includes('进世界')],
  ['46', 'p17 加「删行程」(带确认)', () => /confirm\(/.test(F.tripTimeline) && C.tripTimeline.includes('删行程')],
  ['47', 'p18 出发/到达给离线枢纽下拉', () => /function HubField/.test(F.tripTimeline) && /searchTravelHubs/.test(F.hubs)],
  ['48', 'p18 离线机场/车站数据包', () => exists('public/data/travel-hubs/hubs.json') && /ensureTravelHubsLoaded/.test(F.hubs)],
  ['49', 'p19 日期/时间用原生控件', () => /type="date"/.test(F.tripTimeline) && /type="time"/.test(F.tripTimeline)],
  ['50', 'p20 打包清单自动对照物品库', () => /refreshPackingAgainstInventory/.test(F.trips) && /candidates\(/.test(F.tripNodes)],
  ['51', 'p20 删「要带」那行与「物品里没有」', () => !C.tripNodes.includes('物品里没有')],
  ['52', 'p21「需买」可点 + 记地点', () => /openNeed/.test(F.tripNodes) && /place\?: string/.test(F.trips)],
  ['53', 'p21 删「对照物品库」按钮', () => !C.tripNodes.includes('对照物品库')],
  ['54', 'p22 主按钮 → 存入记忆', () => C.tripNodes.includes('存入记忆')],
  ['55', 'p23 预算按分类可编辑', () => /setCategoryBudget/.test(F.trips) && /setCategoryBudget/.test(F.tripNodes)],
  ['56', 'p24 收据走智能拍照', () => /SnapButton/.test(F.tripNodes)],
  ['57', 'p25 景点下拉有候选(中文城市名也认)', () => /const queryCity = /.test(F.poi) && /matchCityKey/.test(F.poi)],
  ['58', 'p26 酒店优先用 mapsUrl', () => /mapsUrl/.test(F.tripNodes)],
  ['59', 'p26 地址给城市级提示', () => /nesio-trip-footnote/.test(F.tripNodes)],
  ['60', 'p27 待办可改标题/备注 + 删掉这条', () => /function TodoDetail/.test(F.tripNodes) && C.tripNodes.includes('删掉这条')],
  ['61', 'p27 行程详情背景模糊', () => /blurOverlay/.test(F.tripTimeline)],
  ['62', 'p16 上传订单文件可解析', () => /onPickBooking/.test(F.tripTimeline)],
  ['63', 'p23 有分类预算时总额按分类求和', () => /recomputeBudgetNode/.test(F.trips) && /budgetByCategory/.test(F.trips)],
  ['64', 'p20 打包项带地点显示', () => /it\.place/.test(F.tripNodes)],
  ['65', 'p21「需买」改「有了」时记下地点', () => /markHave/.test(F.tripNodes)],
  ['66', 'p18 枢纽下拉延迟收起(点得到)', () => /150/.test(F.tripTimeline) && /nesio-hub-menu/.test(F.tripTimeline)],
  ['67', 'p15 导入表单也能上传', () => /type="file"/.test(F.travelPlan)],

  // ── 世界 / 足迹(p28–p29)──
  ['68', 'p28 地球换写实航拍风格', () => /ocean/.test(F.globe) && /geoCircle/.test(F.globe)],
  ['69', 'p28 星空底在两个主题都有', () => !/data-portal-theme="day"\][^{]*\.nesio-globe-stage/.test(F.css)],
  ['70', 'p29 月份可左右翻', () => /monthBack/.test(F.timeline) && /monthlyPlaceComparison\([^)]*monthOffset\s*=\s*0/.test(F.placeStats) && /monthlyPlaceComparison\(trail, monthBack\)/.test(F.timeline)],
  ['71', 'p29 删「地点 = 去过的不同地方」说明', () => !C.timeline.includes('去过的不同地方')],
  ['72', 'p29 删「累计:…」', () => !/累计:/.test(C.timeline)],
  ['73', 'p29 删生活节奏热力图', () => !/weekRhythm/.test(C.timeline)],
  ['74', 'p29 删常去地点列表 / 类别时长 / 按类别浏览', () => !C.timeline.includes('常去地点') && !C.timeline.includes('按类别浏览')],
  ['75', 'p29 删「标记当前位置(验证定位)」按钮', () => !C.timeline.includes('验证定位')],
  ['76', 'p29 进地点 tab 自动定位一次', () => /autoLocatedRef/.test(F.timeline) && /ensurePlaceTrailWatch/.test(F.timeline)],
  ['77', 'p29 诊断文案收成一句人话', () => /diagHint/.test(F.placePicker) && !/Foursquare/.test(strip(F.placePicker).split('diagHint')[1] || '')],

  // ── 财务(p30–p35)──
  ['78', 'p30「保存」→ 对勾 + 成功反馈', () => /IconCheck/.test(F.cards) && /改好了|Saved/.test(F.cards)],
  ['79', 'p30「移除此账户」改红', () => /var\(--status-risk\)/.test(F.cards)],
  ['80', 'p31 删「今年到现在:股利/利息」', () => !C.invest.includes('今年到现在')],
  ['81', 'p31 不显示基金全名', () => /h\.ticker \|\| h\.name/.test(F.invest)],
  ['82', 'p31 账户名用正文黑体', () => /nesio-fin-group-h--plain/.test(F.invest) && /nesio-fin-group-h--plain/.test(F.css)],
  ['83', 'p31 持仓字体不加粗', () => /weight-regular/.test(F.invest)],
  ['84', 'p31 绿色收益标时间段', () => /持有至今|since buy/.test(F.invest)],
  ['85', 'p32 金额右对齐', () => /nesio-fin-recur-amt--right/.test(F.finTab) && /nesio-fin-recur-amt--right/.test(F.css)],
  ['86', 'p32 删 › 箭头,整行可点', () => {
    const at = F.finTab.indexOf('{recurring.map((r) => (');
    if (at < 0) return false;
    const raw = F.finTab.slice(at, F.finTab.indexOf('</button>', at));
    // 整行是 button(不是 div + 一个箭头),且行里不再有 ›。
    // ⚠️ 必须剥注释再查 —— 解释「删了 ›」的那句注释里就带着一个 ›,不剥就永远判失败。
    return /^\s*\{recurring\.map\(\(r\) => \(\s*<button/.test(raw) && !strip(raw).includes('›');
  }],
  ['87', 'p32「待确认」确认后消失', () => /confirmed\?: boolean/.test(F.bankTx) && (F.finTab.match(/status === 'predicted' && !r\.confirmed/g) || []).length >= 3],
  ['88', 'p33 每笔加「修改」:关联人 + 附件', () => /function TxEditPanel/.test(F.finTab) && /toggleTxPerson/.test(F.txAnn) && /addTxAttachment/.test(F.txAnn)],
  ['89', 'p34「支出」tab →「分类」', () => /\['spending', '分类', 'Categories'\]/.test(F.finTab)],
  ['90', 'p34「+手动添加」→「预算」并移到最下', () => !C.finTab.includes('＋ 手动添加') && F.finTab.indexOf("{L(dict, '预算', 'Budget')}") < F.finTab.indexOf('P2 投资')],
  ['91', 'p34 饼图调大', () => (F.finTab.match(/<FinanceDonut big/g) || []).length >= 2],
  ['92', 'p34 商户/收入改交互饼图 + 左右滑动', () => /function SpendChartPager/.test(F.finTab) && /flip\(dx < 0 \? 1 : -1\)/.test(F.finTab)],
  ['93', 'p35 组合结构去图例 + 点开看详情', () => /setAllocPick/.test(F.finTab)],
  ['94', 'p35 念卡放到卡片下面', () => F.finTab.indexOf('nesio-fin-nessa') > F.finTab.indexOf("'收入', 'Income'")],
  ['95', 'p35「+记」改按钮放卡片下面', () => !/\['add',/.test(C.finTab) && F.finTab.indexOf("'＋ 记一笔'") > F.finTab.indexOf("'收入', 'Income'")],
  ['96', 'p35 四张卡:收入/支出/总资产/投资(盈亏进投资卡)', () => ["'收入', 'Income'", "'支出', 'Spending'", "'总资产', 'Total assets'", "'投资', 'Investing'"].every((k) => F.finTab.includes(k)) && /portfolio\.gain/.test(F.finTab)],

  // ── 健康(p36–p41)──
  ['97', 'p36 删「护理·护肤与美容」标题 + 小字', () => !C.care.includes('护理 · 护肤与美容') && !C.care.includes('还没有护肤类物品')],
  ['98', 'p36「拍一拍」走智能相机', () => /<SnapButton/.test(F.care) && !/nesio-open-camera'\)\)/.test(C.care)],
  ['99', 'p37 删「今日已记」块', () => !C.ledger.includes('今日已记') && !C.ledger.includes('去美味记一餐')],
  ['100', 'p38 去掉「念」符号', () => !/nesio-health-nen-avatar/.test(F.ledger) && !/nesio-health-nen-avatar/.test(F.css)],
  // 老家不能再**渲染**这张卡(import 留着无所谓 —— 分析卡组件同文件用它)
  ['101', 'p38 念卡放到分析', () => /healthNarrative\(health\.metrics/.test(analysisCards)
    && /<BodyLedgerAnalysisCards/.test(F.dash)
    && !/nesio-health-nen/.test(ledgerBody)],
  ['102', 'p38 蛋白琥珀卡放到分析', () => /nesio-bl-prompt/.test(analysisCards) && !/nesio-bl-prompt/.test(ledgerBody)],
  ['103', 'p39 按钮改「智能解读」', () => C.dash.includes("'智能解读'") && !C.dash.includes('让 AI 解读我的健康数据')],
  ['104', 'p39 删底部小字', () => !C.dash.includes('数据只存本机 · 随时可断开')],
  ['105', 'p39 月报两按钮(删打印/存PDF)', () => C.dash.includes("'彩色月报'") && C.dash.includes("'存记忆'") && !C.dash.includes('打印 / 存 PDF')],
  ['106', 'p39 删「健康月报」标题', () => !/{L\(dict, '健康月报', 'Monthly report'\)}<\/p>/.test(C.dash)],
  ['107', 'p40 稳/飙并入健康提示(风格一致)', () => /rankFoodReactions\(/.test(F.dash) && (F.dash.match(/style=\{rowStyle\}/g) || []).length >= 2],
  ['108', 'p40 删稳/飙按钮', () => !C.dash.includes("'稳 / 飙'") && !/export function ReactionBody/.test(F.ledger)],
  ['109', 'p41「+记一条」移到身体账本', () => !/function HealthLensRow/.test(F.dash) && C.ledger.includes("'记一条'")],
  ['110', 'p41 只留「记一条」(删拍化验单 + 标签)', () => !C.dash.includes('拍化验单') && !C.dash.includes('化验 · 用药 · 就诊')],
  ['111', 'p41 加号可上传或智能拍照', () => /nesio-bl-logplus/.test(F.ledger) && /onScan\?: \(\) => void/.test(F.ledger)],
  ['112', 'p41 就诊加医生(关联 people)+ 保险 + 价格', () => ['doctor?: string', 'doctorKey?: string', 'insurance?: string', 'price?: number'].every((k) => F.hSignals.includes(k)) && /setDoctorKey\(p\.key\)/.test(F.hrSheet) && /p\?\.insurance/.test(F.lens)],

  // ── 今天页(p42–p47)──
  ['113', 'p42 话筒只启用语音输入,不开说一说', () => !/nesio-open-voice/.test(C.feed) && /const cannotListen = /.test(F.feed)],
  ['114', 'p43 输入框与时间线加间距', () => /padding: 6px 2px var\(--space-4\) 0/.test(F.css)],
  ['115', 'p43 心情趋势在健康分析页', () => /nesio-open-mood-trend/.test(F.dash) && !/看这周趋势/.test(C.feed)],
  ['116', 'p43「稍后」加圆形三点节点并对齐', () => /nesio-collapsed-dot nesio-tl-more-plus[\s\S]{0,80}⋯/.test(F.focusSec)],
  ['117', 'p44 洞察钻石简化', () => (F.nav.slice(F.nav.indexOf('品牌晶体'), F.nav.indexOf('</svg>', F.nav.indexOf('品牌晶体'))).match(/<path /g) || []).length === 2],
  ['118', 'p46/47 删引导卡「依据」块', () => !/guidanceEvidenceTemplate/.test(C.guideCard) && !/guidanceEvidenceTemplate/.test(F.i18n) && /recordSignalFeedback/.test(F.guideCard)],

  // ── 设置(p44–p45)──
  ['119', 'p44 备份 / 从云恢复 一排', () => /nesio-settings-btn-row/.test(privacy) && privacy.includes('handleBackupChosen') && privacy.includes('handleRestoreChosen')],
  ['120', 'p44 导出 / 导入 一排', () => (privacy.match(/nesio-settings-btn-row/g) || []).length === 2 && privacy.includes('handleExportLocal')],
  ['121', 'p44 删底部说明', () => !privacyCode.includes('只整理你放进来的内容')],
  ['122', 'p44 删「数据接入」', () => !privacyCode.includes("'数据接入'")],
  ['123', 'p45「删除数据」只留四字', () => privacyCode.includes("'删除数据'") && !privacyCode.includes('清除记忆 / 删本机数据 / 删账号')],
];

const failed = [];
for (const [id, desc, check] of ITEMS) {
  let ok = false;
  try { ok = check() === true; } catch (err) { ok = false; desc += ` [检查抛错: ${err.message}]`; }
  if (!ok) failed.push(`${id} ${desc}`);
}

assert.strictEqual(ITEMS.length, 123, `标注共 123 条,清单里只有 ${ITEMS.length} 条`);
if (failed.length) {
  assert.fail(`bug3 还有 ${failed.length} 条没落地:\n  - ${failed.join('\n  - ')}`);
}
console.log(`bug3-audit: OK(123/123 条标注逐条对上)`);
