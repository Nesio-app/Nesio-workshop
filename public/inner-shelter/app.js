// ── ENV ──
function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
function apiBase() {
  return window.INNER_SHELTER_API || '';
}

// ── STATE ──
let pts = 180, cur = 's-home', hist = [], lclaimed = false;
let ptAct = -1, ptTmr = null, ptSec = 0, ptRun = false, ptDone = 0;
let bInt = null, bPh = 'in', bCt = 4, wIdx2 = 0, wTmr = null, g541s = 0;
let bglData = [];
let bglCtxSelected = [];
let walkTimerInt = null, walkSec = 600, walkRunning = false;
let ritualDone = new Array(6).fill(false);
const tabM = { 's-home': 'tb0', 's-ifs': 'tb1', 's-canvas': 'tb2', 's-anchor': 'tb3', 's-more': 'tb4' };
const g541 = [
  '👁️ 说出你现在看到的 5 件物品。\n慢慢来，一件一件地说出来。',
  '🤲 找到 4 个你现在可以触碰的东西。\n感受它们的质感——粗糙或光滑？温暖或凉爽？',
  '👂 听一听，你现在能听到 3 种声音吗？\n可以是远处的，也可以是很细微的。',
  '👃 注意 2 种你现在能感受到的气味。\n如果没有气味，想象一个让你平静的香气。',
  '👅 感受嘴里 1 种味道，或者想象你最喜欢的饮料的味道。\n\n✓ 很好，Jennifer。你现在在这里。你是安全的。'
];
const exD = [
  { n: 'Knee CARs', s: 30, d: '膝关节全程缓慢环绕 × 10次' },
  { n: 'Clamshells', s: 45, d: '靠墙侧卧，髋外展 × 10次/侧' },
  { n: 'Marching Bridge', s: 50, d: '臀桥顶端交替抬腿 × 10次/腿' },
  { n: 'Standing Clam', s: 40, d: '站姿单腿髋外展 × 10次/侧' },
  { n: 'Soleus Raises', s: 60, d: '坐姿踮脚跟离心降落 × 15次' }
];

// ── PERSISTENCE ──
function saveState() {
  try {
    localStorage.setItem('is_pts', String(pts));
    localStorage.setItem('is_lclaimed', lclaimed ? '1' : '0');
    localStorage.setItem('is_bgl', JSON.stringify(bglData));
    localStorage.setItem('is_ritual', JSON.stringify(ritualDone));
  } catch (e) { /* ignore */ }
}
function loadState() {
  try {
    const p = localStorage.getItem('is_pts');
    if (p != null) pts = parseInt(p, 10) || 0;
    lclaimed = localStorage.getItem('is_lclaimed') === '1';
    const b = localStorage.getItem('is_bgl');
    if (b) bglData = JSON.parse(b);
    const r = localStorage.getItem('is_ritual');
    if (r) ritualDone = JSON.parse(r);
    setPts(pts);
    if (lclaimed) {
      const lc = document.getElementById('lclaim');
      if (lc) lc.textContent = '✓ 今日已领取';
    }
    ritualDone.forEach((done, i) => {
      if (done) {
        const step = document.getElementById('rs' + i);
        const check = document.getElementById('rc' + i);
        if (step) step.classList.add('done');
        if (check) check.textContent = '✓';
      }
    });
    if (ritualDone.every(Boolean)) {
      const comp = document.getElementById('ritualComplete');
      if (comp) comp.style.display = 'block';
    }
  } catch (e) { /* ignore */ }
}

// ── TIME ──
function updTime() {
  const n = new Date();
  const t = n.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  document.querySelectorAll('.stime').forEach(e => e.textContent = t);
  const ds = n.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const hd = document.getElementById('hdate'); if (hd) hd.textContent = ds;
  const jd = document.getElementById('jdate');
  if (jd) jd.textContent = n.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) + ' · ' + t;
  const h = n.getHours(), tg = document.getElementById('htag');
  if (tg) {
    if (h >= 6 && h < 10) tg.textContent = '🌅 晨间模式 · 开启新的一天';
    else if (h >= 10 && h < 14) tg.textContent = '☀️ 上午模式 · 专注时段';
    else if (h >= 14 && h < 18) tg.textContent = '🌤 下午模式 · 稳步前行';
    else if (h >= 18 && h < 21) tg.textContent = '🌆 傍晚模式 · 过渡休整';
    else tg.textContent = '🌙 晚间模式 · 自动舒缓';
  }
}
updTime(); setInterval(updTime, 15000);

