// 肌肉高亮人体图 + 动态跟练演示
const DemoPlayer = (() => {
  const BODY_SVG = `<svg viewBox="0 0 120 200" class="body-svg" xmlns="http://www.w3.org/2000/svg">
    <g class="body-base" fill="#1f2a3e" stroke="#2a3548" stroke-width="1">
      <ellipse cx="60" cy="22" rx="16" ry="18"/>
      <path d="M44 38 L76 38 L72 52 L48 52 Z"/>
      <path class="mr chest" data-r="chest" d="M48 52 L72 52 L70 78 L50 78 Z"/>
      <path class="mr shoulder" data-r="shoulder" d="M34 52 L48 52 L50 68 L38 68 Z M72 52 L86 52 L82 68 L70 68 Z"/>
      <path class="mr core" data-r="core" d="M50 78 L70 78 L68 108 L52 108 Z"/>
      <path class="mr back" data-r="back" d="M52 78 L68 78 L66 100 L54 100 Z" opacity=".5"/>
      <path class="mr glute" data-r="glute" d="M50 108 L70 108 L68 128 L52 128 Z"/>
      <path class="mr quad" data-r="quad" d="M50 128 L58 128 L56 168 L48 168 Z M62 128 L70 128 L72 168 L64 168 Z"/>
      <path class="mr ham" data-r="ham" d="M48 128 L56 128 L54 165 L46 165 Z M64 128 L72 128 L74 165 L66 165 Z"/>
      <path class="mr hip" data-r="hip" d="M48 108 L72 108 L70 132 L50 132 Z" opacity=".4"/>
      <path class="mr tricep" data-r="tricep" d="M32 68 L38 68 L36 92 L30 92 Z M82 68 L88 68 L90 92 L84 92 Z"/>
      <path class="mr calf" data-r="calf" d="M48 168 L56 168 L54 192 L50 192 Z M64 168 L72 168 L70 192 L66 192 Z"/>
    </g>
    <g class="demo-figure" fill="none" stroke="var(--ember)" stroke-width="3" stroke-linecap="round">
      <circle class="df-head" cx="60" cy="18" r="8" fill="#2a3548"/>
      <line class="df-torso" x1="60" y1="26" x2="60" y2="70"/>
      <line class="df-arm-l" x1="60" y1="38" x2="40" y2="55"/>
      <line class="df-arm-r" x1="60" y1="38" x2="80" y2="55"/>
      <line class="df-leg-l" x1="60" y1="70" x2="48" y2="110"/>
      <line class="df-leg-r" x1="60" y1="70" x2="72" y2="110"/>
    </g>
  </svg>`;

  function demoClass(type) {
    return String(type || 'mobility').replace(/[^a-z0-9_-]/gi, '') || 'mobility';
  }

  function div(className, id) {
    const el = document.createElement('div');
    if (className) el.className = className;
    if (id) el.id = id;
    return el;
  }

  function parseStaticSvg(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    return document.importNode(doc.documentElement, true);
  }

  function appendText(parent, text) {
    parent.appendChild(document.createTextNode(text));
  }

  function renderMuscleMap(container, media) {
    if (!container || !media) return;
    const primary = media.primary || [];
    const secondary = media.secondary || [];
    container.replaceChildren(parseStaticSvg(BODY_SVG));
    container.querySelectorAll('.mr').forEach((el) => {
      const r = el.dataset.r;
      el.classList.remove('on', 'on2');
      if (primary.includes(r)) {
        el.classList.add('on');
        el.style.fill = MUSCLE_REGIONS[r]?.color || 'var(--ember)';
      } else if (secondary.includes(r)) {
        el.classList.add('on2');
        el.style.fill = MUSCLE_REGIONS[r]?.color || 'var(--cool)';
        el.style.opacity = '0.45';
      }
    });
    const legend = document.createElement('div');
    legend.className = 'muscle-legend';
    [...primary, ...secondary].forEach((r, i) => {
      const info = MUSCLE_REGIONS[r];
      if (!info) return;
      const span = document.createElement('span');
      span.className = i < primary.length ? 'ml-p' : 'ml-s';
      const swatch = document.createElement('i');
      swatch.style.background = info.color;
      span.appendChild(swatch);
      appendText(span, `${info.zh}${i < primary.length ? ' · 主动' : ' · 协同'}`);
      legend.appendChild(span);
    });
    container.appendChild(legend);
  }

  function setDemoType(wrap, type) {
    if (!wrap) return;
    wrap.className = 'demo-stage demo-' + demoClass(type);
  }

  function renderMediaPanel(container, ex, reps) {
    if (!container || !ex) return;
    const media = getMediaForExercise(ex);
    const repInfo = parseRepTarget(reps || ex.reps || '8');
    container.replaceChildren();

    const mediaGrid = div('media-grid');
    const videoWrap = div('media-video-wrap', 'mediaVideoWrap');
    const video = document.createElement('video');
    video.className = 'media-video';
    video.id = 'mediaVideo';
    video.playsInline = true;
    video.loop = true;
    video.muted = true;
    if (media.poster) video.poster = media.poster;

    const ph = div('media-video-ph', 'mediaVideoPh');
    ph.appendChild(div('demo-stage demo-' + demoClass(media.demo), 'demoAnim'));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'media-src-btn';
    toggle.id = 'mediaSrcToggle';
    toggle.title = '切换演示源';
    toggle.textContent = '🎬 真人 / 动画';

    videoWrap.append(video, ph, toggle);
    mediaGrid.append(videoWrap, div('media-muscles', 'muscleMapHost'));

    const followBar = div('follow-bar', 'followBar');
    const phase = div('follow-phase', 'followPhase');
    phase.textContent = '准备';
    const followReps = div('follow-reps', 'followReps');
    followReps.textContent = repInfo.mode === 'time' ? repInfo.target + '秒' : '0 / ' + repInfo.target;
    const followBtn = document.createElement('button');
    followBtn.type = 'button';
    followBtn.className = 'follow-btn';
    followBtn.id = 'followBtn';
    followBtn.setAttribute('onclick', 'toggleFollow()');
    followBtn.textContent = '▶ 开始跟练';
    followBar.append(phase, followReps, followBtn);

    const cueStrip = div('cue-strip', 'cueStrip');
    cueStrip.textContent = ex.cues?.[0] || '';

    container.append(mediaGrid, followBar, cueStrip);

    const mapHost = container.querySelector('#muscleMapHost');
    renderMuscleMap(mapHost, media);

    let useVideo = !!media.video;

    function applySource() {
      if (useVideo && media.video) {
        video.src = media.video;
        video.style.display = 'block';
        ph.style.display = 'none';
        video.play().catch(() => {
          useVideo = false;
          video.style.display = 'none';
          ph.style.display = 'flex';
          setDemoType(ph.querySelector('#demoAnim'), media.demo);
        });
      } else {
        video.style.display = 'none';
        ph.style.display = 'flex';
        setDemoType(ph.querySelector('#demoAnim'), media.demo);
      }
    }
    applySource();
    container.querySelector('#mediaSrcToggle')?.addEventListener('click', () => {
      useVideo = !useVideo;
      applySource();
    });
    return { media, repInfo };
  }

  return { renderMuscleMap, renderMediaPanel, setDemoType, BODY_SVG };
})();

