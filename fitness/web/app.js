// ════ DATA ════
const PLAN={
  warmup:[
    {code:'M1',name:'Glute Bridge',reps:'15'},
    {code:'M2',name:'Cat-Cow w/ Belly Breathing',reps:'5 cycles'},
    {code:'M3',name:'90-90 Hip Rotations',reps:'5/side'},
    {code:'M4',name:'Spiderman Lunge',reps:'5/side'},
    {code:'M5',name:'Toe Touch to Squat + Overhead Reach',reps:'10'},
  ],
  weeks:{
    1:{sets:2,A:[
      [{code:'A1',name:'Split-Squat',reps:'6-8/side'},{code:'A2',name:'Prone Swimmer Hovers',reps:'5',note:'俯卧，手臂离地，颈椎中立'}],
      [{code:'B1',name:'Single-Leg RDL',reps:'6-8/side',note:'可用墙或椅子辅助平衡'},{code:'B2',name:'Incline Push-Up',reps:'8-10',note:'台面在胸口高度（沙发背/窗台）'}],
      [{code:'C1',name:'Bear Squat',reps:'8-10'},{code:'C2',name:'Side Planks',reps:'30sec/side',note:'短杠杆 Short Lever'}],
    ],B:[
      [{code:'A1',name:'Glute Bridge March',reps:'6-8/side',note:'Heels Elevated 版可用'},{code:'A2',name:'Bench Dips',reps:'8-10',note:'双脚踩地膝盖弯曲'}],
      [{code:'B1',name:'Step-Up',reps:'6-8/side',note:'台面约胫骨中段高度'},{code:'B2',name:'Shoulder Taps',reps:'6-8/side',note:'⚠️ 放慢速度——Verna 特别叮嘱'}],
      [{code:'C1',name:'Inchworm',reps:'5'},{code:'C2',name:'Deadbug w/ Wall Press',reps:'6-8/side'}],
    ]},
    2:{sets:2,A:[
      [{code:'A1',name:'Split-Squat',reps:'8-10/side'},{code:'A2',name:'Prone Swimmer Hovers',reps:'5'}],
      [{code:'B1',name:'Single-Leg RDL',reps:'8-10/side',note:'可用墙或椅子'},{code:'B2',name:'Incline Push-Up',reps:'10-12',note:'台面在胸口高度'}],
      [{code:'C1',name:'Bear Squat',reps:'10-12'},{code:'C2',name:'Side Planks',reps:'30sec/side',note:'短杠杆'}],
    ],B:[
      [{code:'A1',name:'Glute Bridge March',reps:'8-10/side'},{code:'A2',name:'Bench Dips',reps:'10-12',note:'脚踩地膝盖弯'}],
      [{code:'B1',name:'Step-Up',reps:'8-10/side',note:'胫骨中段高度'},{code:'B2',name:'Shoulder Taps',reps:'8-10/side',note:'⚠️ 放慢'}],
      [{code:'C1',name:'Inchworm',reps:'5'},{code:'C2',name:'Deadbug w/ Wall Press',reps:'6-8/side'}],
    ]},
    3:{sets:3,A:[
      [{code:'A1',name:'Split-Squat',reps:'8-10/side'},{code:'A2',name:'Prone Swimmer Hovers',reps:'5'}],
      [{code:'B1',name:'Single-Leg RDL',reps:'8-10/side',note:'可用墙或椅子'},{code:'B2',name:'Incline Push-Up',reps:'10-12',note:'胸口高度'}],
      [{code:'C1',name:'Bear Squat',reps:'10-12'},{code:'C2',name:'Side Planks',reps:'30sec/side',note:'短杠杆'}],
    ],B:[
      [{code:'A1',name:'Glute Bridge March',reps:'8-10/side'},{code:'A2',name:'Bench Dips',reps:'10-12'}],
      [{code:'B1',name:'Step-Up',reps:'8-10/side',note:'胫骨中段'},{code:'B2',name:'Shoulder Taps',reps:'8-10/side',note:'⚠️ 放慢'}],
      [{code:'C1',name:'Inchworm',reps:'5'},{code:'C2',name:'Deadbug w/ Wall Press',reps:'6-8/side'}],
    ]},
    4:{sets:3,A:[
      [{code:'A1',name:'Split-Squat',reps:'10-12/side'},{code:'A2',name:'Prone Swimmer Hovers',reps:'5'}],
      [{code:'B1',name:'Single-Leg RDL',reps:'10-12/side',note:'可用墙或椅子'},{code:'B2',name:'Incline Push-Up',reps:'12-15',note:'胸口高度'}],
      [{code:'C1',name:'Bear Squat',reps:'12-15'},{code:'C2',name:'Side Planks',reps:'30sec/side',note:'短杠杆'}],
    ],B:[
      [{code:'A1',name:'Glute Bridge March',reps:'10-12/side'},{code:'A2',name:'Bench Dips',reps:'12-15'}],
      [{code:'B1',name:'Step-Up',reps:'10-12/side',note:'胫骨中段'},{code:'B2',name:'Shoulder Taps',reps:'10-12/side',note:'⚠️ 放慢'}],
      [{code:'C1',name:'Inchworm',reps:'5'},{code:'C2',name:'Deadbug w/ Wall Press',reps:'6-8/side'}],
    ]}
  }
};