// ── NAV ──
function goTo(id) {
  if (id === cur) return;
  const p = document.getElementById(cur), nx = document.getElementById(id);
  if (!nx) return;
  p.classList.remove('on'); p.classList.add('out');
  setTimeout(() => p.classList.remove('out'), 400);
  nx.classList.add('on'); hist.push(cur); cur = id; nx.scrollTop = 0;
  document.querySelectorAll('.ti').forEach(t => t.classList.remove('on'));
  if (tabM[id]) document.getElementById(tabM[id])?.classList.add('on');
}
function goBack() { const p = hist.pop(); if (p) goTo(p); else goTo('s-home'); }

// ── TOAST ──
let toastT;
function toast(m) {
  const e = document.getElementById('toast');
  e.textContent = m; e.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 4200);
}

// ── PTS ──
function setPts(n) { pts = n; document.querySelectorAll('.pd').forEach(e => e.textContent = pts); saveState(); }
function addPts(n) { setPts(pts + n); toast('✨ +' + n + ' PTS 已到账！当前: ' + pts + ' pts'); }
function resetPts() { setPts(0); toast('积分已重置为 0'); }

// ── ENERGY ──
function setEn(lv, btn) {
  document.querySelectorAll('.enb').forEach(b => b.classList.remove('on')); btn.classList.add('on');
  const m = { hi: '🔥 满电模式！记得留出神经恢复空间。', md: '🌿 稳健充电中，刚刚好。今天的节奏是你的。', lo: '🌙 低电运行。今晚只需要存在就够了。' };
  toast(m[lv]);
  if (lv === 'lo') setW('dusk', document.getElementById('wdu'));
  else if (lv === 'hi') setW('neon', document.getElementById('wn'));
  else setW('def', document.getElementById('wd'));
}

// ── FLASHBACK ──
function openFB() { document.getElementById('fbo').classList.add('open'); startB(); resetWlk(); schedWlk(); }
function closeFB() { document.getElementById('fbo').classList.remove('open'); clearInterval(bInt); clearTimeout(wTmr); }
function startB() {
  bPh = 'in'; bCt = 4; rendB();
  bInt = setInterval(() => {
    bCt--;
    if (bCt <= 0) { bPh = bPh === 'in' ? 'out' : 'in'; bCt = bPh === 'in' ? 4 : 6; }
    rendB();
  }, 1000);
}
function rendB() {
  document.getElementById('bnum').textContent = bCt;
  document.getElementById('bph').textContent = bPh === 'in' ? '吸气' : '呼气';
  document.getElementById('blbl').textContent = bPh === 'in' ? '深深吸气……' : '缓缓呼出……';
}
function resetWlk() {
  wIdx2 = 0;
  document.querySelectorAll('.ws').forEach((s, i) => {
    s.classList.remove('cur', 'dn');
    if (i === 0) s.classList.add('cur');
  });
}
function schedWlk() {
  wTmr = setTimeout(() => {
    const ss = document.querySelectorAll('.ws');
    if (wIdx2 < ss.length - 1) {
      ss[wIdx2].classList.remove('cur'); ss[wIdx2].classList.add('dn');
      wIdx2++; ss[wIdx2].classList.add('cur');
      schedWlk();
    }
  }, 9000);
}