// ════ 跟练状态 ════
let followActive = false;
let followTimer = null;
let followRep = 0;
let followSide = 0;
let followMeta = null;

function toggleFollow() {
  if (followActive) stopFollow();
  else startFollow();
}

function startFollow() {
  const ex = EX.find((e) => e.name === document.getElementById('hudEx')?.textContent?.replace(/备注.*/, '').trim());
  if (!ex) return;
  const reps = document.getElementById('hudR')?.textContent?.replace('× ', '') || '8';
  followMeta = { ...getMediaForExercise(ex), ...parseRepTarget(reps) };
  followActive = true;
  followRep = 0;
  followSide = 0;
  const btn = document.getElementById('followBtn');
  if (btn) { btn.textContent = '⏹ 停止跟练'; btn.classList.add('on'); }
  AudioEngine.resume();
  runCountdown(3, () => runFollowSet());
}

function stopFollow() {
  followActive = false;
  if (followTimer) clearTimeout(followTimer);
  followTimer = null;
  const btn = document.getElementById('followBtn');
  if (btn) { btn.textContent = '▶ 开始跟练'; btn.classList.remove('on'); }
  const phase = document.getElementById('followPhase');
  const reps = document.getElementById('followReps');
  if (phase) phase.textContent = '准备';
  if (reps && followMeta) {
    reps.textContent = followMeta.mode === 'time' ? followMeta.target + '秒' : '0 / ' + followMeta.target;
  }
  document.getElementById('demoAnim')?.classList.remove('phase-down', 'phase-up', 'phase-hold');
}