const EX=[
  {id:'glute-bridge',name:'Glute Bridge',emoji:'🍑',muscles:[{n:'臀大肌',t:'p',i:'🍑'},{n:'腘绳肌',t:'s',i:'🦵'}],
   tags:['glute','hip'],move:['hinge','core_s'],equip:['bodyweight'],diff:'easy',
   cues:['双脚踩地与髋同宽，脚跟离臀约一拳','呼气时收紧臀部向上顶髋，顶点停 1-2 秒','下降时控制速度，不要塌腰','腰部酸说明臀没用力，减小幅度重新找发力感'],
   neural:['想象你要用臀部把地面推穿——不是用背把自己撑起来，是臀主动向下发力'],
   warnings:['避免用腰部代偿——顶点时腹部微收紧','脚跟太远会过度激活腘绳肌，减少臀部参与'],
   mods:['Heels Elevated：脚跟放凳子，增加臀肌拉伸幅度','单腿版本：一侧腿伸直，单侧负荷挑战']},
  {id:'split-squat',name:'Split-Squat',emoji:'🦵',muscles:[{n:'股四头肌',t:'p',i:'🦵'},{n:'臀大肌',t:'s',i:'🍑'}],
   tags:['glute','hip'],move:['squat'],equip:['bodyweight'],diff:'med',
   cues:['前脚完全踩地，膝盖追踪第二脚趾方向','后腿膝盖朝地面，躯干保持直立','下降至前腿平行地面或略低','控制离心：2-3 秒向下，1 秒向上'],
   neural:['想象前脚像树根一样扎进地——驱动力来自前腿的臀和股四头，后腿只是辅助平衡'],
   warnings:['膝痛：缩小蹲深，从四分之一程开始','前膝超脚尖太多：臀部再后推一点'],
   mods:['借椅背辅助平衡（初期推荐）','Bulgarian Split Squat：后脚上台，增加幅度（进阶）']},
  {id:'single-leg-rdl',name:'Single-Leg RDL',emoji:'🔄',muscles:[{n:'腘绳肌',t:'p',i:'🦵'},{n:'臀大肌',t:'p',i:'🍑'},{n:'竖脊肌',t:'s',i:'🔙'}],
   tags:['hip','back'],move:['hinge'],equip:['bodyweight','wall','dumbbell'],diff:'med',
   cues:['支撑腿微屈，不要锁死膝关节','臀部向后推，躯干随之前倾——髋铰链而非弯腰','后伸腿与躯干保持一条线','背部中立——不弓背不过度拱腰'],
   neural:['想象臀部向后去撞一扇紧闭的大门——用臀推门，不是用腰弯腰'],
   warnings:['腰部紧张：减少前倾幅度，优先控制中立脊柱','摇晃是正常的——借墙完全没问题，重点是找到髋铰链感'],
   mods:['手扶墙/椅：消除平衡挑战（Verna 推荐初期使用）','手持哑铃：增加负荷同时助对侧平衡']},
  {id:'incline-pushup',name:'Incline Push-Up',emoji:'💪',muscles:[{n:'胸大肌',t:'p',i:'🫁'},{n:'三角肌前束',t:'s',i:'🙆'},{n:'肱三头肌',t:'s',i:'💪'}],
   tags:['chest','shoulder'],move:['push'],equip:['bodyweight','bench'],diff:'easy',
   cues:['双手略宽于肩，身体保持一条直线','下降时肘部外展约 45°，不要完全外展','胸部触碰台面再推起','不要耸肩——肩胛骨下沉后收'],
   neural:['想象把台面推离你的身体——力量从胸部中心爆发，向两侧撑开'],
   warnings:['台面越低难度越大，从胸口高度开始','手腕疼痛：尝试拳头俯卧撑'],
   mods:['台面越高越简单——可以从椅背开始','标准俯卧撑：地面最大难度']},
  {id:'bear-squat',name:'Bear Squat',emoji:'🐻',muscles:[{n:'股四头肌',t:'p',i:'🦵'},{n:'核心',t:'s',i:'💪'}],
   tags:['hip','core'],move:['squat','core_s'],equip:['bodyweight'],diff:'med',
   cues:['四点跪姿，膝盖悬空 2-3 厘米','臀部向脚跟方向缓慢下降，背部平直','膝盖全程不触地','控制速度，感受股四头离心发力'],
   neural:['想象膝盖下方有一块薄冰——轻轻悬浮，永远不要落下去打碎它'],
   warnings:['腰部塌陷：核心是关键，收紧后再动','幅度不够：从小幅度建立控制感'],
   mods:['减小悬空高度：初期膝盖几乎贴地也可以','加重版：膝盖上放重物']},
  {id:'side-plank',name:'Side Planks',emoji:'🔲',muscles:[{n:'腹外斜肌',t:'p',i:'💪'},{n:'腰方肌',t:'p',i:'🔙'},{n:'臀中肌',t:'s',i:'🍑'}],
   tags:['core'],move:['core_s'],equip:['bodyweight'],diff:'med',
   cues:['手肘在肩膀正下方','从头到脚踝保持一条直线','下方髋部向上顶，避免下沉','均匀呼吸，不要憋气'],
   neural:['想象你的骨盆是一碗水——动作期间水绝对不能从侧面洒出来'],
   warnings:['手肘疼痛：确认肘在肩下方','腰痛：先用短杠杆（膝盖弯曲）'],
   mods:['Short Lever（Verna 推荐）：膝盖弯曲叠放，降低杠杆难度','进阶：加髋部抬起动作']},
  {id:'glute-bridge-march',name:'Glute Bridge March',emoji:'🚶',muscles:[{n:'臀大肌',t:'p',i:'🍑'},{n:'核心',t:'s',i:'💪'}],
   tags:['glute','core'],move:['hinge','core_s'],equip:['bodyweight'],diff:'med',
   cues:['先做标准桥到顶点并保持','交替将一侧膝盖抬至 90°','保持骨盆绝对水平——不允许歪斜','动作要慢：2 秒抬起，2 秒放下'],
   neural:['想象骨盆上放着一杯水，抬腿时水不能洒——单侧臀部必须主动撑住'],
   warnings:['骨盆下沉是最常见错误：宁可减小抬腿幅度','腰部疼痛：降低桥的高度'],
   mods:['Heels Elevated 版本：脚跟放高台，增加臀部激活','仅做顶点保持不抬腿：建立基础控制']},
  {id:'bench-dips',name:'Bench Dips',emoji:'💺',muscles:[{n:'肱三头肌',t:'p',i:'💪'},{n:'三角肌前束',t:'s',i:'🙆'}],
   tags:['chest','shoulder'],move:['push'],equip:['bodyweight','bench'],diff:'easy',
   cues:['双手放凳子边缘，手指朝前','膝盖弯曲 90°，双脚踩地（初期推荐）','身体紧贴凳子下沉，肘部向后弯','上推时肘部伸直但不锁死'],
   neural:['专注于肱三头肌后侧——想象用肘关节后侧把自己推起来'],
   warnings:['肩膀疼痛：不要下沉过深，从浅幅度开始','脚越远越难，初期保持膝盖弯曲'],
   mods:['双脚靠近身体：降低难度','双脚抬高（进阶）：增加上肢负荷']},
  {id:'step-up',name:'Step-Up',emoji:'⬆️',muscles:[{n:'股四头肌',t:'p',i:'🦵'},{n:'臀大肌',t:'p',i:'🍑'}],
   tags:['glute','hip'],move:['squat','hinge'],equip:['bodyweight','bench'],diff:'med',
   cues:['台阶高度在膝盖以下（胫骨中段）开始','前脚完全踩实台面，驱动力来自前腿','后腿上来后不借台面发力','向心（上）和离心（下）各控制 2 秒'],
   neural:['把前脚想象成一个活塞——有控制地推地，感受臀和股四头同时点火'],
   warnings:['台面太高代偿腰部：从最低开始','膝关节内扣：追踪第二脚趾方向'],
   mods:['从最低台阶逐步加高','手持哑铃：增加负荷']},
  {id:'shoulder-taps',name:'Shoulder Taps',emoji:'👆',muscles:[{n:'核心稳定',t:'p',i:'💪'},{n:'肩袖',t:'s',i:'🙆'}],
   tags:['core','shoulder'],move:['core_s','push'],equip:['bodyweight'],diff:'med',
   cues:['平板支撑位，双手与肩同宽','单手触碰对侧肩膀，立即放回','骨盆全程水平——不要左右晃动','核心像防弹背心一样提前收紧'],
   neural:['想象骨盆焊在地上——每次抬手，地面对你的核心施加了一拳，你需要提前抵御它'],
   warnings:['⚠️ 速度越快越容易旋转——慢才是对的（Verna 特别标注）','双脚可以适当分开增加支撑面'],
   mods:['双腿宽距：增加支撑面','膝盖着地：降低核心要求']},
  {id:'inchworm',name:'Inchworm',emoji:'🐛',muscles:[{n:'腘绳肌',t:'p',i:'🦵'},{n:'核心',t:'s',i:'💪'}],
   tags:['core','back'],move:['hinge','core_s','mobility'],equip:['bodyweight'],diff:'easy',
   cues:['站立开始，双手摸地（膝盖微屈）','手往前爬至平板支撑位，核心全程收紧','保持 1 秒，再用脚走回来','缓慢进行，感受每个姿势过渡'],
   neural:['这是用全身动作语言跟神经系统说：我们今天要动了——每一步都是唤醒'],
   warnings:['腰部塌陷：核心抗伸展是重点','头晕：放慢速度'],
   mods:['缩小爬行距离','加俯卧撑：在平板位做一个 Push-Up（进阶）']},
  {id:'deadbug',name:'Deadbug w/ Wall Press',emoji:'🪲',muscles:[{n:'深层核心',t:'p',i:'💪'},{n:'髂腰肌',t:'s',i:'🦋'}],
   tags:['core'],move:['core_s'],equip:['bodyweight','wall'],diff:'med',
   cues:['仰卧，腰部自然曲度贴地（不要强压）','双手推墙，提供对侧张力','交替伸展对侧腿，核心对抗旋转','全程均匀呼吸，呼气时感受深层核心激活'],
   neural:['把腰部想象成一个被按死的遥控器——腿不管怎么动，腰都不离开地面，这才是深层核心'],
   warnings:['腰部拱起离地：缩小腿的伸展幅度，从半程开始','越慢效果越好——这是神经控制，不是力量训练'],
   mods:['无墙版本：双手放胸前','加弹力带：手持带向上，脚向下，增加对抗张力']},
  {id:'prone-swimmer',name:'Prone Swimmer Hovers',emoji:'🏊',muscles:[{n:'竖脊肌',t:'p',i:'🔙'},{n:'臀大肌',t:'s',i:'🍑'}],
   tags:['back','shoulder'],move:['pull','core_s'],equip:['bodyweight'],diff:'easy',
   cues:['俯卧，双臂 Y 字或 T 字形向前/侧伸展','收紧臀部和背部，手臂和腿微微离地','保持 2-3 秒，感受脊柱两侧肌肉发力','下降时控制，不要直接放落'],
   neural:['想象你要用整个后背把天花板托起来——胸骨轻轻离地，让背部做所有工作'],
   warnings:['颈部不要过度抬起：眼睛看地面，颈椎中立','离地高度不需要高——1-2cm 的激活就足够'],
   mods:['单侧版本：对侧手臂和腿（增加旋转控制挑战）','加弹力带：手持带增加肩部负荷']},
  {id:'cat-cow',name:'Cat-Cow w/ Belly Breathing',emoji:'🐱',muscles:[{n:'脊柱活动度',t:'p',i:'🔙'},{n:'横膈膜',t:'s',i:'🫁'}],
   tags:['back','core'],move:['mobility'],equip:['bodyweight'],diff:'easy',
   cues:['四点跪姿，腕在肩下，膝在髋下','猫式：呼气，脊柱向天花板弓起，低头','牛式：吸气，肚子向下，抬头','节奏与呼吸完全同步——这是呼吸 + 脊柱训练的结合'],
   neural:['让呼吸来驱动动作，而不是肌肉——吸气时身体自然打开，呼气时自然包裹，顺从身体的节律'],
   warnings:['颈椎不要用力：抬头低头是从脊柱开始的渐进波浪','腕部压力大：尝试拳头支撑'],
   mods:['坐姿版：坐椅子上做脊柱屈伸']},
  {id:'9090',name:'90-90 Hip Rotations',emoji:'🦋',muscles:[{n:'髋内旋肌群',t:'p',i:'🦋'},{n:'梨状肌',t:'s',i:'🍑'}],
   tags:['hip'],move:['mobility'],equip:['bodyweight'],diff:'easy',
   cues:['坐地，双腿 90-90°（前腿内旋，后腿外旋）','躯干直立，重心缓慢向前腿转换','感受髋关节内外旋，而非前倾角度','换侧通过髋关节旋转，不靠躯干侧倒'],
   neural:['想象大腿骨在髋臼里旋转——骨盆是固定的地球，大腿骨是在轨道上运行的卫星'],
   warnings:['膝关节疼痛：调整双腿角度，找到无痛范围','不要强迫幅度——活动度是长期积累的'],
   mods:['靠墙坐：提供躯干支撑，专注髋关节']},
  {id:'spiderman',name:'Spiderman Lunge',emoji:'🕷️',muscles:[{n:'髋屈肌群',t:'p',i:'🦋'},{n:'臀大肌',t:'s',i:'🍑'}],
   tags:['hip'],move:['squat','mobility'],equip:['bodyweight'],diff:'easy',
   cues:['俯卧撑位开始，一只脚跨步至同侧手外侧','前脚踩实，骨盆下沉，感受髋屈肌拉伸','可以加上臂 T 字形开合，增加胸椎旋转','控制换侧，每次下沉 2-3 秒'],
   neural:['每一步落地，都在告诉你的神经系统：这个活动范围是安全的，我可以在这里用力'],
   warnings:['前膝不要内扣','腰部不要塌陷'],
   mods:['减小跨步幅度','加旋转：前脚落地后同侧手臂向上旋转']},
  {id:'toetouch',name:'Toe Touch to Squat + Overhead Reach',emoji:'🙆',muscles:[{n:'腘绳肌',t:'p',i:'🦵'},{n:'髋关节',t:'s',i:'🦋'}],
   tags:['hip','shoulder'],move:['hinge','mobility'],equip:['bodyweight'],diff:'easy',
   cues:['站立，双手摸脚趾（膝盖微屈），保持 1-2 秒','过渡到深蹲位，双手向头顶伸展','从深蹲站起——这是一个连续流动动作','整个过程缓慢，感受每个姿势的过渡'],
   neural:['这个动作在用全身幅度跟神经系统打招呼——从拉伸到收缩，每个关节都被激活'],
   warnings:['腰部圆背：膝盖可以弯曲更多','头晕：减慢过渡速度'],
   mods:['只做触脚趾：单独练腘绳肌拉伸','只做深蹲：单独练下肢活动度']}
];