// ── IFS ──
const ANT = ['必须', '应该', '全搞砸', '太失败', '一定要', '绝对', '什么都', '都是我', '不可能', '永远', '从来', '没用', '废物', '不行', '怎么又'];
function scanAnts(v) {
  const f = ANT.filter(w => v.includes(w));
  const af = document.getElementById('antf');
  if (f.length) {
    af.classList.add('on');
    document.getElementById('antch').innerHTML = f.map(w => '<span class="antc">' + w + '</span>').join('');
  } else {
    af.classList.remove('on');
  }
}
function ifsTab(btn, id) {
  document.querySelectorAll('.pbtn').forEach(b => b.classList.remove('on')); btn.classList.add('on');
  document.querySelectorAll('.iftab').forEach(t => t.style.display = 'none');
  document.getElementById(id).style.display = 'flex';
}
async function runIFS() {
  const tx = document.getElementById('ifsta').value.trim();
  if (!tx) { toast('先把心里的声音写出来'); return; }
  document.getElementById('protext').textContent = '我知道你用完美主义和苛责逼迫自己，是因为你极其渴望大后方绝对稳固、害怕任何一丝失控。谢谢你过去一直用这种方式拼命保护过我。';
  document.getElementById('seltext').textContent = '但现在我已经安全了。我拥有足够的理智和力量去建立边界。大后方大门紧锁、万无一失。特许今天理智正式下班。';
  document.getElementById('ppcards').classList.add('on');
  const ai = document.getElementById('ifsai');
  const ait = document.getElementById('ifsait');
  const d = document.getElementById('ifsdots');
  ai.classList.add('on'); ait.textContent = ''; d.style.display = 'inline-flex';
  try {
    const r = await callAI(
      '你是C-CPTSD疗愈助手。规则：不评判不说教；先情感确认再温和整合；禁止鸡汤；用IFS框架（保护者积极意图→清醒自我接管）；结尾给1个2分钟内可执行的物理微动作；不超过180字。',
      '我的内心独白是："' + tx + '"\n请用IFS视角，温柔地帮我看清保护者在保护什么，以及清醒自我如何温柔接管。'
    );
    d.style.display = 'none'; typeIt(ait, r);
  } catch (e) {
    d.style.display = 'none';
    typeIt(ait, '你的内在声音已经被我完整地接住了。保护者一直在用它唯一知道的方式照顾你——这背后是爱，只是方式太严苛了。\n\n📍 现在：把手放在心口，深呼吸三次，对自己说"我已经足够了"。');
  }
}
function evap(id) { document.getElementById(id)?.classList.add('gone'); toast('✨ 已无损蒸发。亏欠感归零，你没有亏欠任何人。'); }

// ── CANVAS ──
function onCV(v) { if (v.length > 3) document.getElementById('bubrow').classList.add('on'); }
function clrCV() {
  document.getElementById('cvta').value = '';
  document.getElementById('bubrow').classList.remove('on');
  document.getElementById('granc').classList.remove('on');
  document.getElementById('cvai').classList.remove('on');
}
function saveCV() { addPts(10); toast('💾 已保存到历史记录 · +10 PTS'); }
async function analyzeCV() {
  const tx = document.getElementById('cvta').value.trim();
  if (!tx) { toast('先把感受写出来'); return; }
  document.getElementById('granc').classList.add('on');
  document.getElementById('cvai').classList.add('on');
  document.getElementById('cvait').textContent = '';
  document.getElementById('cvdots').style.display = 'inline-flex';
  document.getElementById('grant').textContent = '正在解析情绪颗粒……';
  const rv = [0, 0, 0, 0, 0].map(() => Math.random());
  const tot = rv.reduce((a, b) => a + b, 0);
  const pc = rv.map(v => Math.round(v / tot * 100));
  pc[0] += 100 - pc.reduce((a, b) => a + b, 0);
  const ids = ['f', 't', 'h', 'a', 's'];
  const nm = ['恐惧/评价', '带宽透支', '渴望撤退', '愤怒受压', '羞耻感'];
  setTimeout(() => {
    ids.forEach((id, i) => {
      document.getElementById('g' + id).style.width = pc[i] + '%';
      document.getElementById('g' + id + 'p').textContent = pc[i] + '%';
    });
    const t2 = pc.map((p, i) => ({ p: p, n: nm[i] })).sort((a, b) => b.p - a.p).slice(0, 2);
    document.getElementById('grant').textContent = '这背后可能有 ' + t2[0].p + '% 是' + t2[0].n + '，' + t2[1].p + '% 是' + t2[1].n + '，以及其他更细微的层次交织其中。';
  }, 400);
  try {
    const r = await callAI(
      '你是情绪颗粒度分析助手。规则：绝对不粗暴归纳；帮用户发现情绪细微层次（用比例感描述）；语气温柔冷静；第一段2-3句情绪颗粒分析；第二段1句温柔肯定；第三段1个2分钟内物理微动作；不超过200字。',
      '我写下了："' + tx + '"\n请帮我做情绪颗粒度分析，帮我看清更细微的情绪层次，不要粗暴归纳。'
    );
    document.getElementById('cvdots').style.display = 'none';
    typeIt(document.getElementById('cvait'), r);
  } catch (e) {
    document.getElementById('cvdots').style.display = 'none';
    typeIt(document.getElementById('cvait'), '你的感受是真实的，每一层都值得被温柔对待。不需要解决任何事，此刻只需要允许自己感受。\n\n📍 微动作：起身走到 Maple 那里，和它坐在一起 2 分钟。');
  }
}