function runCountdown(n, done) {
  const phase = document.getElementById('followPhase');
  if (!followActive) return;
  if (n > 0) {
    if (phase) phase.textContent = n;
    AudioEngine.playCount(n);
    followTimer = setTimeout(() => runCountdown(n - 1, done), 900);
  } else {
    if (phase) phase.textContent = '开始！';
    AudioEngine.playGo();
    followTimer = setTimeout(done, 500);
  }
}

function runFollowSet() {
  if (!followActive || !followMeta) return;
  const phase = document.getElementById('followPhase');
  const repsEl = document.getElementById('followReps');
  const anim = document.getElementById('demoAnim');
  const tempo = followMeta.tempo || { down: 2, hold: 1, up: 1 };

  if (followMeta.mode === 'time') {
    let left = followMeta.target;
    const tick = () => {
      if (!followActive) return;
      if (phase) phase.textContent = followMeta.perSide && followSide === 0 ? '左侧保持' : followMeta.perSide ? '右侧保持' : '保持';
      if (repsEl) repsEl.textContent = left + ' 秒';
      if (left <= 3 && left > 0) AudioEngine.playTick();
      if (left <= 0) {
        if (followMeta.perSide && followSide === 0) {
          followSide = 1;
          left = followMeta.target;
          AudioEngine.playSetDone();
          followTimer = setTimeout(tick, 600);
          return;
        }
        AudioEngine.playSetDone();
        if (phase) phase.textContent = '完成 ✓';
        stopFollow();
        return;
      }
      left--;
      followTimer = setTimeout(tick, 1000);
    };
    tick();
    return;
  }

  function nextRep() {
    if (!followActive) return;
    followRep++;
    const sideLabel = followMeta.perSide ? (followSide === 0 ? ' · 左' : ' · 右') : '';
    if (repsEl) repsEl.textContent = followRep + ' / ' + followMeta.target + sideLabel;
    AudioEngine.playRep();

    function phaseSeq(p, ms, next) {
      if (!followActive) return;
      if (phase) phase.textContent = p + sideLabel;
      if (anim) {
        anim.classList.remove('phase-down', 'phase-up', 'phase-hold');
        if (p.includes('下放')) anim.classList.add('phase-down');
        else if (p.includes('推起') || p.includes('起身')) anim.classList.add('phase-up');
        else anim.classList.add('phase-hold');
      }
      AudioEngine.playPhase(p.includes('下放') ? 'down' : p.includes('推起') || p.includes('起身') ? 'up' : 'hold');
      followTimer = setTimeout(next, ms * 1000);
    }

    phaseSeq('下放', tempo.down || 2, () =>
      phaseSeq(tempo.hold ? '保持' : '推起', tempo.hold || 0, () =>
        phaseSeq('推起', tempo.up || 1, () => {
          if (followRep >= followMeta.target) {
            if (followMeta.perSide && followSide === 0) {
              followRep = 0;
              followSide = 1;
              AudioEngine.playSetDone();
              if (phase) phase.textContent = '换边';
              followTimer = setTimeout(() => runCountdown(3, nextRep), 800);
              return;
            }
            AudioEngine.playSetDone();
            if (phase) phase.textContent = '完成 ✓';
            stopFollow();
            return;
          }
          nextRep();
        })
      )
    );
  }
  nextRep();
}