// ════ STATE ════
let cWeek=1,cDay='A',mF='all',eF='all',mvF='all';
let sbSun=false,sbHyd=true,sbCars=false;
let hudQ=[],hudIdx=0,hudSet=1,hudTotalSets=2;
let ssInt=null,ssP=0;
let restInt=null,restSec=90,fakeHR=158;
let walkActive=false,walkSec=600,walkInt=null;
let recStage=0;

// ════ CLOCK ════
(function tick(){
  const d=new Date();
  document.getElementById('clock').textContent=d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  setTimeout(tick,10000);
})();

// ════ TABS ════
function switchTab(n){
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scr-'+n).classList.add('on');
  document.getElementById('tab-'+n).classList.add('on');
  document.getElementById('mainScroll').scrollTop=0;
  const pb=document.getElementById('promptBar'),ib=document.getElementById('inputBar');
  if(n==='coach'){pb.style.display='flex';ib.style.display='flex';renderChips();scrollChat();}
  else{pb.style.display='none';ib.style.display='none';}
  if(n==='train')renderPlan();
  if(n==='library')renderLib();
}

// ════ PLAN ════
function buildWkSel(){
  document.getElementById('wksel').innerHTML=[1,2,3,4].map(w=>
    `<div class="wb${w===cWeek?' on':''}" onclick="selWeek(${w},this)">W${w}</div>`).join('');
}
function selWeek(w,el){cWeek=w;document.querySelectorAll('.wb').forEach(b=>b.classList.remove('on'));el.classList.add('on');renderPlan();}
function selDay(d){cDay=d;document.getElementById('dab').classList.toggle('on',d==='A');document.getElementById('dbb').classList.toggle('on',d==='B');renderPlan();}
function getBg(c){if(c[0]==='A')return 'ba';if(c[0]==='B')return 'bb';if(c[0]==='C')return 'bc';return 'bm';}