// ── 541 GROUND ──
function start541() {
  const c = document.getElementById('gcard');
  const t = document.getElementById('gtxt');
  c.style.display = 'block';
  g541s = 0;
  show541(t);
  setTimeout(() => document.getElementById('s-anchor').scrollTo({ top: c.offsetTop - 80, behavior: 'smooth' }), 100);
}
function show541(t) {
  typeIt(t, g541[g541s]);
  if (g541s < g541.length - 1) { g541s++; setTimeout(() => show541(t), 9000); }
}

// ── PT ──
function selEx(i) {
  ptAct = i;
  document.querySelectorAll('.ptex').forEach((e, j) => {
    e.classList.remove('act');
    if (j < i) e.classList.add('dn'); else e.classList.remove('dn');
  });
  document.getElementById('px' + i).classList.add('act');
  document.getElementById('pttb').classList.add('on');
  ptSec = exD[i].s; ptRun = false;
  document.getElementById('pttn').textContent = String(ptSec).padStart(2, '0');
  document.getElementById('pttn2').textContent = exD[i].n;
  document.getElementById('ptdt').textContent = exD[i].d;
  document.getElementById('ptplay').textContent = '▶';
  document.getElementById('ptttl').textContent = exD[i].n;
}
function togglePT() {
  if (ptAct < 0) { toast('请先选择一个动作'); return; }
  if (ptRun) {
    clearInterval(ptTmr); ptRun = false;
    document.getElementById('ptplay').textContent = '▶';
  } else {
    ptRun = true;
    document.getElementById('ptplay').textContent = '⏸';
    ptTmr = setInterval(() => {
      ptSec--;
      document.getElementById('pttn').textContent = String(ptSec).padStart(2, '0');
      if (ptSec <= 0) { clearInterval(ptTmr); ptRun = false; completeEx(ptAct); }
    }, 1000);
  }
}
function resetPT() {
  clearInterval(ptTmr); ptRun = false;
  if (ptAct >= 0) {
    ptSec = exD[ptAct].s;
    document.getElementById('pttn').textContent = String(ptSec).padStart(2, '0');
    document.getElementById('ptplay').textContent = '▶';
  }
}
function completeEx(i) {
  document.getElementById('px' + i).classList.remove('act');
  document.getElementById('px' + i).classList.add('dn');
  document.getElementById('ptplay').textContent = '✓';
  ptDone++;
  document.getElementById('ptrf').style.strokeDashoffset = 340 - (340 * ptDone / 5);
  document.getElementById('ptcur').textContent = ptDone;
  if (ptDone >= 5) {
    document.getElementById('ptttl').textContent = '🎉 全部完成！';
    addPts(25);
  } else {
    const nx = i + 1;
    if (nx < 5) { toast('✓ 完成！下一个：' + exD[nx].n); setTimeout(() => selEx(nx), 1200); }
  }
}

