// ══════════════════════════════════════════
// DATA SEEDS
// ══════════════════════════════════════════
const SEED_TASKS = [
  {id:1001,text:'🎓 确认 MBA 毕业典礼：登录链接 / 时间 / 着装就绪',priority:'p0',done:false},
  {id:1002,text:'07:30 洗脸：温水冲脸 → 3滴兰蔻粉水拍额头+口周+脖子（两颊严禁清洁剂）',priority:'p0',done:false},
  {id:1003,text:"07:33 保养：小棕瓶眼周 → 眼霜 → SKIN1004白管防晒 → Kiehl\\'s 1号护唇膏",priority:'p0',done:false},
  {id:1004,text:'07:38 防弹咖啡：黑咖啡+1勺MCT油+1块无盐草饲黄油，手持搅拌棒打匀',priority:'p0',done:false},
  {id:1005,text:'两颊涂高饱和 SKIN1004 积雪草精华',priority:'p0',done:false},
  {id:1006,text:'22:15 睡前：真丝枕头铺一次性无菌枕巾（2天一扔）',priority:'p0',done:false},
  {id:1007,text:"22:15 Maple 肚皮喷2下 Clinical Care 止痒喷雾 → 确认戴好防护面罩",priority:'p0',done:false},
  {id:1008,text:'22:15 戴上40°C恒温蒸汽眼罩入睡（防无意识揉搓红血丝）',priority:'p0',done:false},
  {id:1009,text:'每日随手：擦完面霜空档刮镜面（硅胶刮刀 5秒）',priority:'p1',done:false},
  {id:1010,text:'每日随手：晚餐后趁炉台余温酒精湿巾抹一圈（10秒）',priority:'p1',done:false},
  {id:1011,text:'每日随手：床头杯换新过滤水+微量海盐（防Keto Flu）',priority:'p1',done:false},
  {id:1012,text:'⚠️ 安全铁律：今天是否运动日？运动日严禁红光面具+加热仪',priority:'p1',done:false},
  {id:1013,text:"⚠️ 安全铁律：吃坚果/做Deadbug前确认Maple戴防捡食软网罩（夏威夷果致命）",priority:'p1',done:false},
  {id:1014,text:'【周六 Day B·W1】热身M1-M5 → A组×2：Glute Bridge March 6-8/side + Bench Dips 8-10',priority:'p1',done:false},
  {id:1015,text:'【周六 Day B·W1】B组×2：Step-Up 6-8/side + Shoulder Taps 6-8/side（慢速）',priority:'p1',done:false},
  {id:1016,text:'【周六 Day B·W1】C组×2：Inchworm×5 + Deadbug w/ Wall Press 6-8/side',priority:'p1',done:false},
  {id:1017,text:"【周六 科技提亮】20:20 红光面具 → 拍小棕瓶 → 海豚尾纯EMS微电流下颌线（严禁加热！严禁碰两颊）",priority:'p1',done:false},
  {id:1018,text:'【周六 曲酸去黄】两颊厚涂海蓝之谜 → 贴Medicube曲酸姜黄凝胶面膜',priority:'p1',done:false},
  {id:1019,text:'【周六 颈部Spa】21:00 莱蔻樱花厚涂脖子 → 仪器EMS+红光+HEAT温热推斜方肌',priority:'p1',done:false},
  {id:1020,text:'【周二 Day A·W1】A组×2：Split-Squat 6-8/side + Prone Swimmer Hovers×5',priority:'p2',done:false},
  {id:1021,text:'【周二 Day A·W1】B组×2：Single-Leg RDL 6-8/side（可扶墙）+ Incline Push-Up 8-10',priority:'p2',done:false},
  {id:1022,text:'【周二 Day A·W1】C组×2：Bear Squat 8-10 + Side Planks 30sec/side',priority:'p2',done:false},
  {id:1023,text:"【周一/四 有氧日】18:30 黑巧克力→CeraVe黄管→Maple戴网罩→10公里",priority:'p2',done:false},
  {id:1024,text:"【周一/四 有氧日】19:40 卸妆→发膜→Fulove桑拿→出桑拿厚涂O\\'Keeffe\\'s尿素脚霜+保鲜膜",priority:'p2',done:false},
  {id:1025,text:'【周一/四 有氧日】20:00 退红：立刻敷积雪草面贴膜15分钟（严禁美容仪）→ 乳化海蓝之谜封锁全脸',priority:'p2',done:false},
  {id:1026,text:'【周四 厨房爆破】Affresh洗碗机+Glisten粉碎机+CLR管件（定15分钟闹钟）',priority:'p2',done:false},
  {id:1027,text:'【周四 黄金15分钟】理财记账+账单+下周医生预约/维修联系',priority:'p2',done:false},
];

const SEED_PARKING=['冰岛/葡萄牙度假规划','CFA Level 2 复习计划拆解','Fidelity WI 团队OKR想法','Maple定期复查','北卡摩托车驾照探索','MBA毕业后晋升路径规划','Fulove桑拿最佳频率','MCT油品牌对比'];

const SEED_ADAPT=[
  {id:9001,text:'🔥 运动日严禁红光面具+加热仪 → 运动后立刻常温水洗脸+积雪草面膜15分钟'},
  {id:9002,text:'🧴 通勤→SKIN1004白管；户外长跑→CeraVe黄管。两支绝对不能对调'},
  {id:9003,text:"🐾 吃夏威夷果/含代糖零食时绝对不能掉地上（对Maple肝脏致命）"},
  {id:9004,text:'⚡ 海豚尾仪器只做下颌线；两颊红血丝区域严禁接触；颈部才可以开HEAT'},
  {id:9005,text:"☕ MCT油每次1勺（超量胃肠道不适）；黄油选无盐草饲；打匀才能喝"},
  {id:9006,text:'💤 每2天换一次无菌枕巾（放在Maple习惯趴的交界处）'},
  {id:9007,text:'🏃 跑步/桑拿后面部充血20:00必须敷积雪草面膜15分钟再上海蓝之谜'},
  {id:9008,text:'🥑 坚果白名单：5颗核桃/1-2根奶酪条；10:30才允许加餐'},
  {id:9009,text:'🧹 CLR/Lysol强酸凝胶开窗通风；喷完等15分钟再用旧洗脸巾擦'},
];

const SEED_SHOP=[
  {id:'s1',name:'生酮合理加餐：核桃5颗或奶酪条',icon:'🥜',pts:50,redeemed:false},
  {id:'s2',name:'允许彻底无罪恶感刷手机 15 分钟',icon:'📱',pts:100,redeemed:false},
  {id:'s3',name:'莱蔻颈部 Spa 仪器完整流程',icon:'✨',pts:150,redeemed:false},
  {id:'s4',name:'解开网罩与 Maple 贴贴互动 10 分钟',icon:'🐾',pts:30,redeemed:false},
  {id:'s5',name:'Fulove 桑拿房单次享受',icon:'🧖',pts:200,redeemed:false},
  {id:'s6',name:'购买一本新漫画/有声书',icon:'📚',pts:120,redeemed:false},
  {id:'s7',name:'一颗 90% 黑巧克力（提前奖励）',icon:'🍫',pts:40,redeemed:false},
];

