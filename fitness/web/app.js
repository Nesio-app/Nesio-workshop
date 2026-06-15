// ════════════════ AUDIO ENGINE ════════════════
const AE={
  ctx:null, sfx:true,
  init(){
    if(!this.ctx){this.ctx=new (window.AudioContext||window.webkitAudioContext)();}
    if(this.ctx.state==='suspended')this.ctx.resume();
  },
  beep(f=600,dur=.12,delay=0,type='sine',vol=.22,slide=0){
    if(!this.sfx&&type!=='music')return;
    this.init();
    const t=this.ctx.currentTime+delay;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type==='music'?'sine':type; o.frequency.setValueAtTime(f,t);
    if(slide)o.frequency.exponentialRampToValueAtTime(slide,t+dur);
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(vol,t+.012);
    g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g);g.connect(this.ctx.destination);
    o.start(t);o.stop(t+dur+.05);
  },
  tick(){this.beep(880,.06,0,'square',.12)},
  tickLow(){this.beep(440,.07,0,'square',.1)},
  chime(){this.beep(660,.25,0);this.beep(880,.25,.12);this.beep(1320,.4,.24,'sine',.18)},
  ready(){this.beep(523,.15,0);this.beep(784,.25,.15)},
  whoosh(){this.beep(300,.25,0,'sawtooth',.08,900)},
  eccBeep(){this.beep(330,.18,0,'sine',.2)},
  concBeep(){this.beep(880,.14,0,'sine',.24)},
  repChime(){this.beep(1047,.12,0,'sine',.16)},
  countTick(n){this.beep(n===0?1047:660,n===0?.3:.12,0,'sine',.25)},
  success(){[523,659,784,1047].forEach((f,i)=>this.beep(f,.22,i*.1))},
  pop(){this.beep(500,.1,0,'sine',.15,700)}
};
function toggleSfx(el){
  AE.sfx=!AE.sfx;
  el.textContent=AE.sfx?'🔔 提示音开':'🔕 提示音关';
  el.className='chip '+(AE.sfx?'con':'');
  if(AE.sfx)AE.tick();
}

// ════════════════ MUSIC ENGINE ════════════════
const ME={
  nodes:[],timers:[],current:null,
  stop(){
    this.nodes.forEach(n=>{try{n.stop?n.stop():n.disconnect()}catch(e){}});
    this.timers.forEach(t=>clearInterval(t));
    this.nodes=[];this.timers=[];this.current=null;
    document.getElementById('musicMini').classList.remove('on');
    document.querySelectorAll('.musicrow .chip').forEach(c=>{if(c.id&&c.id.startsWith('mc-'))c.classList.remove('gon')});
  },
  noiseBuf(color){
    AE.init();
    const len=AE.ctx.sampleRate*2,buf=AE.ctx.createBuffer(1,len,AE.ctx.sampleRate);
    const d=buf.getChannelData(0);let last=0;
    for(let i=0;i<len;i++){
      const w=Math.random()*2-1;
      if(color==='brown'){last=(last+.02*w)/1.02;d[i]=last*3.5;}
      else d[i]=w;
    }
    return buf;
  },
  play(name){
    this.stop();AE.init();this.current=name;
    const ctx=AE.ctx,N=this.nodes;
    const master=ctx.createGain();master.gain.value=.5;master.connect(ctx.destination);N.push(master);
    if(name==='rain'){
      const src=ctx.createBufferSource();src.buffer=this.noiseBuf('white');src.loop=true;
      const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=900;
      const g=ctx.createGain();g.gain.value=.25;
      src.connect(f);f.connect(g);g.connect(master);src.start();
      N.push(src,f,g);
      // distant rumble
      const s2=ctx.createBufferSource();s2.buffer=this.noiseBuf('brown');s2.loop=true;
      const f2=ctx.createBiquadFilter();f2.type='lowpass';f2.frequency.value=200;
      const g2=ctx.createGain();g2.gain.value=.12;
      s2.connect(f2);f2.connect(g2);g2.connect(master);s2.start();N.push(s2,f2,g2);
    }
    else if(name==='forest'){
      const src=ctx.createBufferSource();src.buffer=this.noiseBuf('brown');src.loop=true;
      const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=500;
      const g=ctx.createGain();g.gain.value=.15;
      src.connect(f);f.connect(g);g.connect(master);src.start();N.push(src,f,g);
      // random birds
      const tm=setInterval(()=>{
        if(Math.random()<.5){
          const fr=2000+Math.random()*1800;
          AE.beep(fr,.12,0,'music',.06,fr*1.3);
          if(Math.random()<.5)AE.beep(fr*1.1,.1,.15,'music',.05,fr*.9);
        }
      },1400);
      this.timers.push(tm);
    }
    else if(name==='drone'){
      [110,110.8,220,164.8].forEach((fr,i)=>{
        const o=ctx.createOscillator();o.type='sine';o.frequency.value=fr;
        const g=ctx.createGain();g.gain.value=i<2?.09:.04;
        const lfo=ctx.createOscillator();lfo.frequency.value=.08+i*.03;
        const lg=ctx.createGain();lg.gain.value=.025;
        lfo.connect(lg);lg.connect(g.gain);
        o.connect(g);g.connect(master);o.start();lfo.start();
        N.push(o,g,lfo,lg);
      });
    }
    else if(name==='lofi'){
      // pad chords
      const chords=[[220,261.6,329.6],[196,246.9,293.7],[174.6,220,261.6],[196,246.9,329.6]];
      let ci=0;
      const padG=ctx.createGain();padG.gain.value=.06;
      const padF=ctx.createBiquadFilter();padF.type='lowpass';padF.frequency.value=800;
      padG.connect(padF);padF.connect(master);N.push(padG,padF);
      let oscs=[];
      const setChord=()=>{
        oscs.forEach(o=>{try{o.stop()}catch(e){}});oscs=[];
        chords[ci%4].forEach(fr=>{
          const o=ctx.createOscillator();o.type='triangle';o.frequency.value=fr;
          o.detune.value=Math.random()*8-4;
          o.connect(padG);o.start();oscs.push(o);N.push(o);
        });
        ci++;
      };
      setChord();
      this.timers.push(setInterval(setChord,3320));
      // beat: kick + hat at 72bpm
      let beat=0;
      this.timers.push(setInterval(()=>{
        const t=ctx.currentTime;
        if(beat%2===0){ // kick
          const o=ctx.createOscillator(),g=ctx.createGain();
          o.frequency.setValueAtTime(110,t);o.frequency.exponentialRampToValueAtTime(40,t+.12);
          g.gain.setValueAtTime(.3,t);g.gain.exponentialRampToValueAtTime(.001,t+.18);
          o.connect(g);g.connect(master);o.start(t);o.stop(t+.2);
        }
        // hat
        const hs=ctx.createBufferSource();hs.buffer=this.noiseBuf('white');
        const hf=ctx.createBiquadFilter();hf.type='highpass';hf.frequency.value=8000;
        const hg=ctx.createGain();hg.gain.setValueAtTime(.05,t);hg.gain.exponentialRampToValueAtTime(.001,t+.05);
        hs.connect(hf);hf.connect(hg);hg.connect(master);hs.start(t);hs.stop(t+.06);
        beat++;
      },415));
    }
    const names={rain:'🌧 雨声',lofi:'🎧 低保真节拍',forest:'🌲 森林',drone:'🌌 静谧脉冲'};
    document.getElementById('mmName').textContent=names[name];
    document.getElementById('musicMini').classList.add('on');
    document.getElementById('mc-'+name).classList.add('gon');
  }
};
function toggleMusic(name,el){
  if(ME.current===name){ME.stop();return;}
  ME.play(name);
}
function stopMusic(){ME.stop();}