// ── JOURNAL ──
function updMood(v) {
  const e = ['😭', '😢', '😔', '😞', '😐', '🙂', '😊', '😀', '😄', '🤩'];
  document.getElementById('moodemi').textContent = e[Math.min(Math.floor(Number(v)) - 1, 9)];
}
function jTab(btn, id) {
  document.querySelectorAll('.pbtn').forEach(b => b.classList.remove('on')); btn.classList.add('on');
  ['jw', 'jh'].forEach(tid => {
    document.getElementById(tid).style.display = tid === id ? 'flex' : 'none';
  });
}
function saveCBT() { addPts(20); toast('💾 情绪日记已保存 · +20 PTS'); }
async function runCBT() {
  const fields = [1, 2, 3, 4, 5, 6].map(i => (document.getElementById('c' + i) || { value: '' }).value);
  const content = fields.filter(f => f.trim()).join(' | ');
  if (!content) { toast('请先填写至少一段内容'); return; }
  const ai = document.getElementById('jai');
  const ait = document.getElementById('jait');
  const d = document.getElementById('jdots');
  ai.classList.add('on'); ait.textContent = ''; d.style.display = 'inline-flex';
  try {
    const r = await callAI(
      '你是CBT疗愈助手。规则：先完全确认情感不评判；温柔帮用户看到认知扭曲（如有）；用清醒自我视角提供1个替代想法；绝对禁止说教和鸡汤；结尾1个物理微动作；不超过200字。',
      'CBT六步记录：' + content + '\n请温柔地回应这段情绪记录。'
    );
    d.style.display = 'none'; typeIt(ait, r);
  } catch (e) {
    d.style.display = 'none';
    typeIt(ait, '你愿意把这些写下来，本身就是一种勇气。你的感受是真实的，你的反应是可以理解的。\n\n清醒自我说：你不需要在一天内解决所有事情。\n\n📍 微动作：站起来，喝一杯温水。');
  }
}

// ── SHOP ──
function redeem(cost, name, desc) {
  if (pts < cost) { toast('积分不足，还需 ' + (cost - pts) + ' pts'); return; }
  setPts(pts - cost);
  toast('🎁 已兑换！' + desc);
}

// ── COMPASSION LETTER ──
function claimLetter() {
  if (lclaimed) { toast('今日肯定语已领取过了 ✨'); return; }
  lclaimed = true;
  document.getElementById('lclaim').textContent = '✓ 今日已领取';
  addPts(30);
  saveState();
}
async function showLetter() {
  toast('正在为 Jennifer 生成今日专属信件……');
  try {
    const r = await callAI(
      '你是Jennifer的疗愈伴侣。写一封不超过120字的温暖肯定语。规则：用中文；冷静细腻，不说教，不鸡汤；先确认辛苦，再肯定今日的存在本身，最后给一个2分钟内的物理微动作建议。',
      '今天Jennifer完成了一些任务，也有一些未完成。请为她写今晚的温暖肯定语。'
    );
    const lb = document.getElementById('lbody');
    if (lb) lb.textContent = r;
    toast('💌 今日肯定语已更新');
  } catch (e) {
    toast('💌 内在家园永远为你敞开。你已经足够了，Jennifer。');
  }
}

// ── WEATHER ──
function setW(theme, btn) {
  document.querySelectorAll('.wb').forEach(b => b.classList.remove('on'));
  btn && btn.classList.add('on');
  document.body.className = '';
  if (theme === 'neon') document.body.classList.add('wn');
  else if (theme === 'forest') document.body.classList.add('wf');
  else if (theme === 'dusk') document.body.classList.add('wd');
  const nm = { def: '🌙 深夜模式', neon: '💠 霓虹模式', forest: '🌿 森林模式', dusk: '🌅 黄昏模式' };
  toast('界面切换为 ' + (nm[theme] || theme));
}

// ── ONBOARDING ──
function enterApp() {
  try { localStorage.setItem('is_visited', '1'); } catch (e) { }
  const ob = document.getElementById('onboard');
  ob.classList.add('hidden');
  setTimeout(() => { ob.style.display = 'none'; generateLetter(); }, 800);
}
(function checkVisit() {
  try {
    if (localStorage.getItem('is_visited')) {
      const ob = document.getElementById('onboard');
      if (ob) { ob.classList.add('hidden'); ob.style.display = 'none'; }
      generateLetter();
    }
  } catch (e) { }
})();