const CHORES=[
  {freq:'daily',icon:'🏠',name:'整屋喷消毒水',note:''},
  {freq:'weekly',icon:'🍽️',name:'Wash Dish',note:'厨房'},{freq:'weekly',icon:'🌿',name:'Mow the lawn',note:''},
  {freq:'weekly',icon:'🗑️',name:'Empty Trash',note:''},{freq:'weekly',icon:'👕',name:'Wash Clothes',note:''},
  {freq:'biweekly',icon:'🛏️',name:'Change/Wash Bedsheets',note:''},{freq:'biweekly',icon:'🚿',name:'Clean shower drain hair',note:''},
  {freq:'monthly',icon:'🪟',name:'Wipe down or vacuum base',note:''},{freq:'monthly',icon:'🍳',name:'Wipe Stovetop',note:''},
  {freq:'monthly',icon:'🪞',name:'Clean Mirrors',note:'Master'},{freq:'monthly',icon:'🧺',name:'Clean Washer',note:'Laundry'},
  {freq:'quarterly',icon:'🔧',name:'Clean 食物粉碎机',note:'Seasonally'},
  {freq:'semiannual',icon:'☕',name:'Clean Coffee filter',note:''},{freq:'semiannual',icon:'🚗',name:'Change car wipe blade',note:''},
  {freq:'semiannual',icon:'📱',name:'Clean up Phone usage',note:''},{freq:'semiannual',icon:'🚘',name:'Maintain Car',note:''},
  {freq:'semiannual',icon:'💧',name:'Change water tank filter',note:''},{freq:'semiannual',icon:'❄️',name:'Change fridge filter',note:'Kitchen'},
  {freq:'annual',icon:'🌬️',name:'Change AC Filter',note:'7月度假前'},{freq:'annual',icon:'🍱',name:'Clean Out Pantry',note:''},
  {freq:'annual',icon:'🗑️',name:'Throw Out useless item',note:''},{freq:'annual',icon:'🍽️',name:'Clean Dishwasher',note:''},
  {freq:'annual',icon:'🚗',name:'Change car filter',note:''},{freq:'annual',icon:'🔑',name:'Car annual check',note:''},
  {freq:'annual',icon:'🏎️',name:'Change Tires',note:'1/3月'},{freq:'annual',icon:'🍳',name:'Change kitchen fan filter',note:'7月'},
  {freq:'annual',icon:'🔧',name:'Clean out garage',note:''},
];
const FREQ_LABELS={daily:{label:'每日',cls:'freq-daily'},weekly:{label:'每周',cls:'freq-weekly'},biweekly:{label:'每两周',cls:'freq-biweekly'},monthly:{label:'每月',cls:'freq-monthly'},quarterly:{label:'每季度',cls:'freq-quarterly'},semiannual:{label:'每半年',cls:'freq-semiannual'},annual:{label:'每年',cls:'freq-annual'}};

const PERSPECTIVES=[
  {id:'default',name:'默认洞察',icon:'🔍'},{id:'cbt',name:'CBT疗法',icon:'🧠'},
  {id:'reverse',name:'逆向思考',icon:'🔄'},{id:'second_order',name:'二阶思考',icon:'🎯'},
  {id:'value',name:'价值澄清',icon:'⚖️'},{id:'action',name:'行动指南',icon:'🚀'},
  {id:'blind_spot',name:'盲区探索',icon:'👁️'},{id:'meaning',name:'意义雷达',icon:'📡'},
  {id:'key_person',name:'关键人物',icon:'⭐'},{id:'daily_affirm',name:'每日肯定',icon:'☀️'},
  {id:'anti_intuitive',name:'反直觉洞见',icon:'🔮'},{id:'resource',name:'资源挖掘',icon:'⛏️'},
  {id:'director',name:'导演视角',icon:'🎬'},{id:'tasha',name:'塔莎·尤里奇',icon:'🪞'},
];

// Defense checklists per task type
const DEFENSE_RULES=[
  {pattern:/跑|有氧|10公里|运动|力量|Day [AB]/i, title:'运动前物理防线检查',checks:["Maple 是否已戴好防捡食软网罩或在围栏里？","积雪草面膜是否已放至随手可得处（运动后20分钟内必用）？","今天是否有美容仪计划？（运动日严禁红光面具和加热仪）","防晒选对了吗？（户外跑→CeraVe黄管，室内→SKIN1004白管）"]},
  {pattern:/桑拿/i, title:'桑拿前物理防线检查',checks:["Rated Green 发膜是否已备好？","出桑拿后：尿素脚霜 + 保鲜膜 + 棉脚袜 已准备？","积雪草面膜已放至随手可得处？（出桑拿立刻用）","桑拿后严禁任何美容仪，已记住？"]},
  {pattern:/Deadbug|力量|地面/i, title:'地面训练前检查',checks:["Maple 是否已戴好防捡食软网罩或在围栏里？","地面是否已清理（无食物残渣、无坚果碎屑）？"]},
];

const WORKOUT={
  warmup:[{id:'M1',name:'Glute Bridge',reps:'15'},{id:'M2',name:'Cat-Cow w/ Belly Breathing',reps:'5 cycles'},{id:'M3',name:'90-90 Hip Rotations',reps:'5/side'},{id:'M4',name:'Spiderman Lunge',reps:'5/side'},{id:'M5',name:'Toe Touch to Squat to Overhead Reach',reps:'10'}],
  weeks:{
    1:{A:[{g:'A',id:'A1',name:'Split-Squat',sets:2,reps:'6-8/side',note:''},{g:'A',id:'A2',name:'Prone Swimmer Hovers',sets:2,reps:'5',note:''},{g:'B',id:'B1',name:'Single-Leg RDL',sets:2,reps:'6-8/side',note:'可扶墙/椅'},{g:'B',id:'B2',name:'Incline Push-Up',sets:2,reps:'8-10',note:'胸骨高度'},{g:'C',id:'C1',name:'Bear Squat',sets:2,reps:'8-10',note:''},{g:'C',id:'C2',name:'Side Planks',sets:2,reps:'30sec/side',note:'Short Lever'}],B:[{g:'A',id:'A1',name:'Glute Bridge March',sets:2,reps:'6-8/side',note:'可做Heels Elevated'},{g:'A',id:'A2',name:'Bench Dips',sets:2,reps:'8-10',note:'双脚平放膝弯曲'},{g:'B',id:'B1',name:'Step-Up',sets:2,reps:'6-8/side',note:'mid-shin高度'},{g:'B',id:'B2',name:'Shoulder Taps',sets:2,reps:'6-8/side',note:'慢速'},{g:'C',id:'C1',name:'Inchworm',sets:2,reps:'5',note:''},{g:'C',id:'C2',name:'Deadbug w/ Wall Press',sets:2,reps:'6-8/side',note:''}]},
    2:{A:[{g:'A',id:'A1',name:'Split-Squat',sets:2,reps:'8-10/side',note:''},{g:'A',id:'A2',name:'Prone Swimmer Hovers',sets:2,reps:'5',note:''},{g:'B',id:'B1',name:'Single-Leg RDL',sets:2,reps:'8-10/side',note:'可扶墙/椅'},{g:'B',id:'B2',name:'Incline Push-Up',sets:2,reps:'10-12',note:'胸骨高度'},{g:'C',id:'C1',name:'Bear Squat',sets:2,reps:'10-12',note:''},{g:'C',id:'C2',name:'Side Planks',sets:2,reps:'30sec/side',note:'Short Lever'}],B:[{g:'A',id:'A1',name:'Glute Bridge March',sets:2,reps:'8-10/side',note:'可做Heels Elevated'},{g:'A',id:'A2',name:'Bench Dips',sets:2,reps:'10-12',note:'双脚平放膝弯曲'},{g:'B',id:'B1',name:'Step-Up',sets:2,reps:'8-10/side',note:'mid-shin高度'},{g:'B',id:'B2',name:'Shoulder Taps',sets:2,reps:'8-10/side',note:'慢速'},{g:'C',id:'C1',name:'Inchworm',sets:2,reps:'5',note:''},{g:'C',id:'C2',name:'Deadbug w/ Wall Press',sets:2,reps:'6-8/side',note:''}]},
    3:{A:[{g:'A',id:'A1',name:'Split-Squat',sets:3,reps:'8-10/side',note:''},{g:'A',id:'A2',name:'Prone Swimmer Hovers',sets:3,reps:'5',note:''},{g:'B',id:'B1',name:'Single-Leg RDL',sets:3,reps:'8-10/side',note:'可扶墙/椅'},{g:'B',id:'B2',name:'Incline Push-Up',sets:3,reps:'10-12',note:'胸骨高度'},{g:'C',id:'C1',name:'Bear Squat',sets:3,reps:'10-12',note:''},{g:'C',id:'C2',name:'Side Planks',sets:3,reps:'30sec/side',note:'Short Lever'}],B:[{g:'A',id:'A1',name:'Glute Bridge March',sets:3,reps:'8-10/side',note:'可做Heels Elevated'},{g:'A',id:'A2',name:'Bench Dips',sets:3,reps:'10-12',note:'双脚平放膝弯曲'},{g:'B',id:'B1',name:'Step-Up',sets:3,reps:'8-10/side',note:'mid-shin高度'},{g:'B',id:'B2',name:'Shoulder Taps',sets:3,reps:'8-10/side',note:'慢速'},{g:'C',id:'C1',name:'Inchworm',sets:3,reps:'5',note:''},{g:'C',id:'C2',name:'Deadbug w/ Wall Press',sets:3,reps:'6-8/side',note:''}]},
    4:{A:[{g:'A',id:'A1',name:'Split-Squat',sets:3,reps:'10-12/side',note:''},{g:'A',id:'A2',name:'Prone Swimmer Hovers',sets:3,reps:'5',note:''},{g:'B',id:'B1',name:'Single-Leg RDL',sets:3,reps:'10-12/side',note:'可扶墙/椅'},{g:'B',id:'B2',name:'Incline Push-Up',sets:3,reps:'12-15',note:'胸骨高度'},{g:'C',id:'C1',name:'Bear Squat',sets:3,reps:'12-15',note:''},{g:'C',id:'C2',name:'Side Planks',sets:3,reps:'30sec/side',note:'Short Lever'}],B:[{g:'A',id:'A1',name:'Glute Bridge March',sets:3,reps:'10-12/side',note:'可做Heels Elevated'},{g:'A',id:'A2',name:'Bench Dips',sets:3,reps:'12-15',note:'双脚平放膝弯曲'},{g:'B',id:'B1',name:'Step-Up',sets:3,reps:'10-12/side',note:'mid-shin高度'},{g:'B',id:'B2',name:'Shoulder Taps',sets:3,reps:'10-12/side',note:'慢速'},{g:'C',id:'C1',name:'Inchworm',sets:3,reps:'5',note:''},{g:'C',id:'C2',name:'Deadbug w/ Wall Press',sets:3,reps:'6-8/side',note:''}]}
  }
};
// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
function getOrSeed(key,seed){const s=localStorage.getItem(key);if(s){try{const d=JSON.parse(s);if(d.length>=seed.length)return d;}catch(e){}}return JSON.parse(JSON.stringify(seed));}
let tasks=getOrSeed('adhd_tasks',SEED_TASKS);
let doneTasks=JSON.parse(localStorage.getItem('adhd_done')||'[]');
let parking=getOrSeed('adhd_parking',SEED_PARKING);
let adaptItems=getOrSeed('adhd_adapt',SEED_ADAPT);
let shopItems=getOrSeed('adhd_shop',SEED_SHOP);
let totalPts=parseInt(localStorage.getItem('adhd_pts')||'0');
let streak=0;
let currentEnergy='full';
let subtaskMap={};
let selectedPersp='default';
let currentWorkoutWeek=1;
let generatedBlocks=[];
let defenseCallback=null;

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════
function escH(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function todayStr(){const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}
function saveTasks(){localStorage.setItem('adhd_tasks',JSON.stringify(tasks));}
function saveDone(){localStorage.setItem('adhd_done',JSON.stringify(doneTasks));}
function saveParking(){localStorage.setItem('adhd_parking',JSON.stringify(parking));}
function saveAdapt(){localStorage.setItem('adhd_adapt',JSON.stringify(adaptItems));}
function saveShop(){localStorage.setItem('adhd_shop',JSON.stringify(shopItems));}
function savePts(){localStorage.setItem('adhd_pts',totalPts);}
function showToast(msg,dur=2200){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),dur);}
function openHelp(){document.getElementById('helpModal').classList.add('open');}
function closeHelp(){document.getElementById('helpModal').classList.remove('open');}
function initDate(){const d=new Date();const days=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];document.querySelector('.date-info')?document.querySelector('.date-info').textContent=`${d.getMonth()+1}月${d.getDate()}日 ${days[d.getDay()]}`:null;}