// ════ 全屏跟练浮层（HUD 入口）════
let foActive = false;
let foPaused = false;
let foTimer = null;
let foRep = 0;
let foSide = 0;
let foMeta = null;

function openFollowFromHud() {
  const name = document.getElementById('hudEx')?.textContent?.trim();
  if (!name) return;
  const ex = EX.find((e) => e.name === name);
  const reps = document.getElementById('hudR')?.textContent?.replace('× ', '') || '8';
  foMeta = ex
    ? { ...getMediaForExercise(ex), ...parseRepTarget(reps) }
    : { demo: 'mobility', tempo: { down: 2, hold: 1, up: 1 }, ...parseRepTarget(reps) };

  document.getElementById('foName').textContent = name;
  document.getElementById('foRepTgt').textContent = String(foMeta.target);
  document.getElementById('foRepNow').textContent = '0';
  document.getElementById('foCd').textContent = '3';
  document.getElementById('foCd').classList.remove('show');
  document.getElementById('foPhase').textContent = '准备开始';
  document.getElementById('foPhase').className = 'fo-phase ecc';

  const foFig = document.getElementById('foFig');
  foFig.replaceChildren();
  const stage = document.createElement('div');
  const foDemo = String(foMeta.demo || 'mobility').replace(/[^a-z0-9_-]/gi, '') || 'mobility';
  stage.className = 'demo-stage demo-' + foDemo;
  stage.id = 'foDemoAnim';
  foFig.appendChild(stage);

  const arc = document.getElementById('foRingArc');
  if (arc) arc.style.strokeDashoffset = '829';

  document.getElementById('foGoBtn').style.display = '';
  document.getElementById('foPauseBtn').style.display = 'none';
  document.getElementById('foPauseBtn').textContent = '⏸ 暂停';
  document.getElementById('followOv').classList.add('on');
  foActive = false;
  foPaused = false;
  if (foTimer) clearTimeout(foTimer);
  if (typeof AudioEngine !== 'undefined') AudioEngine.resume();
}

function closeFollow() {
  foActive = false;
  foPaused = false;
  if (foTimer) clearTimeout(foTimer);
  foTimer = null;
  document.getElementById('followOv')?.classList.remove('on');
}

function followGo() {
  if (!foMeta) return;
  foActive = true;
  foPaused = false;
  foRep = 0;
  foSide = 0;
  document.getElementById('foGoBtn').style.display = 'none';
  document.getElementById('foPauseBtn').style.display = '';
  runFoCountdown(3, runFoSet);
}

function followPause() {
  if (!foActive) return;
  foPaused = !foPaused;
  const btn = document.getElementById('foPauseBtn');
  if (btn) btn.textContent = foPaused ? '▶ 继续' : '⏸ 暂停';
}

function runFoCountdown(n, done) {
  const cd = document.getElementById('foCd');
  const phase = document.getElementById('foPhase');
  if (!foActive && n < 3) return;
  if (foPaused) {
    foTimer = setTimeout(() => runFoCountdown(n, done), 200);
    return;
  }
  if (n > 0) {
    if (cd) { cd.textContent = String(n); cd.classList.add('show'); }
    if (phase) phase.textContent = '准备';
    if (typeof AudioEngine !== 'undefined') AudioEngine.playCount(n);
    foTimer = setTimeout(() => runFoCountdown(n - 1, done), 900);
  } else {
    if (cd) cd.classList.remove('show');
    if (phase) phase.textContent = '开始！';
    if (typeof AudioEngine !== 'undefined') AudioEngine.playGo();
    foTimer = setTimeout(done, 500);
  }
}