// ── GENERATE LETTER ──
async function generateLetter() {
  try {
    const n = new Date();
    const dateStr = n.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    const r = await callAI(
      '你是Jennifer的疗愈伴侣。写一封不超过100字的温暖肯定语。规则：用中文；冷静细腻，不说教，不鸡汤；先确认辛苦，再肯定今日的存在本身，语气像一个温暖的老朋友。不需要给动作建议。',
      '今天是' + dateStr + '，Jennifer完成了一天的工作和生活。请为她写今晚的温暖肯定语。'
    );
    const lb = document.getElementById('lbody');
    if (lb) lb.textContent = r;
  } catch (e) { /* keep default */ }
}

// ── BLOOD GLUCOSE ──
function toggleCtx(el) {
  el.classList.toggle('on');
  const txt = el.textContent.trim();
  if (el.classList.contains('on')) bglCtxSelected.push(txt);
  else bglCtxSelected = bglCtxSelected.filter(c => c !== txt);
}
function logBGL() {
  const val = parseInt(document.getElementById('bglInput').value, 10);
  if (!val || val < 50 || val > 400) { toast('请输入有效的血糖值（50-400）'); return; }
  const now = new Date();
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const ctx = bglCtxSelected.join(' · ') || '记录';
  bglData.push({ val: val, ctx: ctx, time: timeStr });
  const disp = document.getElementById('bglDisplay');
  disp.textContent = val;
  disp.className = 'bgl-big ' + (val < 140 ? 'safe' : val < 160 ? 'warn' : 'high');
  const ins = document.getElementById('bglInsight');
  if (val >= 140) {
    ins.textContent = '这次血糖偏高（' + val + ' mg/dL）。关键提示：现在立刻进行 10 分钟步行，可以帮助降低峰值。不需要大强度，在家走动也有效。';
    toast('⚠️ 血糖 ' + val + '，建议立刻开始10分钟步行');
  } else {
    ins.textContent = '很好！这次血糖 ' + val + ' mg/dL，在目标范围内。保持饭后步行习惯，这是你控制餐后峰值最有效的单一变量。';
    toast('✓ 血糖 ' + val + ' mg/dL，达标 🎯');
  }
  addBGLLogItem(val, ctx, timeStr);
  updateBGLChart();
  const total = bglData.length + 3;
  const safe = bglData.filter(d => d.val < 140).length + 2;
  document.getElementById('bglRate').textContent = Math.round(safe / total * 100) + '%';
  document.getElementById('bglInput').value = '';
  bglCtxSelected = [];
  document.querySelectorAll('.bgl-ctx').forEach(c => c.classList.remove('on'));
  addPts(5);
  saveState();
}
function addBGLLogItem(val, ctx, timeStr) {
  const log = document.getElementById('bglLog');
  const color = val < 140 ? 'var(--G)' : val < 160 ? 'var(--W)' : 'var(--R)';
  const bdrColor = val < 140 ? 'rgba(139,196,160,.2)' : val < 160 ? 'rgba(212,149,106,.2)' : 'rgba(196,122,122,.2)';
  const div = document.createElement('div');
  div.style.cssText = 'background:var(--surf);border:1px solid ' + bdrColor + ';border-radius:var(--rs);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;animation:fu .3s ease-out';
  const left = document.createElement('div');
  const numSpan = document.createElement('span');
  numSpan.style.cssText = "font-size:20px;font-family:'DM Serif Display',serif;color:" + color;
  numSpan.textContent = val;
  const unitSpan = document.createElement('span');
  unitSpan.style.cssText = 'font-size:11px;color:var(--muted);margin-left:6px';
  unitSpan.textContent = 'mg/dL';
  left.appendChild(numSpan); left.appendChild(unitSpan);
  const right = document.createElement('div');
  right.style.textAlign = 'right';
  const ctxDiv = document.createElement('div');
  ctxDiv.style.cssText = 'font-size:12px;color:var(--soft)';
  ctxDiv.textContent = ctx;
  const timeDiv = document.createElement('div');
  timeDiv.style.cssText = 'font-size:11px;color:var(--muted)';
  timeDiv.textContent = timeStr;
  right.appendChild(ctxDiv); right.appendChild(timeDiv);
  div.appendChild(left); div.appendChild(right);
  log.insertBefore(div, log.firstChild);
}
function updateBGLChart() {
  const bars = document.getElementById('bglBars');
  if (!bars) return;
  const demoData = [{ val: 118, lbl: '12:30' }, { val: 134, lbl: '13:45' }, { val: 152, lbl: '19:10' }];
  const allData = demoData.concat(bglData.map(d => ({ val: d.val, lbl: d.time })));
  const maxVal = Math.max.apply(null, allData.map(d => d.val).concat([200]));
  bars.innerHTML = allData.map(function (d) {
    const h = Math.round((d.val / maxVal) * 80);
    const cls = d.val < 140 ? 'safe' : d.val < 160 ? 'warn' : 'high';
    return '<div class="bgl-bar-wrap"><div class="bgl-bar ' + cls + '" style="height:' + h + 'px"></div><div class="bgl-bar-lbl">' + d.lbl + '</div></div>';
  }).join('');
}
function startWalkTimer() {
  if (walkRunning) {
    clearInterval(walkTimerInt); walkRunning = false;
    document.getElementById('bglWalkTimer').textContent = '10:00'; walkSec = 600;
    toast('步行计时已停止');
    return;
  }
  walkRunning = true; walkSec = 600;
  toast('🚶 开始步行！10分钟后你的血糖会感谢你。');
  walkTimerInt = setInterval(function () {
    walkSec--;
    const m = Math.floor(walkSec / 60), s = walkSec % 60;
    document.getElementById('bglWalkTimer').textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    if (walkSec <= 0) {
      clearInterval(walkTimerInt); walkRunning = false;
      document.getElementById('bglWalkTimer').textContent = '✓ 完成';
      toast('🎉 步行完成！+10 PTS · 血糖感谢你');
      addPts(10);
    }
  }, 1000);
}