function renderPlan(){
  buildWkSel();
  const wk=PLAN.weeks[cWeek],pairs=wk[cDay];
  let h='<div class="band bwarm">🌀 热身 Warm-Up · 1-2 组</div>';
  h+='<div class="ss-block"><div class="ss-pair">';
  PLAN.warmup.forEach((ex,i)=>{
    if(i)h+='<div style="height:1px;background:var(--bd)"></div>';
    h+=`<div class="exrow" onclick="openDetail('${ex.name}')"><div class="exb bm">${ex.code}</div><div class="exi"><div class="exn">${ex.name}</div><div class="exm">1-2 组 · ${ex.reps}</div></div></div>`;
  });
  h+='</div></div>';
  h+=`<div class="band bstr">💪 ${cDay==='A'?'力量 Day A · 下肢推':'力量 Day B · 下肢拉'} · Week ${cWeek} · ${wk.sets} 组</div>`;
  pairs.forEach(pair=>{
    const ltr=pair[0].code.replace(/[0-9b]/g,'');
    h+=`<div class="ss-block"><div class="ss-lbl"><span>${ltr} 超级组 Superset</span><div class="ss-con"></div></div><div class="ss-pair">`;
    pair.forEach((ex,ei)=>{
      if(ei)h+='<div class="ss-div"></div>';
      h+=`<div class="exrow" onclick="openHud('${ex.name}')"><div class="exb ${getBg(ex.code)}">${ex.code}</div><div class="exi"><div class="exn">${ex.name}${ex.note?'<span class="np">备注</span>':''}</div><div class="exm">${wk.sets} 组 · ${ex.reps}</div></div><div class="exsr"><div class="sets">${wk.sets}</div><div class="reps">组</div></div></div>`;
    });
    h+='</div></div>';
  });
  document.getElementById('workoutList').innerHTML=h;
  document.getElementById('endWrap').style.display='block';
}