// ════════════════ FIGURE ANIMATION ════════════════
// joints: H head, N neck, P pelvis, K1/A1 front leg, K2/A2 back leg, E elbow, W wrist
function fig(a,b,dur,props,big){
  const sw=big?6:5;
  const L=(p,ks)=>'M'+ks.map(k=>p[k][0]+','+p[k][1]).join(' L');
  const seg=(ks,w)=>{
    const dA=L(a,ks),dB=L(b,ks);
    return `<path fill="none" stroke="#edf0f5" stroke-width="${w||sw}" stroke-linecap="round" stroke-linejoin="round" d="${dA}"><animate attributeName="d" values="${dA};${dB};${dA}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1"/></path>`;
  };
  const pr=(props||[]).map(p=>`<rect x="${p[0]}" y="${p[1]}" width="${p[2]}" height="${p[3]}" rx="3" fill="rgba(232,97,42,.18)" stroke="rgba(232,97,42,.35)" stroke-width="1"/>`).join('');
  return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
  <line x1="8" y1="184" x2="192" y2="184" stroke="rgba(255,255,255,.12)" stroke-width="2"/>${pr}
  <circle r="${big?12:10}" fill="#edf0f5" cx="${a.H[0]}" cy="${a.H[1]}">
    <animate attributeName="cx" values="${a.H[0]};${b.H[0]};${a.H[0]}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1"/>
    <animate attributeName="cy" values="${a.H[1]};${b.H[1]};${a.H[1]}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1"/>
  </circle>
  ${seg(['N','P'],sw+1)}${seg(['P','K1','A1'])}${seg(['P','K2','A2'])}${seg(['N','E','W'])}
  </svg>`;
}
const POSES={
  splitsquat:{a:{H:[100,38],N:[100,54],P:[100,104],K1:[122,138],A1:[122,180],K2:[78,140],A2:[58,180],E:[110,78],W:[118,98]},
    b:{H:[100,62],N:[100,78],P:[100,126],K1:[130,142],A1:[122,180],K2:[74,162],A2:[58,180],E:[112,100],W:[120,120]}},
  rdl:{a:{H:[100,38],N:[100,54],P:[100,104],K1:[100,140],A1:[100,180],K2:[102,140],A2:[104,180],E:[106,78],W:[106,100]},
    b:{H:[52,82],N:[64,90],P:[102,100],K1:[102,140],A1:[100,180],K2:[140,104],A2:[172,108],E:[58,112],W:[54,134]}},
  bridge:{a:{H:[38,168],N:[54,167],P:[104,167],K1:[132,140],A1:[150,178],K2:[130,141],A2:[148,178],E:[68,176],W:[84,177]},
    b:{H:[38,168],N:[54,162],P:[104,132],K1:[134,138],A1:[150,178],K2:[132,139],A2:[148,178],E:[68,176],W:[84,177]}},
  bridgemarch:{a:{H:[38,168],N:[54,162],P:[104,133],K1:[134,138],A1:[150,178],K2:[132,139],A2:[148,178],E:[68,176],W:[84,177]},
    b:{H:[38,168],N:[54,162],P:[104,133],K1:[134,138],A1:[150,178],K2:[108,108],A2:[124,130],E:[68,176],W:[84,177]}},
  pushup:{a:{H:[48,72],N:[62,82],P:[118,118],K1:[148,144],A1:[176,176],K2:[146,145],A2:[174,177],E:[70,104],W:[58,128]},
    b:{H:[42,94],N:[56,102],P:[116,126],K1:[148,148],A1:[176,176],K2:[146,149],A2:[174,177],E:[80,116],W:[58,128]}},
  bear:{a:{H:[52,98],N:[66,110],P:[124,114],K1:[136,150],A1:[150,180],K2:[132,152],A2:[146,180],E:[58,144],W:[54,178]},
    b:{H:[68,112],N:[80,122],P:[146,136],K1:[150,160],A1:[150,180],K2:[146,162],A2:[146,180],E:[60,148],W:[54,178]}},
  sideplank:{a:{H:[40,118],N:[55,124],P:[110,140],K1:[148,156],A1:[180,168],K2:[146,157],A2:[178,169],E:[58,150],W:[52,176]},
    b:{H:[40,108],N:[55,114],P:[110,126],K1:[148,150],A1:[180,168],K2:[146,151],A2:[178,169],E:[58,144],W:[52,176]}},
  dips:{a:{H:[78,66],N:[78,82],P:[84,128],K1:[114,150],A1:[116,180],K2:[112,151],A2:[114,180],E:[64,108],W:[60,130]},
    b:{H:[78,88],N:[78,102],P:[84,144],K1:[116,154],A1:[116,180],K2:[114,155],A2:[114,180],E:[54,118],W:[60,130]}},
  stepup:{a:{H:[82,52],N:[82,68],P:[82,114],K1:[104,134],A1:[116,148],K2:[82,148],A2:[82,180],E:[90,90],W:[96,108]},
    b:{H:[108,28],N:[108,44],P:[108,92],K1:[116,122],A1:[116,148],K2:[100,126],A2:[104,148],E:[116,66],W:[122,84]},
    props:[[104,148,52,36]]},
  shouldertap:{a:{H:[38,94],N:[54,100],P:[112,110],K1:[150,142],A1:[178,174],K2:[148,143],A2:[176,175],E:[54,134],W:[48,172]},
    b:{H:[38,94],N:[54,100],P:[112,110],K1:[150,142],A1:[178,174],K2:[148,143],A2:[176,175],E:[58,112],W:[70,96]}},
  inchworm:{a:{H:[76,118],N:[80,128],P:[104,96],K1:[110,136],A1:[112,180],K2:[108,137],A2:[110,180],E:[66,150],W:[58,178]},
    b:{H:[34,96],N:[48,102],P:[106,110],K1:[142,142],A1:[174,176],K2:[140,143],A2:[172,177],E:[50,136],W:[46,174]}},
  deadbug:{a:{H:[30,166],N:[46,166],P:[96,166],K1:[104,130],A1:[98,106],K2:[106,131],A2:[100,107],E:[56,140],W:[58,114]},
    b:{H:[30,166],N:[46,166],P:[96,166],K1:[104,130],A1:[98,106],K2:[134,148],A2:[166,158],E:[42,128],W:[34,104]}},
  swimmer:{a:{H:[34,168],N:[50,169],P:[106,170],K1:[136,171],A1:[166,173],K2:[134,172],A2:[164,174],E:[28,169],W:[12,169]},
    b:{H:[32,154],N:[48,160],P:[106,168],K1:[136,166],A1:[166,160],K2:[134,167],A2:[164,161],E:[24,158],W:[8,148]}},
  catcow:{a:{H:[46,98],N:[60,108],P:[122,108],K1:[124,150],A1:[124,180],K2:[120,151],A2:[120,180],E:[56,142],W:[52,178]},
    b:{H:[50,118],N:[62,98],P:[122,100],K1:[124,150],A1:[124,180],K2:[120,151],A2:[120,180],E:[56,142],W:[52,178]}},
  s9090:{a:{H:[94,92],N:[94,108],P:[100,148],K1:[132,154],A1:[152,168],K2:[74,158],A2:[58,148],E:[104,124],W:[112,140]},
    b:{H:[80,96],N:[82,112],P:[100,148],K1:[126,158],A1:[148,172],K2:[70,154],A2:[56,142],E:[70,128],W:[62,144]}},
  spiderman:{a:{H:[42,92],N:[56,98],P:[110,112],K1:[72,138],A1:[64,176],K2:[146,142],A2:[176,174],E:[54,132],W:[48,172]},
    b:{H:[42,100],N:[56,106],P:[110,124],K1:[70,144],A1:[64,176],K2:[146,148],A2:[176,174],E:[54,138],W:[48,172]}},
  toetouch:{a:{H:[100,28],N:[100,44],P:[100,102],K1:[100,140],A1:[100,180],K2:[102,140],A2:[104,180],E:[96,24],W:[92,8]},
    b:{H:[94,116],N:[96,124],P:[100,98],K1:[100,140],A1:[100,180],K2:[102,140],A2:[104,180],E:[94,144],W:[94,166]}}
};
function figFor(animKey,dur,big){
  const p=POSES[animKey]||POSES.splitsquat;
  return fig(p.a,p.b,dur||3,p.props,big);
}

// ════════════════ MUSCLE BODY MAP ════════════════
// front view (left) + back view (right) in one svg
function bodyMapSVG(hiP,hiS){
  const cls=id=>hiP.includes(id)?'muscle-r hi-p':hiS.includes(id)?'muscle-r hi-s':'muscle-r';
  return `<svg viewBox="0 0 200 220" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="heatP" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffa24d"/><stop offset=".55" stop-color="#ff6a3d"/><stop offset="1" stop-color="#f23030"/>
    </linearGradient>
    <linearGradient id="heatS" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd58a"/><stop offset="1" stop-color="#ffab4d"/>
    </linearGradient>
  </defs>

  <!-- ════ FRONT ════ -->
  <g>
    <!-- skin / silhouette base -->
    <path class="body-base" d="M50,4 C55,4 58,8 58,13 C58,17 56,20 54,22 C61,23 67,27 69,34 C71,42 73,52 74,63 C75,72 77,82 79,92 C80,99 79,104 76,106 C74,99 72,91 70,85 C70,96 69,104 68,110 C70,122 71,144 68,164 C66,180 64,193 62,202 C61,207 58,208 56,206 C54,200 53,184 52,168 L50,150 L48,168 C47,184 46,200 44,206 C42,208 39,207 38,202 C36,193 34,180 32,164 C29,144 30,122 32,110 C31,104 30,96 30,85 C28,91 26,99 24,106 C21,104 20,99 21,92 C23,82 25,72 26,63 C27,52 29,42 31,34 C33,27 39,23 46,22 C44,20 42,17 42,13 C42,8 45,4 50,4 Z"/>
    <!-- upper trap -->
    <path class="${cls('shoulders')}" d="M41,30 Q50,26 59,30 L56,38 Q50,35 44,38 Z"/>
    <!-- deltoids -->
    <path class="${cls('shoulders')}" d="M41,31 Q31,32 27,43 Q26,49 31,51 Q38,47 42,39 Z"/>
    <path class="${cls('shoulders')}" d="M59,31 Q69,32 73,43 Q74,49 69,51 Q62,47 58,39 Z"/>
    <!-- pectorals -->
    <path class="${cls('chest')}" d="M49,38 L49,60 Q39,61 34,55 Q31,48 34,42 Q41,38 49,38 Z"/>
    <path class="${cls('chest')}" d="M51,38 L51,60 Q61,61 66,55 Q69,48 66,42 Q59,38 51,38 Z"/>
    <!-- biceps (deco) -->
    <path class="body-deco" d="M30,47 Q26,56 27,68 Q31,71 35,68 Q36,57 35,49 Z"/>
    <path class="body-deco" d="M70,47 Q74,56 73,68 Q69,71 65,68 Q64,57 65,49 Z"/>
    <!-- forearms (deco) -->
    <path class="body-deco" d="M27,70 Q24,82 24,96 Q28,99 31,96 Q33,84 33,72 Z"/>
    <path class="body-deco" d="M73,70 Q76,82 76,96 Q72,99 69,96 Q67,84 67,72 Z"/>
    <!-- obliques -->
    <path class="${cls('obliques')}" d="M43,61 Q37,64 36,73 Q36,85 43,93 L44,61 Z"/>
    <path class="${cls('obliques')}" d="M57,61 Q63,64 64,73 Q64,85 57,93 L56,61 Z"/>
    <!-- rectus abdominis -->
    <path class="${cls('abs')}" d="M43,60 Q50,58 57,60 L56,94 Q50,98 44,94 Z"/>
    <path class="bm-seam" d="M50,61 V95 M44,69 H56 M44,77 H56 M44,85 H56"/>
    <!-- hip flexors / lower belly -->
    <path class="${cls('hipflex')}" d="M44,95 Q47,101 50,107 L47,109 Q43,103 43,97 Z"/>
    <path class="${cls('hipflex')}" d="M56,95 Q53,101 50,107 L53,109 Q57,103 57,97 Z"/>
    <!-- quadriceps -->
    <path class="${cls('quads')}" d="M46,104 Q49,105 49,113 Q49,140 46,160 Q40,162 36,157 Q33,138 35,118 Q38,106 46,104 Z"/>
    <path class="${cls('quads')}" d="M54,104 Q51,105 51,113 Q51,140 54,160 Q60,162 64,157 Q67,138 65,118 Q62,106 54,104 Z"/>
    <!-- shin / lower leg -->
    <path class="${cls('calves')}" d="M41,166 Q45,168 45,178 Q44,191 41,198 Q37,193 37,182 Q37,172 41,166 Z"/>
    <path class="${cls('calves')}" d="M59,166 Q55,168 55,178 Q56,191 59,198 Q63,193 63,182 Q63,172 59,166 Z"/>
    <text x="50" y="215" text-anchor="middle" class="bm-label">正面</text>
  </g>

  <!-- ════ BACK ════ -->
  <g transform="translate(100,0)">
    <path class="body-base" d="M50,4 C55,4 58,8 58,13 C58,17 56,20 54,22 C61,23 67,27 69,34 C71,42 73,52 74,63 C75,72 77,82 79,92 C80,99 79,104 76,106 C74,99 72,91 70,85 C70,96 69,104 68,110 C70,122 71,144 68,164 C66,180 64,193 62,202 C61,207 58,208 56,206 C54,200 53,184 52,168 L50,150 L48,168 C47,184 46,200 44,206 C42,208 39,207 38,202 C36,193 34,180 32,164 C29,144 30,122 32,110 C31,104 30,96 30,85 C28,91 26,99 24,106 C21,104 20,99 21,92 C23,82 25,72 26,63 C27,52 29,42 31,34 C33,27 39,23 46,22 C44,20 42,17 42,13 C42,8 45,4 50,4 Z"/>
    <!-- rear delts -->
    <path class="${cls('shoulders')}" d="M41,31 Q31,32 27,43 Q26,49 31,51 Q38,47 42,39 Z"/>
    <path class="${cls('shoulders')}" d="M59,31 Q69,32 73,43 Q74,49 69,51 Q62,47 58,39 Z"/>
    <!-- traps + lats (upper back) -->
    <path class="${cls('upperback')}" d="M41,29 Q50,25 59,29 L65,41 Q58,47 50,47 Q42,47 35,41 Z"/>
    <path class="${cls('upperback')}" d="M36,47 Q33,55 37,68 L48,72 L49,49 Q43,47 36,47 Z"/>
    <path class="${cls('upperback')}" d="M64,47 Q67,55 63,68 L52,72 L51,49 Q57,47 64,47 Z"/>
    <!-- triceps (deco-ish, back of arm) -->
    <path class="${cls('triceps')}" d="M30,47 Q26,57 27,69 Q31,72 35,69 Q36,57 35,49 Z"/>
    <path class="${cls('triceps')}" d="M70,47 Q74,57 73,69 Q69,72 65,69 Q64,57 65,49 Z"/>
    <!-- erector spinae -->
    <path class="${cls('erectors')}" d="M47,49 L47,96 Q44,95 43,89 L44,53 Z"/>
    <path class="${cls('erectors')}" d="M53,49 L53,96 Q56,95 57,89 L56,53 Z"/>
    <!-- glutes -->
    <path class="${cls('glutes')}" d="M49,97 Q39,97 35,106 Q34,117 41,123 Q48,123 49,113 Z"/>
    <path class="${cls('glutes')}" d="M51,97 Q61,97 65,106 Q66,117 59,123 Q52,123 51,113 Z"/>
    <!-- hamstrings -->
    <path class="${cls('hams')}" d="M46,125 Q49,126 49,134 Q49,150 46,160 Q40,162 37,157 Q35,143 37,132 Q40,127 46,125 Z"/>
    <path class="${cls('hams')}" d="M54,125 Q51,126 51,134 Q51,150 54,160 Q60,162 63,157 Q65,143 63,132 Q60,127 54,125 Z"/>
    <!-- calves (gastrocnemius) -->
    <path class="${cls('calves')}" d="M41,166 Q46,169 46,180 Q45,192 41,198 Q36,193 36,182 Q36,171 41,166 Z"/>
    <path class="${cls('calves')}" d="M59,166 Q54,169 54,180 Q55,192 59,198 Q64,193 64,182 Q64,171 59,166 Z"/>
    <text x="50" y="215" text-anchor="middle" class="bm-label">背面</text>
  </g>
  </svg>`;
}
// muscle name → region id
const MREGION={'臀大肌':'glutes','臀中肌':'glutes','梨状肌':'glutes','腘绳肌':'hams','股四头肌':'quads',
'核心':'abs','深层核心':'abs','核心稳定':'abs','横膈膜':'abs','腹外斜肌':'obliques','腰方肌':'erectors',
'竖脊肌':'erectors','脊柱活动度':'erectors','胸大肌':'chest','三角肌前束':'shoulders','肩袖':'shoulders',
'肩部':'shoulders','肱三头肌':'triceps','髂腰肌':'hipflex','髋屈肌群':'hipflex','髋内旋肌群':'hipflex',
'髋关节':'hipflex','腓肠肌':'calves','背阔肌':'upperback','肩胛稳定肌':'upperback'};

// ════════════════ DATA ════════════════
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

// media: 填入你自己录制的视频/GIF URL 即可自动替换骨骼动画
const EX=[
  {id:'glute-bridge',name:'Glute Bridge',anim:'bridge',media:'',muscles:[{n:'臀大肌',t:'p'},{n:'腘绳肌',t:'s'}],
   tags:['glute','hip'],move:['hinge','core_s'],equip:['bodyweight'],diff:'easy',
   cues:['双脚踩地与髋同宽，脚跟离臀约一拳','呼气时收紧臀部向上顶髋，顶点停 1-2 秒','下降时控制速度，不要塌腰','腰部酸说明臀没用力，减小幅度重新找发力感'],
   neural:['想象你要用臀部把地面推穿——不是用背把自己撑起来'],
   warnings:['避免用腰部代偿——顶点时腹部微收紧','脚跟太远会过度激活腘绳肌'],
   mods:['Heels Elevated：脚跟放凳子，增加臀肌拉伸幅度','单腿版本：一侧腿伸直']},
  {id:'split-squat',name:'Split-Squat',anim:'splitsquat',media:'',muscles:[{n:'股四头肌',t:'p'},{n:'臀大肌',t:'s'}],
   tags:['glute','hip'],move:['squat'],equip:['bodyweight'],diff:'med',
   cues:['前脚完全踩地，膝盖追踪第二脚趾方向','后腿膝盖朝地面，躯干保持直立','下降至前腿平行地面或略低','控制离心：2-3 秒向下，1 秒向上'],
   neural:['想象前脚像树根一样扎进地——驱动力来自前腿的臀和股四头'],
   warnings:['膝痛：缩小蹲深，从四分之一程开始','前膝超脚尖太多：臀部再后推一点'],
   mods:['借椅背辅助平衡（初期推荐）','Bulgarian Split Squat：后脚上台（进阶）']},
  {id:'single-leg-rdl',name:'Single-Leg RDL',anim:'rdl',media:'',muscles:[{n:'腘绳肌',t:'p'},{n:'臀大肌',t:'p'},{n:'竖脊肌',t:'s'}],
   tags:['hip','back'],move:['hinge'],equip:['bodyweight','wall','dumbbell'],diff:'med',
   cues:['支撑腿微屈，不要锁死膝关节','臀部向后推，躯干随之前倾——髋铰链而非弯腰','后伸腿与躯干保持一条线','背部中立——不弓背不过度拱腰'],
   neural:['想象臀部向后去撞一扇紧闭的大门——用臀推门，不是用腰弯腰'],
   warnings:['腰部紧张：减少前倾幅度','摇晃正常——借墙没问题，重点是髋铰链感'],
   mods:['手扶墙/椅：消除平衡挑战（Verna 推荐）','手持哑铃：增加负荷同时助平衡']},
  {id:'incline-pushup',name:'Incline Push-Up',anim:'pushup',media:'',muscles:[{n:'胸大肌',t:'p'},{n:'三角肌前束',t:'s'},{n:'肱三头肌',t:'s'}],
   tags:['chest','shoulder'],move:['push'],equip:['bodyweight','bench'],diff:'easy',
   cues:['双手略宽于肩，身体保持一条直线','下降时肘部外展约 45°','胸部触碰台面再推起','不要耸肩——肩胛骨下沉后收'],
   neural:['想象把台面推离你的身体——力量从胸部中心爆发'],
   warnings:['台面越低难度越大，从胸口高度开始','手腕疼痛：尝试拳头俯卧撑'],
   mods:['台面越高越简单','标准俯卧撑：地面最大难度']},
  {id:'bear-squat',name:'Bear Squat',anim:'bear',media:'',muscles:[{n:'股四头肌',t:'p'},{n:'核心',t:'s'}],
   tags:['hip','core'],move:['squat','core_s'],equip:['bodyweight'],diff:'med',
   cues:['四点跪姿，膝盖悬空 2-3 厘米','臀部向脚跟方向缓慢下降，背部平直','膝盖全程不触地','控制速度，感受股四头离心发力'],
   neural:['想象膝盖下方有一块薄冰——轻轻悬浮，永远不要打碎它'],
   warnings:['腰部塌陷：核心是关键','幅度不够：从小幅度建立控制感'],
   mods:['减小悬空高度','加重版：膝盖上放重物']},
  {id:'side-plank',name:'Side Planks',anim:'sideplank',media:'',muscles:[{n:'腹外斜肌',t:'p'},{n:'腰方肌',t:'p'},{n:'臀中肌',t:'s'}],
   tags:['core'],move:['core_s'],equip:['bodyweight'],diff:'med',
   cues:['手肘在肩膀正下方','从头到脚踝保持一条直线','下方髋部向上顶，避免下沉','均匀呼吸，不要憋气'],
   neural:['想象你的骨盆是一碗水——动作期间水绝对不能从侧面洒出来'],
   warnings:['手肘疼痛：确认肘在肩下方','腰痛：先用短杠杆（膝盖弯曲）'],
   mods:['Short Lever（Verna 推荐）：膝盖弯曲叠放','进阶：加髋部抬起']},
  {id:'glute-bridge-march',name:'Glute Bridge March',anim:'bridgemarch',media:'',muscles:[{n:'臀大肌',t:'p'},{n:'核心',t:'s'}],
   tags:['glute','core'],move:['hinge','core_s'],equip:['bodyweight'],diff:'med',
   cues:['先做标准桥到顶点并保持','交替将一侧膝盖抬至 90°','保持骨盆绝对水平','动作要慢：2 秒抬起，2 秒放下'],
   neural:['想象骨盆上放着一杯水，抬腿时水不能洒'],
   warnings:['骨盆下沉是最常见错误','腰部疼痛：降低桥的高度'],
   mods:['Heels Elevated 版本','仅做顶点保持不抬腿']},
  {id:'bench-dips',name:'Bench Dips',anim:'dips',media:'',muscles:[{n:'肱三头肌',t:'p'},{n:'三角肌前束',t:'s'}],
   tags:['chest','shoulder'],move:['push'],equip:['bodyweight','bench'],diff:'easy',
   cues:['双手放凳子边缘，手指朝前','膝盖弯曲 90°，双脚踩地','身体紧贴凳子下沉，肘部向后弯','上推时肘部伸直但不锁死'],
   neural:['专注于肱三头肌——想象用肘关节后侧把自己推起来'],
   warnings:['肩膀疼痛：不要下沉过深','脚越远越难，初期保持膝盖弯曲'],
   mods:['双脚靠近身体：降低难度','双脚抬高（进阶）']},
  {id:'step-up',name:'Step-Up',anim:'stepup',media:'',muscles:[{n:'股四头肌',t:'p'},{n:'臀大肌',t:'p'}],
   tags:['glute','hip'],move:['squat','hinge'],equip:['bodyweight','bench'],diff:'med',
   cues:['台阶高度在膝盖以下（胫骨中段）开始','前脚完全踩实台面，驱动力来自前腿','后腿上来后不借台面发力','向心和离心各控制 2 秒'],
   neural:['把前脚想象成一个活塞——有控制地推地，臀和股四头同时点火'],
   warnings:['台面太高代偿腰部','膝关节内扣：追踪第二脚趾'],
   mods:['从最低台阶逐步加高','手持哑铃：增加负荷']},
  {id:'shoulder-taps',name:'Shoulder Taps',anim:'shouldertap',media:'',muscles:[{n:'核心稳定',t:'p'},{n:'肩袖',t:'s'}],
   tags:['core','shoulder'],move:['core_s','push'],equip:['bodyweight'],diff:'med',
   cues:['平板支撑位，双手与肩同宽','单手触碰对侧肩膀，立即放回','骨盆全程水平——不要左右晃动','核心像防弹背心一样提前收紧'],
   neural:['想象骨盆焊在地上——每次抬手都要提前抵御地面给核心的一拳'],
   warnings:['⚠️ 速度越快越容易旋转——慢才是对的（Verna 特别标注）','双脚适当分开增加支撑面'],
   mods:['双腿宽距','膝盖着地：降低核心要求']},
  {id:'inchworm',name:'Inchworm',anim:'inchworm',media:'',muscles:[{n:'腘绳肌',t:'p'},{n:'核心',t:'s'}],
   tags:['core','back'],move:['hinge','core_s','mobility'],equip:['bodyweight'],diff:'easy',
   cues:['站立开始，双手摸地（膝盖微屈）','手往前爬至平板支撑位','保持 1 秒，再用脚走回来','缓慢进行，感受每个姿势过渡'],
   neural:['这是用全身动作语言跟神经系统说：我们今天要动了'],
   warnings:['腰部塌陷：核心抗伸展是重点','头晕：放慢速度'],
   mods:['缩小爬行距离','加俯卧撑（进阶）']},
  {id:'deadbug',name:'Deadbug w/ Wall Press',anim:'deadbug',media:'',muscles:[{n:'深层核心',t:'p'},{n:'髂腰肌',t:'s'}],
   tags:['core'],move:['core_s'],equip:['bodyweight','wall'],diff:'med',
   cues:['仰卧，腰部自然曲度贴地','双手推墙，提供对侧张力','交替伸展对侧腿，核心对抗旋转','呼气时感受深层核心激活'],
   neural:['把腰部想象成一个被按死的遥控器——腿不管怎么动，腰都不离开地面'],
   warnings:['腰部拱起离地：缩小腿的伸展幅度','越慢效果越好——这是神经控制训练'],
   mods:['无墙版本：双手放胸前','加弹力带：增加对抗张力']},
  {id:'prone-swimmer',name:'Prone Swimmer Hovers',anim:'swimmer',media:'',muscles:[{n:'竖脊肌',t:'p'},{n:'臀大肌',t:'s'}],
   tags:['back','shoulder'],move:['pull','core_s'],equip:['bodyweight'],diff:'easy',
   cues:['俯卧，双臂 Y 字或 T 字形伸展','收紧臀部和背部，手臂和腿微微离地','保持 2-3 秒，感受脊柱两侧发力','下降时控制，不要直接放落'],
   neural:['想象你要用整个后背把天花板托起来'],
   warnings:['颈部不要过度抬起：眼睛看地面','离地 1-2cm 的激活就足够'],
   mods:['单侧版本：对侧手臂和腿','加弹力带增加肩部负荷']},
  {id:'cat-cow',name:'Cat-Cow w/ Belly Breathing',anim:'catcow',media:'',muscles:[{n:'脊柱活动度',t:'p'},{n:'横膈膜',t:'s'}],
   tags:['back','core'],move:['mobility'],equip:['bodyweight'],diff:'easy',
   cues:['四点跪姿，腕在肩下，膝在髋下','猫式：呼气，脊柱向天花板弓起','牛式：吸气，肚子向下，抬头','节奏与呼吸完全同步'],
   neural:['让呼吸来驱动动作，而不是肌肉——顺从身体的节律'],
   warnings:['颈椎不要用力','腕部压力大：拳头支撑'],
   mods:['坐姿版：坐椅子上做脊柱屈伸']},
  {id:'9090',name:'90-90 Hip Rotations',anim:'s9090',media:'',muscles:[{n:'髋内旋肌群',t:'p'},{n:'梨状肌',t:'s'}],
   tags:['hip'],move:['mobility'],equip:['bodyweight'],diff:'easy',
   cues:['坐地，双腿 90-90°','躯干直立，重心缓慢向前腿转换','感受髋关节内外旋','换侧通过髋关节旋转'],
   neural:['想象大腿骨在髋臼里旋转——骨盆是地球，大腿骨是卫星'],
   warnings:['膝关节疼痛：调整角度找无痛范围','不要强迫幅度'],
   mods:['靠墙坐：提供躯干支撑']},
  {id:'spiderman',name:'Spiderman Lunge',anim:'spiderman',media:'',muscles:[{n:'髋屈肌群',t:'p'},{n:'臀大肌',t:'s'}],
   tags:['hip'],move:['squat','mobility'],equip:['bodyweight'],diff:'easy',
   cues:['俯卧撑位开始，一只脚跨步至同侧手外侧','前脚踩实，骨盆下沉','可加上臂开合增加胸椎旋转','控制换侧，每次下沉 2-3 秒'],
   neural:['每一步落地，都在告诉神经系统：这个活动范围是安全的'],
   warnings:['前膝不要内扣','腰部不要塌陷'],
   mods:['减小跨步幅度','加旋转：手臂向上']},
  {id:'toetouch',name:'Toe Touch to Squat + Overhead Reach',anim:'toetouch',media:'',muscles:[{n:'腘绳肌',t:'p'},{n:'髋关节',t:'s'}],
   tags:['hip','shoulder'],move:['hinge','mobility'],equip:['bodyweight'],diff:'easy',
   cues:['站立，双手摸脚趾（膝盖微屈）','过渡到深蹲位，双手向头顶伸展','从深蹲站起——连续流动动作','缓慢进行，感受每个过渡'],
   neural:['这个动作在用全身幅度跟神经系统打招呼'],
   warnings:['腰部圆背：膝盖弯曲更多','头晕：减慢过渡速度'],
   mods:['只做触脚趾','只做深蹲']}
];

// ════════════════ STATE ════════════════
let cWeek=1,cDay='A',mF='all',eF='all',mvF='all';
let sbSun=false,sbHyd=true,sbCars=false;
let hudQ=[],hudIdx=0,hudSet=1,hudTotalSets=2;
let ssInt=null,ssP=0;
let restInt=null,restSec=90,fakeHR=158,readyPlayed=false;
let walkActive=false,walkSec=600,walkInt=null;
let recStage=0;

(function tick(){
  const d=new Date();
  document.getElementById('clock').textContent=d.getHours().toString().padStart(2,'0')+':'+d.getMinutes().toString().padStart(2,'0');
  setTimeout(tick,10000);
})();

function switchTab(n){
  closeCoach();
  document.querySelectorAll('.scr').forEach(s=>s.classList.remove('on'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('scr-'+n).classList.add('on');
  document.getElementById('tab-'+n).classList.add('on');
  document.getElementById('mainScroll').scrollTop=0;
  if(n==='train')renderPlan();
  if(n==='library')renderLib();
}

function openCoach(){
  document.getElementById('coachOv').classList.add('on');
  document.getElementById('coachFab').classList.add('hidden');
  renderChips();
  scrollChat();
}
function closeCoach(){
  document.getElementById('coachOv').classList.remove('on');
  document.getElementById('coachFab').classList.remove('hidden');
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
  if(done===3){document.getElementById('workoutList').style.opacity='1';document.getElementById('workoutList').style.pointerEvents='auto';showPts('+XP 沙盒完成 · 动作库解锁 🔓');AE.chime();}
}
function showSS(){if(sbSun)return;AE.init();document.getElementById('ssFill').style.width='0%';document.getElementById('ssHint').textContent='长按 2 秒激活';document.getElementById('ssIcon').classList.remove('act');document.getElementById('ssOv').classList.add('on');}
function startSScreen(){ssP=0;ssInt=setInterval(()=>{ssP+=5;document.getElementById('ssFill').style.width=ssP+'%';if(ssP>=100){clearInterval(ssInt);AE.pop();document.getElementById('ssIcon').classList.add('act');document.getElementById('ssHint').textContent='皮肤物理防线已建立 ✓';setTimeout(()=>{document.getElementById('ssOv').classList.remove('on');sbSun=true;document.getElementById('stSun').textContent='✓';document.getElementById('stSun').className='sst ok';updSb();},700);}},100);}
function stopSScreen(){if(ssP<100){clearInterval(ssInt);document.getElementById('ssFill').style.width='0%';}}
function addWater(){const fills=[55,70,85,100];const cur=parseInt(document.getElementById('hydFill').style.width);const next=fills.find(f=>f>cur)||100;document.getElementById('hydFill').style.width=next+'%';const mls=[500,800,1100,1500];document.getElementById('hydTxt').textContent=`已记录 ${mls[fills.indexOf(next)]}ml · ${next>=85?'水合充足 ✓':'点击继续补充'}`;if(next>=85)sbHyd=true;AE.tickLow();updSb();}
function startCARs(){if(sbCars)return;AE.init();let c=60;const iv=setInterval(()=>{c--;document.getElementById('carsSub').textContent=`⏱ ${c} 秒 · 跟随节奏活动`;if(c<=5&&c>0)AE.tick();if(c<=0){clearInterval(iv);AE.chime();sbCars=true;document.getElementById('stCars').textContent='✓';document.getElementById('stCars').className='sst ok';document.getElementById('carsSub').textContent='关节激活完毕 ✓';updSb();}},100);}

// ════ HUD ════
function openHud(name){
  const wk=PLAN.weeks[cWeek],pairs=wk[cDay];
  let fp=null;
  pairs.forEach(p=>{if(p.find(e=>e.name===name))fp=p;});
  if(!fp){openDetail(name);return;}
  hudQ=fp;hudIdx=0;hudSet=1;hudTotalSets=wk.sets;
  showHud();
}
function showHud(){
  const ex=hudQ[hudIdx];
  const isLast=hudIdx===hudQ.length-1;
  document.getElementById('hudPhase').textContent=`第 ${hudSet} 组 / 共 ${hudTotalSets} 组`;
  document.getElementById('hudBig').textContent=ex.code;
  document.getElementById('hudBig').style.color=hudIdx===0?'var(--ember)':'var(--cool)';
  document.getElementById('hudEx').textContent=ex.name;
  document.getElementById('hudW').textContent='体重';
  document.getElementById('hudR').textContent='× '+ex.reps;
  const lib=EX.find(e=>e.name===ex.name);
  document.getElementById('hudFig').innerHTML=lib?figFor(lib.anim,3):'';
  const nn=document.getElementById('hudNote');
  if(ex.note){nn.textContent=ex.note;nn.style.display='block';}else{nn.style.display='none';}
  document.getElementById('rpeWrap').className='rpew'+(isLast?' on':'');
  document.getElementById('rpeSlider').value=7;
  document.getElementById('rpeVal').textContent='7';
  const btn=document.getElementById('hudBtn');
  if(!isLast){btn.textContent=`✓ 完成 ${ex.code} → 立刻进入 ${hudQ[1].code}`;btn.className='hudabtn next';}
  else{btn.textContent='✓ 完成超级组 · 进入组间修复';btn.className='hudabtn done';}
  document.getElementById('ssHud').classList.add('on');
}
function hudAction(){
  const isLast=hudIdx===hudQ.length-1;
  if(!isLast){
    AE.whoosh();
    const fl=document.getElementById('ssFlash');
    fl.style.opacity='1';setTimeout(()=>fl.style.opacity='0',300);
    hudIdx++;showHud();
  } else {
    const rpe=parseInt(document.getElementById('rpeSlider').value);
    document.getElementById('ssHud').classList.remove('on');
    if(rpe>=9){showPts('🔻 RPE 过高！AI 建议降低下组次数');AE.tickLow();}
    else if(rpe<=4){showPts('💪 轻松！考虑增加次数');AE.tick();}
    else {showPts('+15 PTS 超级组完成！');AE.repChime();}
    if(hudSet<hudTotalSets){hudSet++;hudIdx=0;startRest();}
    else {showPts('🎉 动作完成！');AE.success();}
  }
}
function closeHud(){document.getElementById('ssHud').classList.remove('on');}

// ════ FOLLOW-ALONG MODE ════
let foEx=null,foTimer=null,foRep=0,foTgt=8,foRunning=false,foPhaseT=null;
function openFollow(name){
  const ex=EX.find(e=>e.name===name);if(!ex)return;
  foEx=ex;foRep=0;foRunning=false;
  // parse target reps from any plan rep string or default
  foTgt=8;
  const m=(getCurrentReps(name)||'8').match(/(\d+)/);if(m)foTgt=parseInt(m[1]);
  document.getElementById('foName').textContent=ex.name;
  document.getElementById('foFig').innerHTML=figFor(ex.anim,4,true);
  document.getElementById('foRepNow').textContent='0';
  document.getElementById('foRepTgt').textContent=foTgt;
  document.getElementById('foPhase').textContent='准备开始';
  document.getElementById('foPhase').className='fo-phase ecc';
  document.getElementById('foGoBtn').style.display='block';
  document.getElementById('foPauseBtn').style.display='none';
  document.getElementById('foRingArc').style.strokeDashoffset='829';
  document.getElementById('followOv').classList.add('on');
}
function getCurrentReps(name){
  const wk=PLAN.weeks[cWeek];
  for(const d of ['A','B'])for(const pair of wk[d])for(const e of pair)if(e.name===name)return e.reps;
  return null;
}
function openFollowFromHud(){
  const ex=hudQ[hudIdx];
  closeHud();
  openFollow(ex.name);
}
function followGo(){
  AE.init();
  document.getElementById('foGoBtn').style.display='none';
  document.getElementById('foPauseBtn').style.display='block';
  // 3-2-1 countdown
  const cd=document.getElementById('foCd');
  cd.style.display='block';
  let n=3;
  cd.textContent=n;AE.countTick(n);
  const cdi=setInterval(()=>{
    n--;
    if(n>0){cd.textContent=n;AE.countTick(n);}
    else{clearInterval(cdi);cd.style.display='none';AE.countTick(0);startFollowLoop();}
  },800);
}
function startFollowLoop(){
  foRunning=true;
  const ring=document.getElementById('foRingArc');
  const phaseEl=document.getElementById('foPhase');
  let cycleStart=Date.now();
  const CYCLE=4000; // 3s ecc + 1s conc
  AE.eccBeep();
  phaseEl.textContent='离心下降 · 3 秒控制';
  phaseEl.className='fo-phase ecc';
  let concPlayed=false;
  foTimer=setInterval(()=>{
    if(!foRunning)return;
    const t=(Date.now()-cycleStart)%CYCLE;
    const prog=t/CYCLE;
    ring.style.strokeDashoffset=String(829*(1-prog));
    ring.style.stroke=t<3000?'var(--cool)':'var(--ember)';
    if(t>=3000&&!concPlayed){
      concPlayed=true;AE.concBeep();
      phaseEl.textContent='向心发力 · 1 秒爆发';
      phaseEl.className='fo-phase conc';
    }
    if(Date.now()-cycleStart>=CYCLE){
      cycleStart=Date.now();concPlayed=false;
      foRep++;
      document.getElementById('foRepNow').textContent=foRep;
      AE.repChime();
      if(foRep>=foTgt){
        stopFollowLoop();
        phaseEl.textContent='🎉 目标完成！';
        phaseEl.className='fo-phase conc';
        AE.success();
        showPts('+10 PTS 跟练完成！');
        setTimeout(closeFollow,1800);
        return;
      }
      AE.eccBeep();
      phaseEl.textContent='离心下降 · 3 秒控制';
      phaseEl.className='fo-phase ecc';
    }
  },50);
}
function stopFollowLoop(){foRunning=false;clearInterval(foTimer);foTimer=null;}
function followPause(){
  if(foRunning){stopFollowLoop();
    document.getElementById('foPauseBtn').textContent='▶ 继续';
    document.getElementById('foPhase').textContent='已暂停';
  }else{
    document.getElementById('foPauseBtn').textContent='⏸ 暂停';
    startFollowLoop();
  }
}
function closeFollow(){stopFollowLoop();document.getElementById('followOv').classList.remove('on');}

// ════ REST ════
const microTasks=[
  '补水黄金期——喝一口水，用手掌轻拍今日主训肌群，强化意念肌肉联结。',
  '用拇指轻压臀大肌外侧，感受肌肉紧张度，建立本体感觉。',
  '缓慢深呼吸——吸气 4 秒，屏息 2 秒，呼气 6 秒，激活副交感。',
  '起立，双手扣背后向后拉伸，感受胸大肌主动放松。',
];
function startRest(){
  restSec=90;fakeHR=158;readyPlayed=false;
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
    if(restSec<=5&&restSec>0)AE.tick();
    if(fakeHR>140)document.getElementById('restTimer').className='resttimer hot';
    else if(fakeHR>118)document.getElementById('restTimer').className='resttimer cool2';
    else{
      document.getElementById('restTimer').className='resttimer rdy';
      document.getElementById('restMsg').textContent='心率已平稳 ✓ 神经电量回满，可以开始下一超级组！';
      document.getElementById('restSkip').textContent='💪 就绪，开始下一超级组';
      document.getElementById('restSkip').className='restskip rdy';
      if(!readyPlayed){readyPlayed=true;AE.ready();}
    }
    if(restSec<=0){clearInterval(restInt);AE.chime();skipRest();}
  },120);
}
function skipRest(){clearInterval(restInt);document.getElementById('restHud').classList.remove('on');showHud();}
function logWater(){showPts('💧 +50ml 已记录');AE.tickLow();}

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
  const dl={easy:['td1','🟢 入门'],med:['td2','🟡 进阶'],hard:['td3','🔴 挑战']};
  const ml={squat:'蹲',hinge:'髋铰链',push:'推',pull:'拉',core_s:'核心稳定',mobility:'活动度'};
  let h='';
  fil.forEach(ex=>{
    const mt=ex.muscles.slice(0,2).map(m=>`<span class="tag tm">${m.n}</span>`).join('');
    const et=`<span class="tag te">${ex.equip[0]==='bodyweight'?'🤸 徒手':ex.equip[0]==='dumbbell'?'🏋️ 哑铃':ex.equip[0]==='bench'?'🛋️ 凳':'🧱 墙'}</span>`;
    const mvt=ex.move.slice(0,2).map(v=>`<span class="tag tv">${ml[v]||v}</span>`).join('');
    const d=dl[ex.diff];
    h+=`<div class="lcard" onclick="openDetail('${ex.name}')">
      <div class="lctop"><div class="lcicon">${figFor(ex.anim,3)}</div>
        <div class="lcinfo"><div class="lcname">${ex.name}</div>
          <div class="lctags">${mt}${et}${mvt}<span class="tag ${d[0]}">${d[1]}</span></div>
        </div>
      </div>
      <div class="lccue">${ex.neural?ex.neural[0]:ex.cues[0]}</div>
    </div>`;
  });
  document.getElementById('libCards').innerHTML=h||'<div style="text-align:center;padding:30px;color:var(--mu)">无匹配动作</div>';
}

// ════ DETAIL ════
function openDetail(name){
  const ex=EX.find(e=>e.name===name);
  if(!ex)return;
  document.getElementById('dovName').textContent=ex.name;
  const ml={squat:'蹲',hinge:'髋铰链',push:'推',pull:'拉',core_s:'核心稳定',mobility:'活动度'};
  const dl={easy:['td1','🟢 入门'],med:['td2','🟡 进阶'],hard:['td3','🔴 挑战']};
  // body map highlight sets
  const hiP=[],hiS=[];
  ex.muscles.forEach(m=>{const r=MREGION[m.n];if(!r)return;if(m.t==='p')hiP.push(r);else hiS.push(r);});
  const legend=ex.muscles.map(m=>`<div class="bml"><div class="bmd ${m.t}"></div>${m.n} · ${m.t==='p'?'主动肌':'协同/稳定'}</div>`).join('');
  const cues=ex.cues.map(c=>`<li>${c}</li>`).join('');
  const neural=ex.neural?ex.neural.map(n=>`<div class="neural">${n}</div>`).join(''):'';
  const warns=ex.warnings.map(w=>`<div class="wi">${w}</div>`).join('');
  const mods=ex.mods.map(m=>`<div class="mi2">${m}</div>`).join('');
  const moves=ex.move.map(v=>`<span class="tag tv">${ml[v]||v}</span>`).join('');
  const d=dl[ex.diff];
  const demoContent=ex.media
    ? `<img src="${ex.media}" style="max-width:100%;max-height:100%;border-radius:10px" alt="${ex.name}">`
    : figFor(ex.anim,3);
  document.getElementById('dovBody').innerHTML=`
    <div class="demo-box">
      <span class="demo-tag">${ex.media?'真人演示':'动态演示 · 循环'}</span>
      ${demoContent}
      <button class="follow-btn" onclick="event.stopPropagation();openFollow('${ex.name}')">▶ 动态跟练</button>
    </div>
    <div class="ds"><div class="dl">肌肉激活图谱</div>
      <div class="bodymap-box">${bodyMapSVG(hiP,hiS)}<div class="bm-legend">${legend}</div></div>
    </div>
    <div class="ds"><div class="dl">运动模式 · 难度</div><div style="display:flex;gap:6px;flex-wrap:wrap">${moves}<span class="tag ${d[0]}">${d[1]}</span></div></div>
    ${neural?`<div class="ds"><div class="dl">神经唤醒语 🧠</div>${neural}</div>`:''}
    <div class="ds"><div class="dl">动作要点</div><div class="dc"><ul class="cuelist">${cues}</ul></div></div>
    <div class="ds"><div class="dl">注意事项</div><div class="dc">${warns}</div></div>
    <div class="ds"><div class="dl">难度调节 · 修改方案</div><div class="dc">${mods}</div></div>
    <div style="height:20px"></div>`;
  document.getElementById('detailOv').classList.add('on');
}
function closeDetail(){document.getElementById('detailOv').classList.remove('on');}

// ════ WORKOUT FLOW ════
function startWorkout(){AE.init();switchTab('train');if(!sbSun)setTimeout(showSS,300);}
function endWorkout(){recStage=0;document.getElementById('heatBall').className='hball hot';document.getElementById('heatBall').textContent='🔥';document.getElementById('recHR').textContent='162';document.getElementById('recBtn').textContent='启动副交感刹车 · 缓慢呼吸';document.getElementById('recBtn').className='recbtn hot';document.getElementById('recovOv').classList.add('on');}
function advRecov(){
  recStage++;
  if(recStage===1){
    document.getElementById('heatBall').textContent='🌡️';
    let hr=162;
    const iv=setInterval(()=>{hr-=3;const el=document.getElementById('recHR');if(el)el.textContent=Math.round(hr);
      if(hr<=110){clearInterval(iv);AE.ready();document.getElementById('heatBall').className='hball cool';document.getElementById('heatBall').textContent='🌿';document.getElementById('recMsg').textContent='神经系统已成功着陆，脱离战斗模式，开启修复窗口。';document.getElementById('recBtn').textContent='✓ 进入修复窗口';document.getElementById('recBtn').className='recbtn cool';}},180);
  }else{document.getElementById('recovOv').classList.remove('on');showPts('+50 PTS 训练结算！');AE.success();setTimeout(()=>openCoach(),900);}
}

// ════ GLUCOSE ════
function logHigh(){document.getElementById('logRow3').style.display='flex';document.getElementById('gcBig').textContent='158';document.getElementById('gcBig').className='gcbig w';document.getElementById('hgval').textContent='158';document.getElementById('hgdot').className='gdot gw';document.getElementById('hgsub').textContent='餐后 1h · ⚠️ 偏高，建议步行';document.getElementById('walkCard').style.display='block';document.getElementById('fuseCard').style.display='block';AE.tickLow();}
function startWalk(){document.getElementById('walkOv').classList.add('on');document.getElementById('walkPts').style.display='none';document.getElementById('walkBtn').textContent='开始走！';walkActive=false;walkSec=600;}
function walkAction(){
  if(!walkActive){walkActive=true;AE.init();document.getElementById('walkBtn').textContent='步行中...';
    walkInt=setInterval(()=>{walkSec--;const m=Math.floor(walkSec/60).toString().padStart(2,'0'),s=(walkSec%60).toString().padStart(2,'0');document.getElementById('walkNum').textContent=m+':'+s;
      if(walkSec<=0){clearInterval(walkInt);AE.success();document.getElementById('walkNum').textContent='完成！';document.getElementById('walkPts').style.display='block';document.getElementById('walkBtn').textContent='关闭';walkActive=false;document.getElementById('gcBig').textContent='128';document.getElementById('gcBig').className='gcbig s';document.getElementById('walkCard').style.display='none';}
    },30);
  }else{document.getElementById('walkOv').classList.remove('on');}
}
function acceptFuse(){document.getElementById('fuseCard').style.display='none';showPts('✓ 今日轻负荷方案已激活');AE.ready();}

// ════ EMERGENCY ════
function showEmerg(){closeCoach();clearInterval(restInt);stopFollowLoop();ME.stop();document.getElementById('ssHud').classList.remove('on');document.getElementById('restHud').classList.remove('on');document.getElementById('followOv').classList.remove('on');document.getElementById('emergOv').classList.add('on');}
function closeEmerg(){document.getElementById('emergOv').classList.remove('on');}

// ════ MISC ════
function showPts(text){
  const pop=document.createElement('div');pop.className='ppop';pop.textContent=text;
  const r=document.getElementById('app').getBoundingClientRect();
  pop.style.cssText=`left:${r.left+r.width/2-80}px;top:${r.top+r.height/2}px;font-size:15px`;
  document.body.appendChild(pop);setTimeout(()=>pop.remove(),1600);
}
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
function scrollChat(){setTimeout(()=>document.getElementById('chatPad').scrollIntoView({behavior:'smooth',block:'end'}),100);}
async function sendMsg(){
  const inp=document.getElementById('coachInp');
  const q=inp.value.trim();if(!q)return;
  inp.value='';addMsg('user',q);addTyping();
  const sys=`你是 Jennifer（Jing）的私人 AI 训练教练，名叫"熔归教练"。

【Jennifer 健康档案】
- 前驱糖尿病，CGM 监测，目标餐后血糖 <140 mg/dL，当前读数 158 mg/dL（偏高）
- PT 膝关节康复（Verna Chen），周一/三/五做5个PT练习：Knee CARs、Clamshells贴墙、Marching Bridge、Standing Clam、Soleus Raises
- 当前训练：Verna 4周下肢+核心计划——超级组结构（A1+A2, B1+B2, C1+C2）
  Week 1-2: 每动作2组，Week 3-4: 3组，次数从6-8渐进至12-15
- 今日睡眠：总7.2h，深睡2.1h，REM1.8h，HRV68ms（历史高位）
- 步数：今日8432步

【动作列表】
Day A超级组：Split-Squat+Prone Swimmer / Single-Leg RDL+Incline Push-Up / Bear Squat+Side Planks
Day B超级组：Glute Bridge March+Bench Dips / Step-Up+Shoulder Taps(放慢) / Inchworm+Deadbug w/Wall Press

【回复规则】
- 中文，结论先行，直接给建议
- 涉及血糖：结合餐后步行时机（10分钟内）和胰岛素敏感度
- 涉及膝关节：给出具体修改方案
- 涉及RPE：直接说怎么调整次数或动作
- 对话式，不超过200字；制定计划可详细
- 偶尔加1句神经唤醒式动作提示（引号括起）`;

  try{
    const apiBase=window.FITNESS_API||'';
    const res=await fetch(apiBase+'/api/fitness/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({system:sys,user:q})
    });
    const data=await res.json();removeTyping();
    if(res.ok&&data.text){
      const txt=data.text.replace(/\*\*(.*?)\*\*/g,'<strong style="color:var(--tx)">$1</strong>')
        .replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
      addMsg('ai',txt);
    }else addMsg('ai',data.detail||data.error||'响应异常，请重试。');
  }catch(e){removeTyping();addMsg('ai','网络错误，请重试。');}
}
document.addEventListener('keydown',e=>{if(e.key==='Enter'&&document.getElementById('coachInp')===document.activeElement)sendMsg();});

renderPlan();renderLib();