// ── NIGHT RITUAL ──
function checkRitual(i) {
  ritualDone[i] = !ritualDone[i];
  const step = document.getElementById('rs' + i);
  const check = document.getElementById('rc' + i);
  if (ritualDone[i]) {
    step.classList.add('done'); check.textContent = '✓';
    step.classList.add('pulse'); setTimeout(() => step.classList.remove('pulse'), 500);
  } else {
    step.classList.remove('done'); check.textContent = '○';
  }
  const allDone = ritualDone.every(Boolean);
  const comp = document.getElementById('ritualComplete');
  if (comp) comp.style.display = allDone ? 'block' : 'none';
  saveState();
}

// ── AI CALL ──
async function callAI(sys, usr) {
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 15000);
  try {
    const res = await fetch(apiBase() + '/api/inner-shelter/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: sys, user: usr }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('api error');
    const d = await res.json();
    if (!d.text) throw new Error('no text');
    return d.text;
  } finally {
    clearTimeout(timer);
  }
}

// ── TYPEWRITER ──
function typeIt(el, text, delay) {
  if (!delay) delay = 16;
  el.textContent = '';
  var i = 0;
  var tmr = setInterval(function () {
    if (i < text.length) { el.textContent += text[i]; i++; }
    else clearInterval(tmr);
  }, delay);
}

// ── INIT ──
document.getElementById('jw').style.display = 'flex';
document.getElementById('jh').style.display = 'none';
document.getElementById('ia').style.display = 'flex';
document.getElementById('ib').style.display = 'none';
loadState();
updateBGLChart();

if (!isNativeApp() && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (r) {
      if (r.active && !location.protocol.startsWith('http')) r.unregister();
    });
  });
  if (location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(function () { });
  }
}

if (isNativeApp() && window.Capacitor.Plugins) {
  var sb = window.Capacitor.Plugins.StatusBar;
  if (sb) {
    sb.setStyle({ style: 'DARK' }).catch(function () { });
    sb.setBackgroundColor({ color: '#0d0f14' }).catch(function () { });
  }
}