// ══════════════════════════════════════════
// ENERGY MODE
// ══════════════════════════════════════════
function setEnergy(mode,btn){
  currentEnergy=mode;
  document.querySelectorAll('.energy-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
  if(mode==='low') showToast('🪫 低电量模式：已隐藏高耗脑任务，只显示最轻量行动');
}
function isVisibleInEnergy(t){
  if(currentEnergy==='full') return true;
  if(currentEnergy==='low'){
    const heavy=/CFA|MBA|研究|分析|report|proposal|深度|复习/i;
    return !heavy.test(t.text);
  }
  return true;
}

// ══════════════════════════════════════════
// TABS
// ══════════════════════════════════════════
const PRIMARY_BOTTOM_TABS = ['todo', 'priority', 'flow', 'done'];

function syncTabNav(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
  document.querySelectorAll('.bottom-nav-btn').forEach((b) => {
    const t = b.getAttribute('data-tab');
    if (t === 'more') b.classList.toggle('active', !PRIMARY_BOTTOM_TABS.includes(name));
    else b.classList.toggle('active', t === name);
  });
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  syncTabNav(name);
  if (name === 'flow') renderFlow();
  if (name === 'chores') renderChores();
  if (name === 'insights') renderInsightUI();
  if (name === 'schedule') renderCalTaskList();
  if (name === 'shop') renderShop();
  if (name === 'done') renderDone();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openMoreSheet() {
  document.getElementById('moreModal')?.classList.add('open');
}
function closeMoreSheet() {
  document.getElementById('moreModal')?.classList.remove('open');
}
function switchTabFromMore(name) {
  closeMoreSheet();
  switchTab(name);
}

// ══════════════════════════════════════════
// CLAUDE API
// ══════════════════════════════════════════
const FIRST_LAUNCH_AI_ENABLED = false;
const FIRST_LAUNCH_EXTERNAL_AUTH_ENABLED = false;

function apiBase() {
  const b = (typeof window !== 'undefined' && window.ADHD_FLOW_API) || '';
  return b ? String(b).replace(/\/$/, '') : '';
}

async function callClaude(prompt, maxTokens = 1000) {
  void prompt;
  void maxTokens;
  if (!FIRST_LAUNCH_AI_ENABLED) {
    throw new Error('first_launch_ai_gated');
  }
  const endpoint = `${apiBase()}/api/adhd-flow/chat`;
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, maxTokens }),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(e.error || e.detail || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const text = data.text || '';
  if (!text) throw new Error('Empty response');
  return text;
}

// ══════════════════════════════════════════
// AI SORT
// ══════════════════════════════════════════
async function aiSort(){
  const raw=document.getElementById('todoInput').value.trim();
  if(!raw){showToast('先输入一些任务～');return;}
  const btn=document.getElementById('aiSortBtn');
  const icon=document.getElementById('aiSortIcon');
  const txt=document.getElementById('aiSortText');
  btn.disabled=true;icon.className='spinner';txt.textContent='AI整理中…';
  const prompt=`你是一个ADHD任务管理助手。将以下任务分类为P0/P1/P2：
- P0：今天必须处理（截止时间/外部等待/回复/提交/紧急）
- P1：今天推进一点（重要但不紧急）
- P2：停好等待（灵感/研究/以后再说）

任务列表：
${raw}

返回JSON数组，格式：[{"text":"任务名","priority":"p0"}]
只返回JSON，不要其他文字。`;
  try{
    const result=await callClaude(prompt,600);
    const items=JSON.parse(result.replace(/```json|```/g,'').trim());
    let added=0;
    items.forEach(item=>{
      if(!tasks.find(t=>t.text===item.text)){
        tasks.push({id:Date.now()+Math.random(),text:item.text,priority:item.priority||'p1',done:false});
        added++;
      }
    });
    saveTasks();renderAll();
    document.getElementById('todoInput').value='';
    showToast(`AI整理完成，新增${added}条任务`);
  }catch(e){
    localSort(raw);
    showToast('已用本地规则整理（AI连接失败）');
  }finally{btn.disabled=false;icon.className='';icon.textContent='✦';txt.textContent='AI自动整理';}
}

const P0_KW=['截止','deadline','回复','回邮件','提交','urgent','今天','今日','必须','ddl','due','领导','客户','审批'];
const P2_KW=['探索','研究','灵感','想法','以后','查一下','看看','了解','有空','待定'];
function localSort(raw){
  raw.split('\n').map(l=>l.trim()).filter(l=>l).forEach(line=>{
    if(!tasks.find(t=>t.text===line)){
      const lo=line.toLowerCase();
      tasks.push({id:Date.now()+Math.random(),text:line,priority:P0_KW.some(k=>lo.includes(k))?'p0':P2_KW.some(k=>lo.includes(k))?'p2':'p1',done:false});
    }
  });
  saveTasks();renderAll();document.getElementById('todoInput').value='';
}

function parkAll(){
  const raw=document.getElementById('todoInput').value.trim();
  if(!raw){showToast('先输入内容～');return;}
  const lines=raw.split('\n').map(l=>l.trim()).filter(l=>l);
  lines.forEach(l=>{if(!parking.includes(l))parking.push(l);});
  saveParking();renderWordCloud();
  document.getElementById('todoInput').value='';
  showToast(`已放入停车场${lines.length}条`);
}

// ══════════════════════════════════════════
// AI SUBTASK BREAKDOWN
// ══════════════════════════════════════════
async function breakdownTask(id){
  const t=tasks.find(t=>t.id==id);if(!t)return;
  const panelId='sp-'+id;
  const panel=document.getElementById(panelId);if(!panel)return;
  if(panel.classList.contains('open')&&subtaskMap[id]){panel.classList.remove('open');return;}
  panel.classList.add('open');
  panel.innerHTML='<div style="display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;padding:8px 0"><div class="spinner"></div>AI拆解中…</div>';
  try{
    const result=await callClaude(`将以下任务拆解成4-7个具体可执行子步骤，每步一行，以数字加点开头，不超过20字，只输出步骤列表：\n${t.text}`,400);
    const steps=result.split('\n').map(l=>l.replace(/^\d+[\.\)]\s*/,'').trim()).filter(l=>l.length>0);
    subtaskMap[id]=steps.map(s=>({text:s,done:false}));
    renderSubtasks(id);
  }catch(e){panel.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">AI连接失败，请稍后重试。</p>';}
}

function renderSubtasks(id){
  const panel=document.getElementById('sp-'+id);if(!panel)return;
  const steps=subtaskMap[id]||[];
  const done=steps.filter(s=>s.done).length;
  const pct=steps.length?Math.round(done/steps.length*100):0;
  panel.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px">
      <span style="font-size:11px;color:var(--muted)">${done}/${steps.length}步完成</span>
      <button style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px" onclick="document.getElementById('sp-${id}').classList.remove('open')">收起</button>
    </div>
    <div class="subtask-progress"><div class="subtask-progress-bar" style="width:${pct}%"></div></div>
    ${steps.map((s,i)=>`<div class="subtask-item">
      <input type="checkbox" class="subtask-check" ${s.done?'checked':''} onchange="toggleSubtask(${id},${i})">
      <span style="${s.done?'text-decoration:line-through;color:var(--muted)':''}">${escH(s.text)}</span>
    </div>`).join('')}`;
}
function toggleSubtask(tid,idx){if(!subtaskMap[tid])return;subtaskMap[tid][idx].done=!subtaskMap[tid][idx].done;renderSubtasks(tid);}

// ══════════════════════════════════════════
// MICRO SHREDDER (2-min action, local rules)
// ══════════════════════════════════════════
const SHRED_RULES=[
  {match:/CFA|学习|复习|看.*章|读书/i,micro:'打开材料，只读第一段的第一句话。'},
  {match:/整理|打扫|清洁|Clean/i,micro:'只捡起地板上的一件物品放回原位。'},
  {match:/写|draft|report|邮件|回复/i,micro:'打开文档，只写第一句话或打个标题。'},
  {match:/MBA|作业|课程/i,micro:'打开课程页面，只看第一个视频的标题。'},
  {match:/运动|跑步|力量/i,micro:'换上运动服，站起来做3个深呼吸。'},
  {match:/采购|买|购买/i,micro:'打开购物 App，只搜索商品名，不下单。'},
  {match:/财务|记账|账单/i,micro:'打开 App，只看余额，记下一个数字。'},
];
async function shredTask(id){
  const t=tasks.find(t=>t.id==id);if(!t)return;
  const resultEl=document.getElementById('micro-'+id);if(!resultEl)return;
  resultEl.classList.add('open');
  // Try local rules first (instant, no API needed)
  const rule=SHRED_RULES.find(r=>r.match.test(t.text));
  if(rule){resultEl.innerHTML=`⚡ <strong>2分钟极简启动：</strong>${rule.micro}`;return;}
  // Fallback: AI
  resultEl.innerHTML='<div style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px"><div class="spinner"></div>生成中…</div>';
  try{
    const res=await callClaude(`把以下任务弱化为一个只需2分钟、极其具体的物理微行动（不超过25字，直接描述动作，以动词开头）：\n${t.text}`,100);
    resultEl.innerHTML=`⚡ <strong>2分钟极简启动：</strong>${escH(res.trim())}`;
  }catch(e){resultEl.innerHTML='⚡ 把任务分解：只做第一步，打开就算开始了。';}
}

// ══════════════════════════════════════════
// PREEMPTIVE DEFENSE
// ══════════════════════════════════════════
function checkDefense(taskText, onConfirm){
  const rule=DEFENSE_RULES.find(r=>r.pattern.test(taskText));
  if(!rule){onConfirm();return;}
  document.getElementById('defenseModal').classList.add('open');
  document.getElementById('defenseModalSub').textContent='开始「'+taskText.substring(0,20)+'…」前，先确认：';
  const list=document.getElementById('defenseChecklist');
  list.innerHTML=rule.checks.map((c,i)=>`<li class="defense-check-item">
    <input type="checkbox" class="defense-cb" id="dc-${i}">
    <label for="dc-${i}" style="flex:1;cursor:pointer">${escH(c)}</label>
  </li>`).join('');
  defenseCallback=onConfirm;
}
function closeDefense(){document.getElementById('defenseModal').classList.remove('open');if(defenseCallback){defenseCallback();defenseCallback=null;}}
function closeDefenseCancel(){document.getElementById('defenseModal').classList.remove('open');defenseCallback=null;}

// ══════════════════════════════════════════
// RENDER TASKS
// ══════════════════════════════════════════
function renderAll(){renderAllTasks();renderPriority();renderFlow();renderDone();updateHeaderCounts();}

function taskHTML(t){
  if(!isVisibleInEnergy(t)) return '';
  const tid = "'" + String(t.id) + "'";
  return `<li class="task-item" style="animation:taskSlide .2s ease">
    <input type="checkbox" class="task-check" ${t.done?'checked':''} onchange="completeTask(${tid})">
    <div class="task-body">
      <span class="task-text ${t.done?'done':''}">${escH(t.text)}</span>
      <div id="sp-${String(t.id)}" class="subtask-panel"></div>
      <div id="micro-${String(t.id)}" class="micro-result"></div>
    </div>
    <div class="task-actions">
      <button class="task-btn" title="AI拆步骤" onclick="breakdownTask(${tid})">✦</button>
      <button class="task-btn" title="粉碎为2分钟微行动" onclick="shredTask(${tid})">⚡</button>
      <span class="task-priority-tag tag-${t.priority}" onclick="cyclePriority(${tid})">${t.priority.toUpperCase()}</span>
      <button class="task-btn" onclick="deleteTask(${tid})">×</button>
    </div>
  </li>`;
}

function renderAllTasks(){
  const list=document.getElementById('allTaskList');
  const card=document.getElementById('allTasksCard');
  const pending=tasks.filter(t=>!t.done&&isVisibleInEnergy(t));
  if(!pending.length){card.style.display='none';return;}
  card.style.display='block';
  document.getElementById('allCount').textContent=pending.length;
  list.innerHTML=pending.map(t=>taskHTML(t)).join('');
}
function renderPriority(){
  ['p0','p1','p2'].forEach(p=>{
    const list=document.getElementById(p+'List');
    const items=tasks.filter(t=>t.priority===p&&!t.done&&isVisibleInEnergy(t));
    document.getElementById(p+'Count').textContent=items.length;
    list.innerHTML=items.length?items.map(t=>taskHTML(t)).join(''):'<li class="bucket-empty">这里暂时很安静。</li>';
  });
}
function renderFlow(){
  const container=document.getElementById('flowSteps');
  const empty=document.getElementById('flowEmptyCard');
  const pending=tasks.filter(t=>!t.done&&isVisibleInEnergy(t)).sort((a,b)=>({p0:0,p1:1,p2:2}[a.priority]-{p0:0,p1:1,p2:2}[b.priority]));
  if(!pending.length){container.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';
  container.innerHTML=pending.slice(0,5).map((t,i)=>`
    <div class="card ${i===0?'':''}">
      <div style="font-family:'Space Mono',monospace;font-size:9px;color:var(--muted);margin-bottom:5px">STEP ${i+1} · ${t.priority.toUpperCase()}</div>
      <div style="font-size:15px;font-weight:600;line-height:1.4;margin-bottom:${i===0?'12':'0'}px">${escH(t.text)}</div>
      ${i===0?`
      <div id="sp-${String(t.id)}" class="subtask-panel"></div>
      <div id="micro-${String(t.id)}" class="micro-result"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
        <button class="btn-ai" style="font-size:13px;padding:8px 14px" onclick="checkDefense('${escH(t.text.replace(/'/g,"\\'"))}',()=>completeTask('${t.id}'))">✓ 完成了</button>
        <button class="btn-secondary" style="font-size:12px;padding:8px 12px" onclick="breakdownTask('${t.id}')">✦ 拆步骤</button>
        <button class="btn-secondary" style="font-size:12px;padding:8px 12px" onclick="shredTask('${t.id}')">⚡ 粉碎</button>
        <button class="btn-secondary" style="font-size:12px;padding:8px 12px" onclick="cyclePriority('${t.id}')">调优先级</button>
      </div>`:''}
    </div>`).join('');
  if(pending.length>5) container.innerHTML+=`<p style="text-align:center;color:var(--muted);font-size:12px;margin-top:10px">还有${pending.length-5}件任务待处理</p>`;
}

function renderDone(){
  const list=document.getElementById('doneList');
  const today=todayStr();
  const td=doneTasks.filter(t=>t.date===today);
  const todayPts=td.reduce((s,t)=>s+(t.pts||0),0);
  document.getElementById('doneStatNum').textContent=td.length;
  document.getElementById('doneStatPts').textContent=todayPts;
  document.getElementById('doneStatStreak').textContent=streak;
  const pct=Math.min(100,td.length*12);
  document.getElementById('energyBarFill').style.width=pct+'%';
  if(!td.length){list.innerHTML='<p style="color:var(--muted);font-size:13px;padding:8px 0">今天完成的任务会出现在这里。</p>';return;}
  list.innerHTML=td.map(t=>`
    <div class="done-task-item">
      <div class="done-check-icon">✓</div>
      <span class="done-text">${escH(t.text.substring(0,45))}${t.text.length>45?'…':''}</span>
      <span style="font-size:10px;color:var(--p1-badge);margin-left:4px;flex-shrink:0">+${t.pts||0}</span>
      <button class="done-undo" onclick="undoDone('${t.id}')">撤回</button>
    </div>`).join('');
}

function updateHeaderCounts(){
  const today=todayStr();
  const cnt=doneTasks.filter(t=>t.date===today).length;
  document.getElementById('doneNum').textContent=cnt;
  // Stars
  const starsRow=document.getElementById('starsRow');
  starsRow.textContent='⭐'.repeat(Math.min(cnt,10));
  // Streak badge
  const sb=document.getElementById('streakBadge');
  if(streak>=3){sb.style.display='inline-flex';sb.textContent=`🔥 Combo ×${streak}！积分×2`;}
  else sb.style.display='none';
}

// ══════════════════════════════════════════
// TASK ACTIONS + POINTS
// ══════════════════════════════════════════
const PTS_MAP={p0:30,p1:20,p2:10};
function completeTask(id){
  const idx=tasks.findIndex(t=>t.id==id);if(idx===-1)return;
  const t=tasks[idx];
  const basePts=PTS_MAP[t.priority]||10;
  streak++;
  const multiplier=streak>=3?2:1;
  const earnedPts=basePts*multiplier;
  totalPts+=earnedPts;savePts();
  doneTasks.push({id:Date.now(),text:t.text,date:todayStr(),priority:t.priority,pts:earnedPts});
  tasks.splice(idx,1);saveTasks();saveDone();
  renderAll();
  // Combo feedback
  if(streak>=3){
    showCombo(streak,earnedPts);
    if(streak%3===0) triggerConfetti();
  } else {
    showToast(`完成 ✓ +${earnedPts}分`);
  }
}
function showCombo(s,pts){
  const area=document.getElementById('comboBadgeArea');
  const el=document.createElement('div');
  el.className='combo-badge';
  el.textContent=`🔥 Combo ×${s}！+${pts}分（×2翻倍）`;
  area.replaceChildren(el);
  setTimeout(()=>el.remove(),3000);
}
function deleteTask(id){tasks=tasks.filter(t=>t.id!=id);streak=0;saveTasks();renderAll();}
function cyclePriority(id){const t=tasks.find(t=>t.id==id);if(!t)return;t.priority={p0:'p1',p1:'p2',p2:'p0'}[t.priority];saveTasks();renderAll();showToast(`已改为${t.priority.toUpperCase()}`);}
function undoDone(id){
  const idx=doneTasks.findIndex(t=>t.id==id);if(idx===-1)return;
  const t=doneTasks[idx];
  totalPts=Math.max(0,totalPts-(t.pts||0));savePts();
  tasks.push({id:Date.now(),text:t.text,priority:t.priority||'p1',done:false});
  doneTasks.splice(idx,1);streak=Math.max(0,streak-1);
  saveTasks();saveDone();renderAll();showToast('已撤回');
}
function clearDone(){doneTasks=doneTasks.filter(t=>t.date!==todayStr());streak=0;saveDone();renderDone();updateHeaderCounts();showToast('今日Done已清空');}

// ══════════════════════════════════════════
// CONFETTI
// ══════════════════════════════════════════
function triggerConfetti(){
  const canvas=document.getElementById('confettiCanvas');
  const ctx=canvas.getContext('2d');
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  const particles=Array.from({length:80},()=>({
    x:Math.random()*canvas.width,y:-10,
    vx:(Math.random()-0.5)*4,vy:Math.random()*3+2,
    color:`hsl(${Math.random()*360},80%,60%)`,
    size:Math.random()*8+4,angle:Math.random()*360,va:(Math.random()-0.5)*8
  }));
  let frame=0;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    particles.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;p.angle+=p.va;
      ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle*Math.PI/180);
      ctx.fillStyle=p.color;ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size);
      ctx.restore();
    });
    frame++;if(frame<80)requestAnimationFrame(draw);else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

// ══════════════════════════════════════════
// SHOP
// ══════════════════════════════════════════
function renderShop(){
  document.getElementById('totalPtsDisplay').textContent=totalPts;
  const list=document.getElementById('shopItemsList');
  list.innerHTML=shopItems.map(item=>`
    <div class="shop-item">
      <div class="shop-icon">${item.icon||'🎁'}</div>
      <div class="shop-body">
        <div class="shop-name">${escH(item.name)}</div>
        <div class="shop-pts">${item.pts} 积分</div>
      </div>
      ${item.redeemed
        ?'<button class="shop-btn redeemed" disabled>已兑换 ✓</button>'
        :`<button class="shop-btn" ${totalPts<item.pts?'disabled':''} onclick="redeemItem('${item.id}')">${totalPts>=item.pts?'兑换':'差'+(item.pts-totalPts)+'分'}</button>`}
    </div>`).join('');
}
function redeemItem(id){
  const item=shopItems.find(i=>i.id==id);if(!item||item.redeemed||totalPts<item.pts)return;
  item.redeemed=true;totalPts-=item.pts;savePts();saveShop();renderShop();updateHeaderCounts();
  showToast(`🎉 已兑换：${item.name}`);triggerConfetti();
}
function addShopItem(){
  const name=document.getElementById('shopAddName').value.trim();
  const pts=parseInt(document.getElementById('shopAddPts').value)||50;
  if(!name){showToast('请输入心愿名称');return;}
  shopItems.push({id:'u'+Date.now(),name,icon:'🌟',pts,redeemed:false});
  saveShop();renderShop();
  document.getElementById('shopAddName').value='';document.getElementById('shopAddPts').value='';
  showToast('心愿已上架！');
}

// ══════════════════════════════════════════
// PARKING
// ══════════════════════════════════════════
function addParking(){const val=document.getElementById('parkInput').value.trim();if(!val)return;parking.push(val);document.getElementById('parkInput').value='';saveParking();renderWordCloud();showToast('已停入停车场');}
function renderWordCloud(){
  const cloud=document.getElementById('wordCloud');
  document.getElementById('parkCount').textContent=parking.length;
  if(!parking.length){cloud.innerHTML='<span class="cloud-empty">停车场积累后，会在这里生成词云。</span>';return;}
  const freq={};parking.forEach(p=>{freq[p]=(freq[p]||0)+2;p.replace(/[，。！？]/g,'').split(/\s+/).filter(w=>w.length>1).forEach(w=>{freq[w]=(freq[w]||0)+1;});});
  const sorted=Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,24);
  cloud.innerHTML=sorted.map(([w,c])=>`<span class="word-tag ${c>=4?'size-lg':c>=2?'size-md':'size-sm'}" onclick="parkTagClick('${escH(w)}')">${escH(w)}</span>`).join('');
}
function parkTagClick(word){if(!tasks.find(t=>t.text===word)){tasks.push({id:Date.now(),text:word,priority:'p2',done:false});saveTasks();renderAll();showToast('已转为P2任务');}}

// ══════════════════════════════════════════
// QUICK ADD
// ══════════════════════════════════════════
function toggleQuickAdd(){
  const panel=document.getElementById('quickAddPanel');
  const isOpen=panel.classList.contains('open');
  panel.classList.toggle('open');
  if(!isOpen){document.getElementById('quickAddInput').focus();}
}
function quickAddSubmit(){
  const val=document.getElementById('quickAddInput').value.trim();
  if(!val)return;
  parking.push(val);saveParking();renderWordCloud();
  document.getElementById('quickAddInput').value='';
  document.getElementById('quickAddPanel').classList.remove('open');
  showToast('📥 已卸载到停车场');
}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape') document.getElementById('quickAddPanel').classList.remove('open');
});

// ══════════════════════════════════════════
// CHORES
// ══════════════════════════════════════════
function renderChores(){
  const container=document.getElementById('choresContent');
  const groups={};CHORES.forEach(c=>{if(!groups[c.freq])groups[c.freq]=[];groups[c.freq].push(c);});
  const order=['daily','weekly','biweekly','monthly','quarterly','semiannual','annual'];
  let html='';
  order.forEach(freq=>{
    if(!groups[freq])return;
    const fl=FREQ_LABELS[freq];
    html+=`<div class="freq-section"><div class="freq-header">${fl.label}<span class="freq-badge ${fl.cls}">${fl.label}</span></div>`;
    groups[freq].forEach(c=>{html+=`<div class="chore-item"><div class="chore-icon">${c.icon}</div><div class="chore-body"><div class="chore-name">${escH(c.name)}</div>${c.note?`<div class="chore-meta">${escH(c.note)}</div>`:''}</div><button class="chore-add-btn" onclick="addChoreTask('${escH(c.name)}','${freq}')">+ 加入</button></div>`;});
    html+='</div>';
  });
  container.innerHTML=html;
}
function addChoreTask(name,freq){
  const priority=freq==='daily'||freq==='weekly'?'p1':'p2';
  if(!tasks.find(t=>t.text===name)){tasks.push({id:Date.now(),text:name,priority,done:false});saveTasks();renderAll();showToast(`已加入${priority.toUpperCase()}任务`);}
  else showToast('任务已存在');
}

// ══════════════════════════════════════════
// ADAPT
// ══════════════════════════════════════════
function addAdapt(){const val=document.getElementById('adaptInput').value.trim();if(!val)return;adaptItems.push({id:Date.now(),text:val});document.getElementById('adaptInput').value='';saveAdapt();renderAdapt();showToast('已记录');}
function renderAdapt(){
  const list=document.getElementById('adaptList');document.getElementById('adaptCount').textContent=adaptItems.length;
  if(!adaptItems.length){list.innerHTML='<p style="color:var(--muted);font-size:13px;margin-top:8px">记录那些不适合我的地方，再慢慢改。</p>';return;}
  list.innerHTML=adaptItems.map(a=>`<div class="adapt-item"><div class="adapt-bullet"></div><span class="adapt-text">${escH(a.text)}</span><button class="adapt-delete" onclick="deleteAdapt('${a.id}')">×</button></div>`).join('');
}
function deleteAdapt(id){adaptItems=adaptItems.filter(a=>a.id!=id);saveAdapt();renderAdapt();}
function exportAdapt(){
  if(!adaptItems.length){showToast('还没有记录');return;}
  const blob=new Blob(['\ufeff'+'序号\t改造项目\n'+adaptItems.map((a,i)=>`${i+1}\t${a.text}`).join('\n')],{type:'text/tab-separated-values'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='生活适配改造.tsv';a.click();showToast('已导出');
}

// ══════════════════════════════════════════
// INSIGHTS
// ══════════════════════════════════════════
function renderInsightUI(){
  document.getElementById('perspBtns').innerHTML=PERSPECTIVES.map(p=>`<button class="persp-btn ${p.id===selectedPersp?'active':''}" onclick="selectPersp('${p.id}',this)">${p.icon} ${p.name}</button>`).join('');
}
function selectPersp(id,btn){selectedPersp=id;document.querySelectorAll('.persp-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');}
async function runInsight(){
  const btn=document.getElementById('insightBtn');const icon=document.getElementById('insightBtnIcon');const txt=document.getElementById('insightBtnText');
  const result=document.getElementById('insightResult');
  if(!tasks.length){showToast('先添加一些任务再洞察～');return;}
  btn.disabled=true;icon.className='spinner';txt.textContent='AI洞察中…';result.style.display='none';
  const persp=PERSPECTIVES.find(p=>p.id===selectedPersp);
  const perspPrompts={default:'挖掘这些任务背后隐藏的思维模式与深层动机，给出温和有洞察力的解读。',cbt:'用CBT认知行为疗法视角识别任务列表中的认知陷阱，提供具体认知重构建议。',reverse:'用逆向思考分析：想让这些任务失败需要怎么做？从反面推导正确策略。',second_order:'用二阶思考分析完成/不完成这些任务会带来哪些深层后果。',value:'从任务中找出用户真正看重的价值观，帮助澄清什么是真正重要的。',action:'将任务中的困惑转化为具体下一步行动，每条给出清晰的第一个物理动作。',blind_spot:'找出任务列表中的思维盲点，用尖锐但友善的问题帮助发现被忽视的角度。',meaning:'解析这些任务中的意义来源，哪些充满意义，哪些可能在消耗能量？',key_person:'发现任务中的人物关系对执行的影响。',daily_affirm:'从任务中发现值得骄傲的小事，用温暖鼓励的语气给出今日肯定语。',anti_intuitive:'从任务列表中挖掘反直觉洞见。',resource:'整理任务中可以依靠的内在与外部资源。',director:'以导演视角俯瞰整个任务列表，分析节奏与叙事弧度。',tasha:'用塔莎·尤里奇自我洞察框架从任务中发现思维模式与价值观。'};
  const taskSummary=tasks.filter(t=>!t.done).map((t,i)=>`${i+1}.[${t.priority.toUpperCase()}]${t.text}`).join('\n');
  try{
    const text=await callClaude(`你是一个深度自我洞察助手。用户叫Jennifer（Jing），是Fidelity高级系统分析师，管理健康、学习和家庭生活。\n\n当前待办任务：\n${taskSummary}\n\n请用「${persp.name}」视角（${perspPrompts[selectedPersp]}）分析以上任务。要求：中文，温暖有力度，200-300字，有故事感，结尾给出1个具体轻量行动建议。`,600);
    result.style.display='block';result.textContent=text;
  }catch(e){result.style.display='block';result.textContent='AI连接失败，请稍后重试。';}
  finally{btn.disabled=false;icon.className='';icon.textContent='✦';txt.textContent='生成洞察';}
}

// ══════════════════════════════════════════
// SCHEDULE
// ══════════════════════════════════════════
async function generateSchedule(){
  const startTime=document.getElementById('schedStartTime').value||'09:00';
  const endTime=document.getElementById('schedEndTime').value||'21:00';
  const context=document.getElementById('schedContext').value.trim();
  const pendingTasks=tasks.filter(t=>!t.done);
  if(!pendingTasks.length){showToast('先添加一些任务再生成日程～');return;}
  const btn=document.getElementById('schedGenBtn');const icon=document.getElementById('schedBtnIcon');const txt=document.getElementById('schedBtnText');
  btn.disabled=true;icon.className='spinner';txt.textContent='AI规划中…';
  const d=new Date();const dateStr=`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
  const taskList=pendingTasks.map((t,i)=>`${i+1}.[${t.priority.toUpperCase()}]${t.text}`).join('\n');
  const prompt=`你是ADHD时间管理教练。今天${dateStr}，可用时间${startTime}—${endTime}。${context?'补充：'+context:''}
任务列表：\n${taskList}
生成今日时间块计划，规则：P0必须安排，P1尽量安排，P2可不排；每专注块不超过90分钟后休息；餐后10分钟步行；包含：早晨保养、防弹咖啡、午餐+步行、晚餐、睡前护肤。
返回JSON数组，格式：[{"time":"09:00","title":"标题","detail":"说明","tag":"focus/health/break/admin","duration":60}]
只返回JSON数组。`;
  try{
    const result=await callClaude(prompt,1200);
    generatedBlocks=JSON.parse(result.replace(/```json|```/g,'').trim());
    renderScheduleBlocks(generatedBlocks);
    document.getElementById('scheduleResult').style.display='block';
    renderCalTaskList();showToast('日程生成完成 ✓');
  }catch(e){showToast('生成失败：'+e.message);}
  finally{btn.disabled=false;icon.className='';icon.textContent='📅';txt.textContent='AI生成今日日程';}
}
function renderScheduleBlocks(blocks){
  document.getElementById('scheduleBlocks').innerHTML=blocks.map((b,i)=>`
    <div class="time-block">
      <div class="time-block-time">${escH(b.time)}</div>
      <div class="time-block-body"><div class="time-block-title">${escH(b.title)}</div>${b.detail?`<div class="time-block-detail">${escH(b.detail)}${b.duration?' · '+b.duration+'min':''}</div>`:''}</div>
      <span class="time-block-tag tag-${b.tag||'focus'}">${{focus:'专注',health:'健康',break:'休息',admin:'杂务'}[b.tag]||b.tag}</span>
      <button class="time-block-cal" id="tbc-${i}" onclick="syncBlockToCalendar(${i})">+ 日历</button>
    </div>`).join('');
}
function renderCalTaskList(){
  const container=document.getElementById('calTaskList');if(!container)return;
  const pending=tasks.filter(t=>!t.done&&(t.priority==='p0'||t.priority==='p1'));
  if(!pending.length){container.innerHTML='<p style="color:var(--muted);font-size:12px">暂无P0/P1任务。</p>';return;}
  const now=new Date();const defaultTime=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  container.innerHTML=pending.map(t=>`
    <div class="cal-task-item">
      <span class="task-priority-tag tag-${t.priority}">${t.priority.toUpperCase()}</span>
      <span class="cal-task-name">${escH(t.text.substring(0,38))}${t.text.length>38?'…':''}</span>
      <input type="time" class="cal-task-time-input" id="calt-${t.id}" value="${defaultTime}">
      <button class="cal-sync-btn" id="calb-${t.id}" onclick="syncTaskToCalendar('${t.id}')">+ 日历</button>
    </div>`).join('');
}
function todayDateStr(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function makeGCalURL(title,dateStr,startTime,durationMin,detail){
  const [yr,mo,dy]=dateStr.split('-').map(Number);const [sh,sm]=startTime.split(':').map(Number);
  const s=new Date(yr,mo-1,dy,sh,sm);const e=new Date(s.getTime()+durationMin*60000);
  function fmt(d){return d.getUTCFullYear()+String(d.getUTCMonth()+1).padStart(2,'0')+String(d.getUTCDate()).padStart(2,'0')+'T'+String(d.getUTCHours()).padStart(2,'0')+String(d.getUTCMinutes()).padStart(2,'0')+'00Z';}
  return 'https://calendar.google.com/calendar/render?'+new URLSearchParams({action:'TEMPLATE',text:title,dates:`${fmt(s)}/${fmt(e)}`,details:detail||'',sf:'true'});
}
function makeICSEvent(title,dateStr,startTime,durationMin,desc){
  const [yr,mo,dy]=dateStr.split('-').map(Number);const [sh,sm]=startTime.split(':').map(Number);
  const s=new Date(yr,mo-1,dy,sh,sm);const e=new Date(s.getTime()+durationMin*60000);
  function fmt(d){return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'T'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+'00';}
  return `BEGIN:VEVENT\r\nUID:adhd-${Date.now()}-${Math.random().toString(36).slice(2)}@fp\r\nDTSTAMP:${fmt(new Date())}Z\r\nDTSTART:${fmt(s)}\r\nDTEND:${fmt(e)}\r\nSUMMARY:${title.replace(/,/g,'\\,')}\r\nDESCRIPTION:${(desc||'').replace(/,/g,'\\,')}\r\nEND:VEVENT\r\n`;
}
function syncBlockToCalendar(idx){
  const b=generatedBlocks[idx];if(!b)return;
  if (!FIRST_LAUNCH_EXTERNAL_AUTH_ENABLED) {
    showToast('首发版本暂不启用 Google 日历同步');
    return;
  }
  const href = makeGCalURL(b.title,todayDateStr(),b.time,b.duration||60,b.detail||'');
  window.open(href,'_blank');
  const btn=document.getElementById('tbc-'+idx);if(btn){btn.textContent='✓';btn.classList.add('synced');}
  showToast('已打开Google日历，确认后保存');
}
async function syncAllToCalendar(){
  if(!generatedBlocks.length){showToast('先生成日程～');return;}
  const dateStr=todayDateStr();
  let ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ADHD Flow Planner//CN\r\nCALSCALE:GREGORIAN\r\n';
  generatedBlocks.forEach(b=>{ics+=makeICSEvent(b.title,dateStr,b.time,b.duration||60,b.detail||'');});
  ics+='END:VCALENDAR\r\n';
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([ics],{type:'text/calendar;charset=utf-8'}));a.download=`adhd-schedule-${dateStr}.ics`;a.click();
  showToast(`已导出${generatedBlocks.length}个事件 → 在Google日历"设置→导入"加载`);
  generatedBlocks.forEach((_,i)=>{const b=document.getElementById('tbc-'+i);if(b){b.textContent='✓';b.classList.add('synced');}});
}
function syncTaskToCalendar(id){
  const t=tasks.find(t=>t.id==id);if(!t)return;
  const ti=document.getElementById('calt-'+id);const timeVal=ti?ti.value:'09:00';
  if (!FIRST_LAUNCH_EXTERNAL_AUTH_ENABLED) {
    showToast('首发版本暂不启用 Google 日历同步');
    return;
  }
  const href = makeGCalURL(t.text.substring(0,60),todayDateStr(),timeVal,60,t.text);
  window.open(href,'_blank');
  const btn=document.getElementById('calb-'+id);if(btn){btn.textContent='✓';btn.classList.add('synced');}
  showToast('已打开Google日历');
}

// ══════════════════════════════════════════
// WORKOUT
// ══════════════════════════════════════════
function showWeek(w,btn){currentWorkoutWeek=w;document.querySelectorAll('.wk-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderWorkout();}
function renderWorkout(){
  const el=document.getElementById('workoutContent');if(!el)return;
  const w=WORKOUT.weeks[currentWorkoutWeek];
  const wColors=['','#4a7c59','#3a5a9a','#7a3a7a','#9a6020'];const wc=wColors[currentWorkoutWeek];
  function exRows(exs){let html='',lastG='';exs.forEach(ex=>{if(ex.g!==lastG&&lastG)html+='<div style="height:5px"></div>';html+=`<div class="exercise-row"><div class="ex-group" style="color:${wc}">${ex.id}</div><div class="ex-body"><div class="ex-name">${ex.name}</div><div class="ex-meta">${ex.reps}</div>${ex.note?`<div class="ex-note">💡${ex.note}</div>`:''}</div><div class="sets-badge" style="background:${wc}">×${ex.sets}</div></div>`;lastG=ex.g;});return html;}
  const warmupRows=WORKOUT.warmup.map(m=>`<div class="exercise-row"><div class="ex-group" style="color:#aaa">${m.id}</div><div class="ex-body"><div class="ex-name">${m.name}</div><div class="ex-meta">${m.reps}</div></div><div class="sets-badge" style="background:#aaa">1-2组</div></div>`).join('');
  el.innerHTML=`<div style="margin-bottom:12px"><div class="ws-header">热身 Warm-Up</div>${warmupRows}</div><div style="margin-bottom:12px"><div class="ws-header" style="color:${wc}">Day A · 周二</div>${exRows(w.A)}</div><div><div class="ws-header" style="color:${wc}">Day B · 周六</div>${exRows(w.B)}</div>`;
}

// ══════════════════════════════════════════
// POMODORO
// ══════════════════════════════════════════
let pomoTotal=20*60,pomoRemaining=20*60,pomoRunning=false,pomoTimer=null;
const NUDGES=['⏰ 时间到！起来给 Maple 换换水，或者做1分钟 Deadbug。','🧘 专注结束。站起来，深呼吸3次，然后喝一口盐水。','✨ 很棒！休息5分钟——出去遛 Maple 一圈或刮一下镜面。','🌿 时间到了。去做10分钟餐后步行，顺带清醒一下脑子。','💧 提醒：喝一杯加了微量海盐的过滤水，补充电解质。'];
function setPomoPreset(min,btn){document.querySelectorAll('.pomo-preset').forEach(b=>b.classList.remove('active'));btn.classList.add('active');pomoTotal=min*60;pomoRemaining=min*60;pomoRunning=false;clearInterval(pomoTimer);updatePomoDisplay();}
function updatePomoDisplay(){
  const m=Math.floor(pomoRemaining/60);const s=pomoRemaining%60;
  document.getElementById('pomoTimeText').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  const circ=377;const offset=circ*(1-pomoRemaining/pomoTotal);
  document.getElementById('pomoRingProg').style.strokeDashoffset=offset;
}
function pomoStart(){
  if(pomoRunning)return;
  pomoRunning=true;
  document.getElementById('pomoStartBtn').style.display='none';
  document.getElementById('pomoPauseBtn').style.display='';
  const breath=document.getElementById('pomoBreath');
  breath.style.animation='breathe 4s ease-in-out infinite';
  pomoTimer=setInterval(()=>{
    pomoRemaining--;updatePomoDisplay();
    if(pomoRemaining<=0){clearInterval(pomoTimer);pomoRunning=false;pomoEnd();}
  },1000);
  showToast('专注开始 ✦ 加油！');
}
function pomoPause(){
  clearInterval(pomoTimer);pomoRunning=false;
  document.getElementById('pomoStartBtn').style.display='';
  document.getElementById('pomoPauseBtn').style.display='none';
  document.getElementById('pomoBreath').style.animation='none';
}
function pomoReset(){pomoPause();pomoRemaining=pomoTotal;updatePomoDisplay();document.getElementById('pomoNudge').style.display='none';}
function pomoEnd(){
  document.getElementById('pomoStartBtn').style.display='';document.getElementById('pomoPauseBtn').style.display='none';
  document.getElementById('pomoBreath').style.animation='none';
  const nudge=document.getElementById('pomoNudge');
  nudge.style.display='block';nudge.textContent=NUDGES[Math.floor(Math.random()*NUDGES.length)];
  // Gentle flash effect
  document.body.style.transition='background .3s';document.body.style.background='#e8f5f4';
  setTimeout(()=>{document.body.style.background='';},600);
  pomoRemaining=pomoTotal;updatePomoDisplay();
}

// ══════════════════════════════════════════
// AMBIENT SOUNDS (Web Audio API)
// ══════════════════════════════════════════
let audioCtx=null,ambientNode=null,ambientGain=null;
function toggleAmbient(type,btn){
  document.querySelectorAll('.ambient-btn').forEach(b=>b.classList.remove('active'));
  if(type==='off'){stopAmbient();return;}
  btn.classList.add('active');
  startAmbient(type);
}
function getAudioCtx(){if(!audioCtx||audioCtx.state==='closed')audioCtx=new(window.AudioContext||window.webkitAudioContext)();return audioCtx;}
function stopAmbient(){if(ambientNode){try{ambientNode.stop();}catch(e){}ambientNode=null;}if(ambientGain){try{ambientGain.disconnect();}catch(e){}ambientGain=null;}}
function startAmbient(type){
  stopAmbient();
  const ctx=getAudioCtx();
  ambientGain=ctx.createGain();ambientGain.gain.value=0.15;ambientGain.connect(ctx.destination);
  if(type==='white'){
    const buf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const data=buf.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;src.connect(ambientGain);src.start();ambientNode=src;
  } else if(type==='rain'){
    // Simulated rain: filtered noise with LFO
    const buf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const data=buf.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
    const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;
    const filter=ctx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=800;filter.Q.value=0.5;
    src.connect(filter);filter.connect(ambientGain);src.start();ambientNode=src;
  } else if(type==='cafe'){
    // Low rumble + some texture
    const osc=ctx.createOscillator();osc.frequency.value=80;osc.type='sawtooth';
    const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=300;
    osc.connect(filter);filter.connect(ambientGain);osc.start();ambientNode=osc;
  }
  showToast('🎵 白噪音已开启');
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
function init(){
  // seed data
  if(!localStorage.getItem('adhd_tasks')||JSON.parse(localStorage.getItem('adhd_tasks')).length<SEED_TASKS.length){tasks=JSON.parse(JSON.stringify(SEED_TASKS));saveTasks();}
  if(!localStorage.getItem('adhd_parking')||JSON.parse(localStorage.getItem('adhd_parking')).length<SEED_PARKING.length){parking=JSON.parse(JSON.stringify(SEED_PARKING));saveParking();}
  if(!localStorage.getItem('adhd_adapt')||JSON.parse(localStorage.getItem('adhd_adapt')).length<SEED_ADAPT.length){adaptItems=JSON.parse(JSON.stringify(SEED_ADAPT));saveAdapt();}
  if(!localStorage.getItem('adhd_shop')){shopItems=JSON.parse(JSON.stringify(SEED_SHOP));saveShop();}

  // date in header
  const d=new Date();const days=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  // render
  renderAll();renderWordCloud();renderAdapt();renderWorkout();renderInsightUI();updatePomoDisplay();
}
if (window.Capacitor?.isNativePlatform?.()) {
  document.body.classList.add('capacitor-native');
} else if (window.matchMedia?.('(display-mode: standalone)')?.matches) {
  document.body.classList.add('standalone-pwa');
}

init();

// ══════════════════════════════════════════
// THEME (day / night)  —— 顶部按钮切换，本地记忆
// ══════════════════════════════════════════
const SVG_NS='http://www.w3.org/2000/svg';
function createThemeSvg(kind){
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('width','16');
  svg.setAttribute('height','16');
  svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.9');
  svg.setAttribute('stroke-linecap','round');
  svg.setAttribute('stroke-linejoin','round');
  if(kind==='sun'){
    const circle=document.createElementNS(SVG_NS,'circle');
    circle.setAttribute('cx','12');circle.setAttribute('cy','12');circle.setAttribute('r','3.7');
    const rays=document.createElementNS(SVG_NS,'path');
    rays.setAttribute('d','M12 2.5v2.2M12 19.3v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M21.5 12h-2.2M4.7 12H2.5M18 6l1.6-1.6M6 18l-1.6 1.6');
    svg.append(circle,rays);
  }else{
    const moon=document.createElementNS(SVG_NS,'path');
    moon.setAttribute('d','M20 14.4A7.5 7.5 0 0 1 9.6 4 7.5 7.5 0 1 0 20 14.4z');
    svg.appendChild(moon);
  }
  return svg;
}
function isNight(){return document.documentElement.getAttribute('data-theme')==='night'||document.body.getAttribute('data-theme')==='night';}
function updateThemeIcon(){const t=document.getElementById('themeToggle');if(t)t.replaceChildren(createThemeSvg(isNight()?'sun':'moon'));}
function setThemeColor(mode){const m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',mode==='night'?'#0b1322':'#eef4fd');}
function applyTheme(mode){
  const els=[document.documentElement,document.body];
  els.forEach(function(el){if(!el)return;if(mode==='night')el.setAttribute('data-theme','night');else el.removeAttribute('data-theme');});
  setThemeColor(mode);updateThemeIcon();
}
const _themeMQL=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
function savedThemePref(){try{return localStorage.getItem('adhd_theme');}catch(e){return null;}}
function effectiveTheme(){const s=savedThemePref();if(s==='night'||s==='day')return s;return (_themeMQL&&_themeMQL.matches)?'night':'day';}
function toggleTheme(){
  const next=isNight()?'day':'night';
  applyTheme(next);
  try{localStorage.setItem('adhd_theme',next);}catch(e){}
  if(typeof showToast==='function')showToast(next==='night'?'🌙 夜晚模式已开启':'☀️ 白天模式已开启');
}
if(_themeMQL){var _onSys=function(){var s=savedThemePref();if(s!=='night'&&s!=='day')applyTheme(effectiveTheme());};if(_themeMQL.addEventListener)_themeMQL.addEventListener('change',_onSys);else if(_themeMQL.addListener)_themeMQL.addListener(_onSys);}
(function initTheme(){
  applyTheme(effectiveTheme());
  var btn=document.getElementById('themeToggle');
  if(btn){btn.title='点按切换 · 双击跟随系统';btn.addEventListener('dblclick',function(ev){ev.preventDefault();try{localStorage.removeItem('adhd_theme');}catch(e){}applyTheme(effectiveTheme());if(typeof showToast==='function')showToast('🌗 已恢复跟随系统');});}
})();
