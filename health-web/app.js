(function () {
  'use strict';
  const D = window.SU_DATA;
  const TITLES = ['今日身体', '关联发现', '个人实验', '家庭档案', '溯医 AI'];
  const MEALS = [
    { t: '7:30', label: '早餐', peak: 116, icon: '🍳', x: 42 },
    { t: '10:30', label: '加餐', peak: 108, icon: '🧀', x: 120 },
    { t: '12:30', label: '午餐', peak: 134, icon: '🥗', x: 195 },
    { t: '12:43', label: '走路', peak: null, icon: '🚶', x: 210, walk: true },
    { t: '18:30', label: '晚餐', peak: 128, icon: '🍽️', x: 290 },
  ];
  const GLUCOSE = [95, 98, 102, 108, 116, 112, 105, 108, 112, 118, 125, 132, 134, 128, 120, 115, 110, 108, 112, 118, 125, 128, 122, 115, 108, 102, 98, 95];
  const METRICS = [
    { k: 'TIR', v: '73', u: '%', d: '↑ 6%', cls: 'up' },
    { k: '步数', v: '8.4', u: 'k', d: '↑ 1.2k', cls: 'up' },
    { k: 'HRV', v: '+0.4', u: 'MAD', d: '恢复中', cls: 'up' },
  ];
  const SYSTEMS = [
    { icon: '🫀', n: '代谢', d: '血糖 · 胰岛素敏感性', z: '+0.6', cls: 'up' },
    { icon: '💓', n: '心血管', d: 'HRV · 静息心率', z: '+0.3', cls: 'up' },
    { icon: '😴', n: '睡眠', d: '深睡 · 睡眠债', z: '0.0', cls: 'flat' },
    { icon: '🧠', n: '神经', d: '压力 · 恢复', z: '+0.4', cls: 'up' },
    { icon: '🦴', n: '肌肉骨骼', d: 'PT 依从 · 活动', z: '+0.2', cls: 'up' },
  ];

  let state = {
    tab: 0,
    factors: D.factors.map((f) => ({ ...f })),
    storyView: 'narrative',
    ledgerMode: 'timeline',
    member: D.member,
    archiveSec: 'checkups',
    activePattern: null,
    reportType: null,
    activeMeal: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function switchTab(i) {
    state.tab = i;
    $$('.tab').forEach((t, j) => t.classList.toggle('on', j === i));
    $$('.screen').forEach((s, j) => s.classList.toggle('active', j === i));
    $('#topTitle').textContent = TITLES[i];
    $('#scroll').scrollTop = 0;
  }

  /* ── Factors & story ── */
  function renderFactors() {
    const bar = $('#factorBar');
    bar.innerHTML = state.factors
      .map(
        (f) =>
          `<button class="fchip${f.on ? ' on' : ''}" data-id="${f.id}" type="button"><span class="ico">${f.icon}</span>${esc(f.label)}</button>`
      )
      .join('');
    bar.querySelectorAll('.fchip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const f = state.factors.find((x) => x.id === id);
        f.on = !f.on;
        renderFactors();
        updateStory();
        highlightLedger();
      });
    });
  }

  function updateStory() {
    const on = state.factors.filter((f) => f.on);
    const el = $('#storyText');
    el.classList.add('updating');
    let html;
    if (state.storyView === 'factors' && on.length === 1) {
      html = D.storyVariants[on[0].id] || D.storyVariants.all;
    } else if (on.length <= 1) {
      html = D.storyVariants[on[0]?.id] || D.storyVariants.all;
    } else {
      const parts = on.map((f) => D.storyVariants[f.id]).filter(Boolean);
      html = parts.length ? parts.join('<br><br>') : D.storyVariants.all;
    }
    setTimeout(() => {
      el.innerHTML = html;
      el.classList.remove('updating');
    }, 120);
  }

  /* ── Glucose chart (interactive) ── */
  function drawChart(highlightX) {
    const svg = $('#gchart');
    const W = 340,
      H = 168,
      pad = { t: 12, b: 22, l: 8, r: 8 };
    const gw = W - pad.l - pad.r;
    const gh = H - pad.t - pad.b;
    const y = (v) => pad.t + gh - ((v - 70) / 110) * gh;
    const x = (i) => pad.l + (i / (GLUCOSE.length - 1)) * gw;

    const pts = GLUCOSE.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const area = `${x(0)},${y(70)} ${pts} ${x(GLUCOSE.length - 1)},${y(70)}`;

    let marks = '';
    MEALS.forEach((m) => {
      if (m.peak == null) return;
      const xi = Math.round((m.x / W) * (GLUCOSE.length - 1));
      const xv = x(xi);
      const yv = y(m.peak);
      const active = state.activeMeal === m.t;
      marks += `<circle cx="${xv}" cy="${yv}" r="${active ? 7 : 5}" fill="${active ? 'var(--blue-500)' : '#fff'}" stroke="var(--blue-500)" stroke-width="2" data-meal="${m.t}" style="cursor:pointer"/>`;
      if (active) marks += `<line x1="${xv}" y1="${pad.t}" x2="${xv}" y2="${H - pad.b}" stroke="var(--blue-300)" stroke-dasharray="4 3" stroke-width="1"/>`;
    });

    svg.innerHTML = `
      <rect x="${pad.l}" y="${y(140)}" width="${gw}" height="${y(70) - y(140)}" fill="rgba(63,159,134,.08)" rx="2"/>
      <line x1="${pad.l}" y1="${y(140)}" x2="${W - pad.r}" y2="${y(140)}" stroke="var(--warn)" stroke-dasharray="5 4" stroke-width="1" opacity=".7"/>
      <polygon points="${area}" fill="url(#gf)" opacity=".35"/>
      <polyline points="${pts}" fill="none" stroke="var(--blue-500)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <defs><linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--blue-400)"/><stop offset="100%" stop-color="var(--blue-50)"/></linearGradient></defs>
      ${marks}
    `;

    svg.querySelectorAll('circle[data-meal]').forEach((c) => {
      c.addEventListener('click', () => selectMeal(c.dataset.meal));
    });

    svg.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const idx = Math.round(ratio * (GLUCOSE.length - 1));
      const clamped = Math.max(0, Math.min(GLUCOSE.length - 1, idx));
      const val = GLUCOSE[clamped];
      const tip = $('#gTip');
      const hour = 6 + Math.round((clamped / (GLUCOSE.length - 1)) * 17);
      tip.textContent = `${hour}:00 · ${val} mg/dL`;
      tip.style.left = `${ratio * 100}%`;
      tip.style.top = '20%';
      tip.classList.add('show');
    };
    svg.onmouseleave = () => $('#gTip').classList.remove('show');
    svg.ontouchstart = svg.onmousemove;
    svg.ontouchend = () => $('#gTip').classList.remove('show');
  }

  function renderMeals() {
    $('#mealRow').innerHTML = MEALS.map(
      (m) =>
        `<div class="meal${m.walk ? ' walk' : ''}${state.activeMeal === m.t ? ' active' : ''}" data-meal="${m.t}"><span>${m.icon}</span><b>${m.t}</b> ${m.label}${m.peak ? '·峰' + m.peak : ' 15min ✓'}</div>`
    ).join('');
    $$('#mealRow .meal').forEach((el) => {
      el.addEventListener('click', () => selectMeal(el.dataset.meal));
    });
  }

  function selectMeal(t) {
    state.activeMeal = state.activeMeal === t ? null : t;
    renderMeals();
    drawChart();
    const m = MEALS.find((x) => x.t === t);
    if (m?.peak) {
      const f = state.factors.find((x) => x.id === 'glucose');
      if (f && !f.on) {
        f.on = true;
        renderFactors();
        updateStory();
      }
    }
  }

  /* ── Ledger ── */
  function highlightLedger() {
    const onIds = new Set(state.factors.filter((f) => f.on).map((f) => f.id));
    $$('#ledgerBox .titem, #ledgerBox .fpair').forEach((el) => {
      const link = el.dataset.link;
      if (!link) return;
      el.style.opacity = onIds.size && !onIds.has(link) ? '0.35' : '1';
    });
  }

  function renderLedger() {
    const box = $('#ledgerBox');
    if (state.ledgerMode === 'timeline') {
      box.innerHTML = `<div class="tline">${D.ledger
        .map(
          (e) =>
            `<div class="titem${e.hit ? ' hit' : ''}" data-link="${e.link || ''}"><div class="tdot">${e.icon}</div><div class="ttime">${esc(e.time)}</div><div class="tact">${esc(e.act)}</div><div class="tbody">${e.body}</div></div>`
        )
        .join('')}</div>`;
    } else {
      const pairs = [];
      for (let i = 0; i < D.ledger.length; i++) {
        const a = D.ledger[i];
        if (!a.body || a.body === '准备进食') continue;
        pairs.push({ a, b: a.body });
      }
      box.innerHTML = `<div class="flowpairs">${pairs
        .map(
          (p) =>
            `<div class="fpair" data-link="${p.a.link || ''}"><div class="a"><b>${esc(p.a.time)} 行为</b>${esc(p.a.act)}</div><div class="arrow">→</div><div class="b"><b>身体响应</b>${p.b}</div></div>`
        )
        .join('')}</div>`;
    }
    highlightLedger();
  }

  /* ── Metrics & systems ── */
  function renderMetrics() {
    $('#metricStrip').innerHTML = METRICS.map(
      (m) =>
        `<div class="metric" data-term="${m.k}"><div class="v">${m.v}<small>${m.u}</small></div><div class="k">${m.k}</div><div class="d ${m.cls}">${m.d}</div></div>`
    ).join('');
    $$('#metricStrip .metric').forEach((el) => {
      el.addEventListener('click', () => {
        switchTab(4);
        askAi(`解释 ${el.dataset.term}`);
      });
    });
  }

  function renderSystems() {
    $('#sysList').innerHTML = SYSTEMS.map(
      (s) =>
        `<div class="sys"><div class="sysic">${s.icon}</div><div class="info"><div class="n">${s.n}</div><div class="d">${s.d}</div></div><div class="zscore"><div class="zv ${s.cls}">${s.z}</div><div class="zk">Z</div></div></div>`
    ).join('');
  }

  /* ── Patterns ── */
  function renderPatterns() {
    const nodes = new Set();
    D.patterns.forEach((p) => {
      nodes.add(p.from);
      nodes.add(p.to);
    });
    const nodeList = [...nodes];
    $('#pGraph').innerHTML = nodeList
      .map((n, i) => {
        const pat = D.patterns.find((p) => p.from === n || p.to === n);
        const on = state.activePattern && pat && (pat.from === n || pat.to === n);
        return `${i ? '<span class="pedge">↔</span>' : ''}<span class="pnode${on ? ' on' : ''}" data-node="${esc(n)}">${esc(n)}</span>`;
      })
      .join('');

    $('#patternList').innerHTML = D.patterns
      .map((p) => {
        const open = state.activePattern === p.id;
        return `<div class="pcard${open ? ' open' : ''}" data-id="${p.id}">
          <div class="ptop"><h3>${esc(p.title)}</h3><span class="badge ${p.level}">${p.level}</span></div>
          <div class="pflow"><span class="mini">${esc(p.from)}</span>→<span class="mini">${esc(p.to)}</span><span class="mini">${esc(p.effect)}</span><span class="mini">滞后 ${esc(p.lag)}</span></div>
          <div class="pbody">${p.body}${p.verified ? ' <b>✓ 已验证</b>' : ''}</div>
        </div>`;
      })
      .join('');

    $$('#patternList .pcard').forEach((card) => {
      card.addEventListener('click', () => {
        state.activePattern = state.activePattern === card.dataset.id ? null : card.dataset.id;
        renderPatterns();
      });
    });

    $$('#pGraph .pnode').forEach((node) => {
      node.addEventListener('click', () => {
        const n = node.dataset.node;
        const pat = D.patterns.find((p) => p.from === n || p.to === n);
        if (pat) {
          state.activePattern = pat.id;
          renderPatterns();
          node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });
  }

  /* ── Experiments ── */
  function renderExperiments() {
    const e = D.experiments.active;
    $('#expActive').innerHTML = `
      <div class="exp-hero">
        <div class="lab">进行中 · 第 ${e.day}/${e.total} 天</div>
        <h2>${esc(e.name)}</h2>
        <div class="desc">随机交叉：「走」vs「坐」。午餐峰为主要终点。</div>
        <div class="prog"><i style="width:${e.progress}%"></i></div>
        <div class="pmeta"><span>${e.progress}% 完成</span><span>效应 ${e.effect} mg/dL (95% CI ${e.ci})</span></div>
        <div class="result">
          <div class="rbox"><div class="rv">${e.effect}</div><div class="rk">mg/dL 效应量</div></div>
          <div class="rbox"><div class="rv">${e.hit}</div><div class="rk">走/坐 达标比</div></div>
        </div>
      </div>`;

    const tbody = $('#expTable tbody');
    tbody.innerHTML = e.daily
      .map(
        (d) =>
          `<tr><td>${d.d}</td><td>${d.arm === '走' ? '🚶 走' : '🪑 坐'}</td><td>${d.peak}</td><td>${d.ok ? '✓' : '—'}</td></tr>`
      )
      .join('');

    const st = e.stats;
    $('#expStats').innerHTML = `
      <div class="statbox"><div class="sv">${st.meanWalk}</div><div class="sk">走 · 平均午餐峰</div></div>
      <div class="statbox"><div class="sv">${st.meanSit}</div><div class="sk">坐 · 平均午餐峰</div></div>
      <div class="statbox"><div class="sv">p=${st.p}</div><div class="sk">统计显著性</div></div>
      <div class="statbox"><div class="sv">${st.power}</div><div class="sk">统计功效</div></div>`;

    const q = D.experiments.queue
      .map((x) => `<div class="recitem"><div class="recic">⏳</div><div class="info"><div class="n">${esc(x.name)}</div><div class="d">排队中</div></div></div>`)
      .join('');
    const done = D.experiments.done
      .map(
        (x) =>
          `<div class="recitem"><div class="recic">${x.ok ? '✓' : '—'}</div><div class="info"><div class="n">${esc(x.name)}</div><div class="d">${esc(x.effect)}</div></div></div>`
      )
      .join('');
    $('#expQueue').innerHTML = q + done;
  }

  /* ── Archive ── */
  function renderMembers() {
    $('#memberBar').innerHTML = D.members
      .map(
        (m) =>
          `<button class="mchip${state.member === m.id ? ' on' : ''}" data-id="${m.id}" type="button"><span class="av">${m.avatar}</span><span><div class="nm">${esc(m.name)}</div><div class="rl">${esc(m.role)}</div></span></button>`
      )
      .join('');
    $$('#memberBar .mchip').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.member = btn.dataset.id;
        renderMembers();
        renderArchive();
        renderCheckupAi();
      });
    });
  }

  function renderArchive() {
    const rec = D.familyRecords[state.member] || D.familyRecords.me;
    const sec = state.archiveSec;
    const box = $('#archiveContent');

    if (sec === 'checkups') {
      box.innerHTML = `<div class="card">${rec.checkups
        .map(
          (c) =>
            `<div class="recitem" data-ai="${esc(c.ai)}"><div class="recic">🏥</div><div class="info"><div class="n">${esc(c.title)} · ${c.date}</div><div class="d">${esc(c.summary)}</div><span class="tag">AI 可解读</span></div></div>`
        )
        .join('')}</div>`;
      $$('#archiveContent .recitem').forEach((el) => {
        el.addEventListener('click', () => {
          switchTab(4);
          addBot(el.querySelector('.d').textContent + '\n\nAI 解读：' + el.dataset.ai);
        });
      });
    } else if (sec === 'meds') {
      box.innerHTML =
        rec.meds.length ?
          `<div class="card">${rec.meds
            .map(
              (m) =>
                `<div class="recitem"><div class="recic">💊</div><div class="info"><div class="n">${esc(m.name)} ${esc(m.dose)}</div><div class="d">${esc(m.sched)}${m.note ? ' · ' + esc(m.note) : ''}</div></div></div>`
            )
            .join('')}</div>` :
          '<div class="card"><p style="color:var(--ink-soft);font-size:13px">暂无用药记录</p></div>';
    } else if (sec === 'vaccines') {
      box.innerHTML = `<div class="card">${rec.vaccines
        .map(
          (v) =>
            `<div class="recitem"><div class="recic">💉</div><div class="info"><div class="n">${esc(v.name)}</div><div class="d">接种 ${v.date} · 下次 ${v.next}</div></div></div>`
        )
        .join('')}</div>`;
    } else if (sec === 'visits') {
      box.innerHTML =
        rec.visits.length ?
          `<div class="card">${rec.visits
            .map(
              (v) =>
                `<div class="recitem"><div class="recic">🩺</div><div class="info"><div class="n">${v.date} · ${esc(v.dept)}</div><div class="d">${esc(v.note)}</div></div></div>`
            )
            .join('')}</div>` :
          '<div class="card"><p style="color:var(--ink-soft);font-size:13px">暂无问诊记录</p></div>';
    } else if (sec === 'library') {
      box.innerHTML = D.diseases
        .map(
          (d) =>
            `<div class="card tight"><div class="card-h"><div class="t">${esc(d.name)}</div></div>${d.tags.map((t) => `<span class="tag">${t}</span>`).join('')}<p style="font-size:12.5px;color:var(--ink-soft);margin-top:8px;line-height:1.55"><b>预警：</b>${esc(d.warn)}<br><b>你的历史：</b>${esc(d.history)}<br><b>指南：</b>${esc(d.guide)}</p></div>`
        )
        .join('');
    } else if (sec === 'alerts') {
      box.innerHTML = D.alerts
        .map(
          (a) =>
            `<div class="alertitem ${a.level}">${esc(a.text)} <button type="button" style="margin-left:6px;border:none;background:transparent;font-weight:800;cursor:pointer;font-family:inherit;color:inherit">→ ${esc(a.action)}</button></div>`
        )
        .join('');
    }
  }

  /* ── AI doctor ── */
  function renderTerms() {
    $('#termRow').innerHTML = D.glossary
      .map((t) => `<button class="termchip" type="button" data-term="${t}">${t}</button>`)
      .join('');
    $$('#termRow .termchip').forEach((btn) => {
      btn.addEventListener('click', () => askAi(`解释 ${btn.dataset.term}`));
    });
  }

  function addBot(text) {
    const chat = $('#aiChat');
    const div = document.createElement('div');
    div.className = 'aibubble bot';
    div.innerHTML = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function addUser(text) {
    const chat = $('#aiChat');
    const div = document.createElement('div');
    div.className = 'aibubble user';
    div.textContent = text;
    chat.appendChild(div);
  }

  function askAi(q) {
    addUser(q);
    const lower = q.toLowerCase();
    let reply = D.aiReplies.default;
    if (/tir|范围/.test(lower)) reply = D.aiReplies.tir;
    else if (/二甲双胍|metformin/.test(lower)) reply = D.aiReplies.metformin;
    else {
      const lib = D.library.find((l) => lower.includes(l.term.toLowerCase()) || q.includes(l.term));
      if (lib) reply = `<b>${lib.term}</b>（${lib.full}）：${lib.desc}<br><br><b>预防/改善：</b>${lib.prevent}`;
    }
    setTimeout(() => addBot(reply), 400);
  }

  function renderCheckupAi() {
    const rec = D.familyRecords[state.member] || D.familyRecords.me;
    const c = rec.checkups[0];
    $('#checkupAi').innerHTML = c
      ? `<q>${esc(c.summary)}</q><p style="margin-top:10px;font-size:12.5px;color:var(--blue-700);font-weight:600;line-height:1.55">🤖 ${esc(c.ai)}</p>`
      : '<p style="color:var(--ink-soft)">暂无体检报告</p>';
  }

  function initAi() {
    addBot('你好，我是溯医助手。可以解释 TIR、AGP、HRV 等名词，解读体检报告，或讨论用药与预防策略。<b>仅供参考，不替代医生诊断。</b>');
    $('#aiSend').addEventListener('click', () => {
      const inp = $('#aiInput');
      const v = inp.value.trim();
      if (!v) return;
      inp.value = '';
      askAi(v);
    });
    $('#aiInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('#aiSend').click();
    });
  }

  /* ── Reports ── */
  function openReport(type) {
    const ov = $('#reportOverlay');
    ov.classList.add('show');
    if (!type) {
      $('#repPicker').style.display = 'grid';
      $('#reportDetail').innerHTML = '';
      $('#reportTitle').textContent = '健康报告';
      return;
    }
    $('#repPicker').style.display = 'none';
    renderReport(type);
  }

  function closeReport() {
    $('#reportOverlay').classList.remove('show');
    state.reportType = null;
  }

  function renderReport(type) {
    state.reportType = type;
    const titles = { daily: '今日日报', weekly: '本周周报', agp: 'AGP 报告', checkup: '体检解读' };
    $('#reportTitle').textContent = titles[type] || '报告';

    if (type === 'daily') {
      $('#reportDetail').innerHTML = `
        <div class="rsec"><div class="rsh">叙事</div><p class="story">${D.storyVariants.all.replace(/<[^>]+>/g, '')}</p></div>
        <div class="divider"></div>
        <div class="rsec"><div class="rsh">血糖</div><div class="gwrap"><svg id="repChart" viewBox="0 0 340 120" width="100%"></svg></div></div>`;
      drawMiniChart('#repChart');
    } else if (type === 'weekly') {
      $('#reportDetail').innerHTML = `
        <div class="rsec"><div class="rsh">TIR 本周</div>
        <div class="tirgrid">
          <svg class="ring" viewBox="0 0 100 100" id="tirRing"><circle cx="50" cy="50" r="40" fill="none" stroke="#e4edf8" stroke-width="12"/><circle cx="50" cy="50" r="40" fill="none" stroke="var(--good)" stroke-width="12" stroke-dasharray="183 251" stroke-linecap="round" transform="rotate(-90 50 50)"/><text x="50" y="54" text-anchor="middle" font-size="18" font-weight="900" fill="var(--ink)">73%</text></svg>
          <div class="tirstats">
            <div class="ts"><span class="sw" style="background:var(--good)"></span>范围内 <b>73%</b></div>
            <div class="ts"><span class="sw" style="background:var(--warn)"></span>偏高 <b>18%</b></div>
            <div class="ts"><span class="sw" style="background:var(--high)"></span>过高 <b>5%</b></div>
            <div class="ts"><span class="sw" style="background:var(--blue-300)"></span>偏低 <b>4%</b></div>
          </div>
        </div></div>
        <div class="divider"></div>
        <div class="rsec"><div class="rsh">系统 Z-score</div>${SYSTEMS.map((s) => `<div class="msys"><div class="mi">${s.icon}</div><div class="mn">${s.n}<span>${s.d}</span></div><div class="mz ${s.cls}">${s.z}</div></div>`).join('')}</div>`;
      $('#tirRing').addEventListener('click', () => askAi('解释 TIR'));
    } else if (type === 'agp') {
      $('#reportDetail').innerHTML = `<div class="rsec"><div class="rsh">AGP 典型日</div><div class="gwrap"><svg id="agpChart" viewBox="0 0 340 140" width="100%"></svg></div><div class="cplabel">点击曲线查看时段详情</div></div>`;
      drawMiniChart('#agpChart', true);
    } else if (type === 'checkup') {
      const c = D.familyRecords.me.checkups[0];
      $('#reportDetail').innerHTML = `<div class="rsec"><div class="rsh">最新体检</div><p class="story">${esc(c.summary)}</p><div class="docq" style="margin-top:12px"><q>AI 解读</q><p style="margin-top:8px;font-size:13px;line-height:1.6">${esc(c.ai)}</p></div></div>`;
    }
  }

  function drawMiniChart(sel, agp) {
    const svg = $(sel);
    if (!svg) return;
    const data = agp ? GLUCOSE.map((v) => v + (Math.random() * 8 - 4)) : GLUCOSE;
    const W = 340,
      H = agp ? 140 : 120,
      pad = 10;
    const y = (v) => H - pad - ((v - 70) / 110) * (H - 2 * pad);
    const x = (i) => pad + (i / (data.length - 1)) * (W - 2 * pad);
    const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="var(--blue-500)" stroke-width="2"/><line x1="${pad}" y1="${y(140)}" x2="${W - pad}" y2="${y(140)}" stroke="var(--warn)" stroke-dasharray="4 3"/>`;
    svg.style.cursor = 'pointer';
    svg.onclick = () => switchTab(4);
  }

  /* ── Init & bindings ── */
  function bindUi() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(+t.dataset.i)));

    $('#ledgerToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.vtbtn');
      if (!btn) return;
      state.ledgerMode = btn.dataset.mode;
      $$('#ledgerToggle .vtbtn').forEach((b) => b.classList.toggle('on', b === btn));
      renderLedger();
    });

    $('#storyViewToggle').addEventListener('click', (e) => {
      const btn = e.target.closest('.vtbtn');
      if (!btn) return;
      state.storyView = btn.dataset.view;
      $$('#storyViewToggle .vtbtn').forEach((b) => b.classList.toggle('on', b === btn));
      updateStory();
    });

    $('#archiveTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.stab');
      if (!btn) return;
      state.archiveSec = btn.dataset.sec;
      $$('#archiveTabs .stab').forEach((b) => b.classList.toggle('on', b === btn));
      renderArchive();
    });

    $('#btnReport').addEventListener('click', () => openReport());
    $('#closeReport').addEventListener('click', closeReport);
    $$('#repPicker .repcard').forEach((c) => {
      c.addEventListener('click', () => openReport(c.dataset.type));
    });

    if (window.Capacitor) document.body.classList.add('capacitor-native');
    if (window.matchMedia('(display-mode: standalone)').matches) document.body.classList.add('standalone-pwa');
    if (location.pathname.includes('/health')) {
      const back = $('#portalBack');
      if (back) back.href = '/';
    }
  }

  function init() {
    const now = new Date();
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    $('#todayDate').textContent = `${now.getMonth() + 1}月${now.getDate()}日 周${days[now.getDay()]}`;

    renderFactors();
    updateStory();
    drawChart();
    renderMeals();
    renderLedger();
    renderMetrics();
    renderSystems();
    renderPatterns();
    renderExperiments();
    renderMembers();
    renderArchive();
    renderTerms();
    renderCheckupAi();
    initAi();
    bindUi();
  }

  window.SU = { switchTab, askAi, openReport };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