// ════ SANDBOX ════
function updSb(){
  const done=[sbSun,sbHyd,sbCars].filter(Boolean).length;
  document.getElementById('sbp').textContent=done+' / 3 完成';
  if(done===3){document.getElementById('workoutList').style.opacity='1';document.getElementById('workoutList').style.pointerEvents='auto';showPts('+XP 沙盒完成 · 动作库解锁 🔓');}
}
function showSS(){if(sbSun)return;document.getElementById('ssFill').style.width='0%';document.getElementById('ssHint').textContent='长按 2 秒激活';document.getElementById('ssIcon').classList.remove('act');document.getElementById('ssOv').classList.add('on');}
function startSS(){ssP=0;ssInt=setInterval(()=>{ssP+=5;document.getElementById('ssFill').style.width=ssP+'%';if(ssP>=100){clearInterval(ssInt);document.getElementById('ssIcon').classList.add('act');document.getElementById('ssHint').textContent='皮肤物理防线已建立 ✓';setTimeout(()=>{document.getElementById('ssOv').classList.remove('on');sbSun=true;document.getElementById('stSun').textContent='✓';document.getElementById('stSun').className='sst ok';updSb();},700);}},100);}
function stopSS(){if(ssP<100){clearInterval(ssInt);document.getElementById('ssFill').style.width='0%';}}
function addWater(){const fills=[55,70,85,100];const cur=parseInt(document.getElementById('hydFill').style.width);const next=fills.find(f=>f>cur)||100;document.getElementById('hydFill').style.width=next+'%';const mls=[500,800,1100,1500];document.getElementById('hydTxt').textContent=`已记录 ${mls[fills.indexOf(next)]}ml · ${next>=85?'水合充足 ✓':'点击继续补充'}`;if(next>=85){sbHyd=true;}updSb();}
function startCARs(){if(sbCars)return;let c=60;const iv=setInterval(()=>{c--;document.getElementById('carsSub').textContent=`⏱ ${c} 秒 · 跟随节奏活动`;if(c<=0){clearInterval(iv);sbCars=true;document.getElementById('stCars').textContent='✓';document.getElementById('stCars').className='sst ok';document.getElementById('carsSub').textContent='关节激活完毕 ✓';updSb();}},100);}

// ════ SUPERSET HUD ════
function openHud(name){
  const wk=PLAN.weeks[cWeek],pairs=wk[cDay];
  let foundPair=null;
  pairs.forEach(p=>{if(p.find(e=>e.name===name))foundPair=p;});
  if(!foundPair){openDetail(name);return;}
  hudQ=foundPair;hudIdx=0;hudSet=1;hudTotalSets=wk.sets;
  showHud();
}
function showHud(){
  stopFollow();
  const ex=hudQ[hudIdx];
  const isLast=hudIdx===hudQ.length-1;
  const exData=EX.find(e=>e.name===ex.name);
  document.getElementById('hudPhase').textContent=`第 ${hudSet} 组 / 共 ${hudTotalSets} 组`;
  document.getElementById('hudBig').textContent=ex.code;
  document.getElementById('hudBig').style.color=hudIdx===0?'var(--ember)':'var(--cool)';
  document.getElementById('hudEx').textContent=ex.name;
  document.getElementById('hudW').textContent='体重';
  document.getElementById('hudR').textContent='× '+ex.reps;
  const nn=document.getElementById('hudNote');
  if(ex.note){nn.textContent=ex.note;nn.style.display='block';}else{nn.style.display='none';}
  const mediaHost=document.getElementById('hudMedia');
  if(mediaHost&&exData)DemoPlayer.renderMediaPanel(mediaHost,exData,ex.reps);
  const rpe=document.getElementById('rpeWrap');
  rpe.className='rpew'+(isLast?' on':'');
  document.getElementById('rpeSlider').value=7;
  document.getElementById('rpeVal').textContent='7';
  const btn=document.getElementById('hudBtn');
  if(!isLast){btn.textContent=`✓ 完成 ${ex.code} → 立刻进入 ${hudQ[hudIdx+1].code}`;btn.className='hudabtn next';}
  else{btn.textContent='✓ 完成超级组 · 进入组间修复';btn.className='hudabtn done';}
  document.getElementById('ssHud').classList.add('on');
}
function hudAction(){
  stopFollow();
  const isLast=hudIdx===hudQ.length-1;
  if(!isLast){
    // Flash transition
    const fl=document.getElementById('ssFlash');
    fl.style.opacity='1';setTimeout(()=>fl.style.opacity='0',300);
    hudIdx++;showHud();
  } else {
    const rpe=parseInt(document.getElementById('rpeSlider').value);
    document.getElementById('ssHud').classList.remove('on');
    if(rpe>=9)showPts('🔻 RPE 过高！AI 建议降低下组次数');
    else if(rpe<=4)showPts('💪 轻松！考虑增加次数');
    else showPts('+15 PTS 超级组完成！');
    if(hudSet<hudTotalSets){hudSet++;hudIdx=0;startRest();}
    else showPts('🎉 动作完成！');
  }
}
function closeHud(){stopFollow();document.getElementById('ssHud').classList.remove('on');}