function updateFoRing(progress) {
  const arc = document.getElementById('foRingArc');
  if (!arc || !foMeta) return;
  const total = foMeta.mode === 'time' ? foMeta.target : foMeta.target;
  const p = Math.min(1, progress / total);
  arc.style.strokeDashoffset = String(829 * (1 - p));
}

function runFoSet() {
  if (!foActive || !foMeta) return;
  const phase = document.getElementById('foPhase');
  const repsEl = document.getElementById('foRepNow');
  const anim = document.getElementById('foDemoAnim');
  const tempo = foMeta.tempo || { down: 2, hold: 1, up: 1 };

  if (foMeta.mode === 'time') {
    let left = foMeta.target;
    const tick = () => {
      if (!foActive) return;
      if (foPaused) { foTimer = setTimeout(tick, 200); return; }
      if (phase) {
        phase.textContent = foMeta.perSide && foSide === 0 ? '左侧保持' : foMeta.perSide ? '右侧保持' : '保持';
        phase.className = 'fo-phase con';
      }
      if (repsEl) repsEl.textContent = String(left);
      updateFoRing(foMeta.target - left);
      if (left <= 3 && left > 0 && typeof AudioEngine !== 'undefined') AudioEngine.playTick();
      if (left <= 0) {
        if (foMeta.perSide && foSide === 0) {
          foSide = 1;
          left = foMeta.target;
          if (typeof AudioEngine !== 'undefined') AudioEngine.playSetDone();
          foTimer = setTimeout(tick, 600);
          return;
        }
        if (typeof AudioEngine !== 'undefined') AudioEngine.playSetDone();
        if (phase) phase.textContent = '完成 ✓';
        closeFollow();
        return;
      }
      left--;
      foTimer = setTimeout(tick, 1000);
    };
    tick();
    return;
  }

  function nextRep() {
    if (!foActive) return;
    if (foPaused) { foTimer = setTimeout(nextRep, 200); return; }
    foRep++;
    const sideLabel = foMeta.perSide ? (foSide === 0 ? ' · 左' : ' · 右') : '';
    if (repsEl) repsEl.textContent = String(foRep);
    updateFoRing(foRep);
    if (typeof AudioEngine !== 'undefined') AudioEngine.playRep();

    function phaseSeq(label, ms, next) {
      if (!foActive) return;
      if (foPaused) { foTimer = setTimeout(() => phaseSeq(label, ms, next), 200); return; }
      if (phase) {
        phase.textContent = label + sideLabel;
        phase.className = 'fo-phase ' + (label.includes('下放') ? 'ecc' : 'con');
      }
      if (anim) {
        anim.classList.remove('phase-down', 'phase-up', 'phase-hold');
        if (label.includes('下放')) anim.classList.add('phase-down');
        else if (label.includes('推起') || label.includes('起身')) anim.classList.add('phase-up');
        else anim.classList.add('phase-hold');
      }
      if (typeof AudioEngine !== 'undefined') {
        AudioEngine.playPhase(label.includes('下放') ? 'down' : label.includes('推起') || label.includes('起身') ? 'up' : 'hold');
      }
      foTimer = setTimeout(next, ms * 1000);
    }

    phaseSeq('下放', tempo.down || 2, () =>
      phaseSeq(tempo.hold ? '保持' : '推起', tempo.hold || 0, () =>
        phaseSeq('推起', tempo.up || 1, () => {
          if (foRep >= foMeta.target) {
            if (foMeta.perSide && foSide === 0) {
              foRep = 0;
              foSide = 1;
              if (typeof AudioEngine !== 'undefined') AudioEngine.playSetDone();
              if (phase) phase.textContent = '换边';
              foTimer = setTimeout(() => runFoCountdown(3, nextRep), 800);
              return;
            }
            if (typeof AudioEngine !== 'undefined') AudioEngine.playSetDone();
            if (phase) phase.textContent = '完成 ✓';
            closeFollow();
            return;
          }
          nextRep();
        })
      )
    );
  }
  nextRep();
}