// ════ REST HUD ════
const microTasks=[
  '补水黄金期——喝一口水，用手掌轻拍今日主训肌群，强化意念肌肉联结。',
  '用拇指轻压臀大肌外侧，感受肌肉紧张度，为下一超级组建立本体感觉。',
  '缓慢深呼吸——吸气 4 秒，屏息 2 秒，呼气 6 秒，激活副交感神经。',
  '起立，双手扣背后向后拉伸，感受胸大肌主动放松，提高下组弹性。',
];
function startRest(){
  stopFollow();
  restSec=90;fakeHR=158;
  document.getElementById('restTimer').textContent=restSec;
  document.getElementById('restTimer').className='resttimer hot';
  document.getElementById('restHR').textContent=fakeHR;
  document.getElementById('restMsg').textContent='双手叠放，平稳呼吸，为下一超级组满电蓄能。';
  document.getElementById('restSkip').textContent='等待心率恢复...';
  document.getElementById('restSkip').className='restskip';
  document.getElementById('microBody').textContent=microTasks[Math.floor(Math.random()*microTasks.length)];
  document.getElementById('restHud').classList.add('on');
  restInt=setInterval(()=>{
    restSec--;
    fakeHR=Math.max(108,Math.round(fakeHR-(restSec>60?1.8:restSec>30?2.2:1.2)));
    document.getElementById('restTimer').textContent=restSec;
    document.getElementById('restHR').textContent=fakeHR;
    if(fakeHR>140)document.getElementById('restTimer').className='resttimer hot';
    else if(fakeHR>118)document.getElementById('restTimer').className='resttimer cool2';
    else{
      document.getElementById('restTimer').className='resttimer rdy';
      document.getElementById('restMsg').textContent='心率已平稳 ✓ 神经电量回满，可以开始下一超级组！';
      document.getElementById('restSkip').textContent='💪 就绪，开始下一超级组';
      document.getElementById('restSkip').className='restskip rdy';
    }
    if(restSec<=3&&restSec>0)AudioEngine.playTick();
    if(restSec<=0){clearInterval(restInt);AudioEngine.playRestEnd();skipRest();}
  },120);
}
function skipRest(){clearInterval(restInt);document.getElementById('restHud').classList.remove('on');showHud();}
function logWater(){showPts('💧 +50ml 已记录');}

// ════ LIBRARY ════
function fl(val,el,type){
  if(type==='m'){mF=val;document.querySelectorAll('#mf .chip').forEach(c=>c.classList.remove('eon','con'));}
  else if(type==='e'){eF=val;document.querySelectorAll('#ef .chip').forEach(c=>c.classList.remove('eon','con'));}
  else{mvF=val;document.querySelectorAll('#mvf .chip').forEach(c=>c.classList.remove('eon','con'));}
  el.classList.add(type==='m'?'eon':'con');
  renderLib();
}
function renderLib(){
  const fil=EX.filter(ex=>{
    const mOk=mF==='all'||ex.tags.includes(mF);
    const eOk=eF==='all'||ex.equip.includes(eF);
    const mvOk=mvF==='all'||ex.move.includes(mvF);
    return mOk&&eOk&&mvOk;
  });
  const dl={easy:'td1 🟢 入门',med:'td2 🟡 进阶',hard:'td3 🔴 挑战'};
  const ml={squat:'蹲',hinge:'髋铰链',push:'推',pull:'拉',core_s:'核心稳定',mobility:'活动度'};
  let h='';
  fil.forEach(ex=>{
    const mt=ex.muscles.slice(0,2).map(m=>`<span class="tag tm">${m.n}</span>`).join('');
    const et=`<span class="tag te">${ex.equip[0]==='bodyweight'?'🤸 徒手':ex.equip[0]==='dumbbell'?'🏋️ 哑铃':ex.equip[0]==='bench'?'🛋️ 凳':ex.equip[0]==='wall'?'🧱 墙':ex.equip[0]}</span>`;
    const mvt=ex.move.slice(0,2).map(v=>`<span class="tag tv">${ml[v]||v}</span>`).join('');
    const dt=dl[ex.diff].split(' '),dtag=`<span class="tag ${dt[0]}">${dt.slice(1).join(' ')}</span>`;
    h+=`<div class="lcard" onclick="openDetail('${ex.name}')">
      <div class="lctop"><div class="lcicon">${ex.emoji}</div>
        <div class="lcinfo"><div class="lcname">${ex.name}</div>
          <div class="lctags">${mt}${et}${mvt}${dtag}</div>
        </div>
      </div>
      <div class="lccue">${ex.neural?ex.neural[0]:ex.cues[0]}</div>
    </div>`;
  });
  document.getElementById('libCards').innerHTML=h||(fil.length===0?'<div style="text-align:center;padding:30px;color:var(--mu)">无匹配动作</div>':'');
}

// ════ DETAIL ════
function openDetail(name){
  const ex=EX.find(e=>e.name===name);
  if(!ex)return;
  document.getElementById('dovName').textContent=ex.name;
  const ml={squat:'蹲',hinge:'髋铰链',push:'推',pull:'拉',core_s:'核心稳定',mobility:'活动度'};
  const dl={easy:'td1 🟢 入门',med:'td2 🟡 进阶',hard:'td3 🔴 挑战'};
  const muscles=ex.muscles.map(m=>`<div class="mg ${m.t==='p'?'p':'s'}"><div class="mgi">${m.i}</div><div class="mgn">${m.n}</div><div class="mgr">${m.t==='p'?'主动肌':'协同/稳定'}</div></div>`).join('');
  const cues=ex.cues.map(c=>`<li>${c}</li>`).join('');
  const neural=ex.neural?ex.neural.map(n=>`<div class="neural">${n}</div>`).join(''):'';
  const warns=ex.warnings.map(w=>`<div class="wi">${w}</div>`).join('');
  const mods=ex.mods.map(m=>`<div class="mi2">${m}</div>`).join('');
  const moves=ex.move.map(v=>`<span class="tag tv">${ml[v]||v}</span>`).join('');
  const d=dl[ex.diff].split(' '),dtag=`<span class="tag ${d[0]}">${d.slice(1).join(' ')}</span>`;
  const media=getMediaForExercise(ex);
  const mediaHtml=`<div class="detail-media"><div class="media-grid">
    <div class="media-video-wrap"><video class="media-video" playsinline loop muted ${media.video?`src="${media.video}"`:''} style="display:${media.video?'block':'none'};width:100%;height:120px;object-fit:cover"></video>
    <div class="media-video-ph" style="display:${media.video?'none':'flex'};height:120px;align-items:center;justify-content:center"><div class="demo-stage demo-${media.demo}"></div></div></div>
    <div class="media-muscles" id="detailMuscleMap"></div></div></div>`;
  document.getElementById('dovBody').innerHTML=`
    ${mediaHtml}
    <div class="ds"><div class="dl">目标肌群 · 高亮</div><div class="mrow">${muscles}</div></div>
    <div class="ds"><div class="dl">运动模式 · 难度</div><div style="display:flex;gap:6px;flex-wrap:wrap">${moves}${dtag}</div></div>
    ${neural?`<div class="ds"><div class="dl">神经唤醒语 🧠</div>${neural}</div>`:''}
    <div class="ds"><div class="dl">动作要点</div><div class="dc"><ul class="cuelist">${cues}</ul></div></div>
    <div class="ds"><div class="dl">注意事项</div><div class="dc">${warns}</div></div>
    <div class="ds"><div class="dl">难度调节 · 修改方案</div><div class="dc">${mods}</div></div>
    <div style="height:20px"></div>`;
  const mapEl=document.getElementById('detailMuscleMap');
  if(mapEl)DemoPlayer.renderMuscleMap(mapEl,media);
  const vid=document.querySelector('#dovBody .media-video');
  if(vid&&media.video)vid.play().catch(()=>{});
  document.getElementById('detailOv').classList.add('on');
}
function closeDetail(){document.getElementById('detailOv').classList.remove('on');}

// ════ WORKOUT ════
function startWorkout(){switchTab('train');if(!sbSun)setTimeout(showSS,300);}
function endWorkout(){recStage=0;document.getElementById('heatBall').className='hball hot';document.getElementById('heatBall').textContent='🔥';document.getElementById('recHR').textContent='162';document.getElementById('recBtn').textContent='启动副交感刹车 · 缓慢呼吸';document.getElementById('recBtn').className='recbtn hot';document.getElementById('recovOv').classList.add('on');}
function advRecov(){
  recStage++;
  if(recStage===1){
    document.getElementById('heatBall').textContent='🌡️';
    let hr=162;
    const iv=setInterval(()=>{hr-=3;const el=document.getElementById('recHR');if(el)el.textContent=Math.round(hr);if(hr<=110){clearInterval(iv);document.getElementById('heatBall').className='hball cool';document.getElementById('heatBall').textContent='🌿';document.getElementById('recMsg').textContent='神经系统已成功着陆，脱离战斗模式，开启修复窗口。';document.getElementById('recBtn').textContent='✓ 进入修复窗口';document.getElementById('recBtn').className='recbtn cool';}},180);
  }else{document.getElementById('recovOv').classList.remove('on');showPts('+50 PTS 训练结算！');setTimeout(()=>switchTab('coach'),900);}
}

// ════ GLUCOSE ════
function logHigh(){document.getElementById('logRow3').style.display='flex';document.getElementById('gcBig').textContent='158';document.getElementById('gcBig').className='gcbig w';document.getElementById('hgval').textContent='158';document.getElementById('hgdot').className='gdot gw';document.getElementById('hgsub').textContent='餐后 1h · ⚠️ 偏高，建议步行';document.getElementById('walkCard').style.display='block';document.getElementById('fuseCard').style.display='block';}
function startWalk(){document.getElementById('walkOv').classList.add('on');document.getElementById('walkPts').style.display='none';document.getElementById('walkBtn').textContent='开始走！';walkActive=false;walkSec=600;}
function walkAction(){
  if(!walkActive){walkActive=true;document.getElementById('walkBtn').textContent='步行中...';
    walkInt=setInterval(()=>{walkSec--;const m=Math.floor(walkSec/60).toString().padStart(2,'0'),s=(walkSec%60).toString().padStart(2,'0');document.getElementById('walkNum').textContent=m+':'+s;
      if(walkSec<=0){clearInterval(walkInt);document.getElementById('walkNum').textContent='完成！';document.getElementById('walkPts').style.display='block';document.getElementById('walkBtn').textContent='关闭';walkActive=false;document.getElementById('gcBig').textContent='128';document.getElementById('gcBig').className='gcbig s';document.getElementById('walkCard').style.display='none';}
    },30);
  }else{document.getElementById('walkOv').classList.remove('on');}
}
function acceptFuse(){document.getElementById('fuseCard').style.display='none';showPts('✓ 今日轻负荷方案已激活');}

// ════ EMERGENCY ════
function showEmerg(){stopFollow();clearInterval(restInt);document.getElementById('ssHud').classList.remove('on');document.getElementById('restHud').classList.remove('on');document.getElementById('emergOv').classList.add('on');}
function closeEmerg(){document.getElementById('emergOv').classList.remove('on');}

// ════ PTS POP ════
function showPts(text){
  const pop=document.createElement('div');pop.className='ppop';pop.textContent=text;
  const r=document.getElementById('app').getBoundingClientRect();
  pop.style.cssText=`left:${r.left+r.width/2-80}px;top:${r.top+r.height/2}px;font-size:15px`;
  document.body.appendChild(pop);setTimeout(()=>pop.remove(),1600);
}

// ════ MACRO ════
function showMacro(msg){const t=document.getElementById('mtoast');document.getElementById('mtmsg').textContent=msg;t.style.display='block';setTimeout(()=>t.style.display='none',2800);}

// ════ AI COACH ════
const CHIPS=[
  {l:'📅 今日安排',q:'今天应该做 Day A 还是 Day B？'},
  {l:'🩸 血糖偏高',q:'血糖 158 偏高，训练前还是训练后步行效果更好？'},
  {l:'🦵 膝关节',q:'我膝关节在康复中，Split-Squat 需要注意什么？'},
  {l:'😴 睡眠差',q:'昨晚只睡了 5 小时，今天训练强度应该怎么调整？'},
  {l:'💪 下一步',q:'Verna 4 周计划结束后，应该怎么进阶？'},
  {l:'🔢 RPE 太高',q:'Split-Squat 第一组 RPE 9，下一组应该怎么调整？'},
];
function renderChips(){document.getElementById('promptBar').innerHTML=CHIPS.map(c=>`<div class="pc" onclick="sendQ('${c.q}')">${c.l}</div>`).join('');}
function sendQ(q){document.getElementById('coachInp').value=q;sendMsg();}
function addMsg(role,html){const a=document.getElementById('chatArea');const d=document.createElement('div');d.className='cm '+role;d.innerHTML=role==='ai'?`<div class="ailbl">🔥 熔归教练</div>`+html:html;a.appendChild(d);scrollChat();}
function addTyping(){const a=document.getElementById('chatArea');const d=document.createElement('div');d.id='typingInd';d.className='cm ai';d.innerHTML=`<div class="ailbl">🔥 熔归教练</div><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>`;a.appendChild(d);scrollChat();}
function removeTyping(){const t=document.getElementById('typingInd');if(t)t.remove();}
function scrollChat(){setTimeout(()=>document.getElementById('chatPad').scrollIntoView({behavior:'smooth'}),100);}

async function sendMsg(){
  const inp=document.getElementById('coachInp');
  const q=inp.value.trim();if(!q)return;
  inp.value='';addMsg('user',q);addTyping();
  const sys=`你是 Jennifer（Jing）的私人 AI 训练教练，名叫"熔归教练"。

【Jennifer 健康档案】
- 前驱糖尿病，CGM 监测，目标餐后血糖 <140 mg/dL，当前读数 158 mg/dL（偏高）
- PT 膝关节康复（Verna Chen），周一/三/五做5个PT练习：Knee CARs、Clamshells贴墙、Marching Bridge、Standing Clam、Soleus Raises
- 当前训练：Verna 4周下肢+核心计划——超级组结构（A1+A2, B1+B2, C1+C2）
  Week 1-2: 每组2组，Week 3-4: 每组3组，次数从6-8渐进至12-15
- 今日睡眠：总7.2h，深睡2.1h，REM1.8h，HRV68ms（历史高位）
- 步数：今日8432步

【动作列表】
Day A超级组：Split-Squat+Prone Swimmer / Single-Leg RDL+Incline Push-Up / Bear Squat+Side Planks
Day B超级组：Glute Bridge March+Bench Dips / Step-Up+Shoulder Taps(放慢) / Inchworm+Deadbug w/Wall Press

【回复规则】
- 中文，结论先行，直接给建议，像真正了解她身体的教练
- 涉及血糖：结合餐后步行时机（10分钟内开始）和胰岛素敏感度
- 涉及膝关节：给出具体修改方案，不要只说"注意"
- 涉及RPE：直接说怎么调整次数或动作
- 对话式，不超过200字；制定计划可详细些
- 偶尔加1句神经唤醒式动作提示（引号括起）`;
  try{
    const apiBase = window.FITNESS_API || '';
    const res=await fetch(apiBase + '/api/fitness/chat',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({system: sys, user: q})
    });
    const data=await res.json();removeTyping();
    if(res.ok && data.text){
      const txt=data.text
        .replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--tx)">$1</strong>')
        .replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
      addMsg('ai',txt);
    }else addMsg('ai', data.detail || data.error || '响应异常，请重试。');
  }catch(e){removeTyping();addMsg('ai','网络错误，请重试。');}
}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.getElementById('coachInp')===document.activeElement)sendMsg();});

// ════ AUDIO UI ════
function toggleAudioPanel(){
  document.getElementById('audioPanel').classList.toggle('on');
}
function initAudioUI(){
  const sel=document.getElementById('bgmSelect');
  if(!sel)return;
  sel.innerHTML=AudioEngine.BGM_TRACKS.map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
}

// ════ INIT ════
initAudioUI();
renderPlan();renderLib();