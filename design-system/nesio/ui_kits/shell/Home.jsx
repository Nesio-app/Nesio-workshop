/* Nesio · 宝盒 — Home shell screen.
   Composes the design-system components over the liquid-glass courtyard. */
const { ToolModuleCard, ReminderCard, QuoteCard, WeatherTime, FloatingButton, Button } =
  window.NosioDesignSystem_d76dec;

const TOOL_ICON = (i) => `../../assets/icons/tools/${i}.svg`;
const AI_ICON = (i) => `../../assets/icons/ai/${i}.svg`;

function Home() {
  const [locale, setLocale] = React.useState('zh');
  const [theme, setTheme] = React.useState('day');
  const [sheet, setSheet] = React.useState(null); // 'toolbox' | 'ai' | 'note' | null
  const [savedQuote, setSavedQuote] = React.useState(false);
  const [aiPicked, setAiPicked] = React.useState(['claude', 'chatgpt', 'gemini']);
  const T = NESIO_I18N[locale];

  React.useEffect(() => {
    document.documentElement.setAttribute('data-portal-theme', theme);
    document.documentElement.setAttribute('lang', locale);
  }, [theme, locale]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 11 ? T.morning : hour < 18 ? T.day : T.evening;
  const localeCode = { zh: 'zh-CN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR' }[locale];
  const time = now.toLocaleTimeString(localeCode, { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString(localeCode, { month: 'long', day: 'numeric', weekday: 'long' });
  const quote = NESIO_QUOTES[locale][now.getDate() % NESIO_QUOTES[locale].length];

  const owned = NESIO_TOOLS.filter((t) => t.owned);

  const toggleAi = (id) =>
    setAiPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div style={{ maxWidth: 460, margin: '0 auto', padding: '0 16px 110px', position: 'relative', zIndex: 1 }}>
      {/* ── Top bar ── */}
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 2px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setSheet('settings')} title={T.settings}
            style={avatarStyle}>婧</button>
          <div>
            <div style={{ fontSize: 'var(--text-h3)', fontWeight: 'var(--weight-semibold)' }}>{greeting}，婧</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{T.tagline}</div>
          </div>
        </div>
        <WeatherTime time={time} date={date} temp="24°" condition={locale === 'zh' ? '多云' : 'Cloudy'} place={locale === 'zh' ? '上海' : 'SH'} />
      </header>

      {/* ── Theme + language controls ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <ThemeToggle theme={theme} setTheme={setTheme} T={T} />
        <LangSwitch locale={locale} setLocale={setLocale} />
      </div>

      {/* ── Owned tool modules — live content windows ── */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {owned.map((tool) => (
          <ToolModuleCard
            key={tool.id}
            icon={TOOL_ICON(tool.icon)}
            name={tool.name[locale]}
            nameEn={tool.en}
            tone={tool.zone}
            status={tool.badge ? { status: tool.badge.status, label: tool.badge.label[locale] } : null}
            onOpen={() => {}}
          >
            <strong style={{ fontSize: 'var(--text-h3)', lineHeight: 1.25 }}>{tool.signal[locale]}</strong>
            {tool.sub && <span style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-xs)' }}>{tool.sub[locale]}</span>}
          </ToolModuleCard>
        ))}
        {/* 更多 → toolbox */}
        <button onClick={() => setSheet('toolbox')} style={moreCardStyle}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>⊕</span>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>{T.toolboxMore}</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{NESIO_TOOLS.length} 个工具</span>
        </button>
      </section>

      {/* ── 陪你看见 reminder module ── */}
      <div style={{ marginBottom: 18 }}>
        <ReminderCard
          title={T.reminder}
          subtitle={T.reminderSub}
          items={NESIO_REMINDERS[locale]}
        />
      </div>

      {/* ── Quote at the very bottom ── */}
      <QuoteCard quote={quote} label={T.quoteLabel} saved={savedQuote} onSave={() => setSavedQuote((s) => !s)} />

      {/* ── Floating single-button entries: 笔记 + 智友 ── */}
      <FloatingButton icon="✎" position="bl" onClick={() => setSheet('note')} />
      <FloatingButton icon="💬" accent label={T.ai} position="br" onClick={() => setSheet('ai')} />

      {/* ── Bottom nav (home / note / todo / me) ── */}
      <nav style={bottomNavStyle}>
        {[['🏠', T.navHome, true], ['✎', T.navNote, false], ['◷', T.navTodo, false], ['◍', T.navMe, false]].map(([ic, lb, active], i) => (
          <button key={i} onClick={() => { if (lb === T.navNote) setSheet('note'); }} style={navBtnStyle(active)}>
            <span style={{ fontSize: 18, lineHeight: 1 }}>{ic}</span>
            <span style={{ fontSize: '0.6rem' }}>{lb}</span>
          </button>
        ))}
      </nav>

      {/* ── Sheets ── */}
      {sheet === 'toolbox' && <ToolboxSheet locale={locale} onClose={() => setSheet(null)} />}
      {sheet === 'ai' && <AISheet locale={locale} picked={aiPicked} toggle={toggleAi} onClose={() => setSheet(null)} />}
      {sheet === 'note' && <NoteSheet locale={locale} onClose={() => setSheet(null)} />}
      {sheet === 'settings' && <SettingsSheet locale={locale} setLocale={setLocale} theme={theme} setTheme={setTheme} onClose={() => setSheet(null)} />}
    </div>
  );
}

/* ── small UI helpers ── */
function ThemeToggle({ theme, setTheme, T }) {
  const opts = [['day', '☀', T.navHome === 'Home' ? 'Day' : '日'], ['night', '☾', T.navHome === 'Home' ? 'Night' : '夜']];
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', padding: 3, backdropFilter: 'blur(8px)' }}>
      {opts.map(([v, ic, lb]) => (
        <button key={v} onClick={() => setTheme(v)}
          style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 12px', fontSize: 'var(--text-xs)', fontWeight: 600, display: 'inline-flex', gap: 5, alignItems: 'center',
            background: theme === v ? 'var(--portal-blue-deep)' : 'transparent',
            color: theme === v ? '#fff' : 'var(--portal-muted)' }}>
          <span>{ic}</span><span>{lb}</span>
        </button>
      ))}
    </div>
  );
}

function LangSwitch({ locale, setLocale }) {
  const labels = { zh: '中', en: 'EN', ja: '日', ko: '한' };
  return (
    <div style={{ display: 'inline-flex', gap: 2, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', padding: 3, backdropFilter: 'blur(8px)' }}>
      {['zh', 'en', 'ja', 'ko'].map((l) => (
        <button key={l} onClick={() => setLocale(l)}
          style={{ border: 'none', cursor: 'pointer', borderRadius: 999, padding: '5px 11px', fontSize: 'var(--text-xs)', fontWeight: 600,
            background: locale === l ? 'var(--portal-blue-deep)' : 'transparent',
            color: locale === l ? '#fff' : 'var(--portal-muted)' }}>
          {labels[l]}
        </button>
      ))}
    </div>
  );
}

/* ── styles ── */
const avatarStyle = {
  width: 44, height: 44, borderRadius: 'var(--radius-pill)', flex: 'none',
  border: '1px solid var(--glass-border)', cursor: 'pointer',
  background: 'linear-gradient(145deg, var(--portal-blue-light), var(--portal-blue-mid))',
  color: 'var(--portal-blue-deep)', fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: '1.1rem',
};
const moreCardStyle = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
  minHeight: '8.5rem', cursor: 'pointer', color: 'var(--portal-blue-deep)',
  background: 'var(--glass-bg)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px dashed var(--glass-border)', borderRadius: 'var(--radius-lg)',
};
const bottomNavStyle = {
  position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(12px + env(safe-area-inset-bottom))',
  zIndex: 55, display: 'flex', gap: 4, width: 'min(420px, calc(100% - 32px))', justifyContent: 'space-around',
  background: 'var(--glass-bg-pop)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))',
  border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', padding: '6px', boxShadow: 'var(--shadow-pop)',
};
function navBtnStyle(active) {
  return {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '7px 0',
    border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-pill)', fontWeight: 600,
    background: active ? 'color-mix(in srgb, var(--portal-blue-light) 55%, transparent)' : 'transparent',
    color: active ? 'var(--portal-blue-deep)' : 'var(--portal-muted)',
  };
}

/* ── Sheet shell ── */
function Sheet({ title, onClose, children, height = '74vh' }) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(18,32,58,0.32)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(460px, 100%)', maxHeight: height, overflowY: 'auto', background: 'var(--glass-bg-pop)', backdropFilter: 'blur(var(--glass-blur))', WebkitBackdropFilter: 'blur(var(--glass-blur))', borderTopLeftRadius: 'var(--radius-xl)', borderTopRightRadius: 'var(--radius-xl)', border: '1px solid var(--glass-border)', boxShadow: 'var(--shadow-pop)', padding: '14px 18px calc(22px + env(safe-area-inset-bottom))', animation: 'nesio-fade-in 0.3s var(--ease-out)' }}>
        <div style={{ width: 38, height: 4, borderRadius: 999, background: 'var(--portal-line)', margin: '0 auto 14px' }} />
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-serif)', fontSize: 'var(--text-h2)', fontWeight: 600, color: 'var(--portal-ink)' }}>{title}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--glass-bg)', width: 32, height: 32, borderRadius: 999, cursor: 'pointer', color: 'var(--portal-muted)', fontSize: 18 }}>×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function ToolboxSheet({ locale, onClose }) {
  const T = NESIO_I18N[locale];
  return (
    <Sheet title={`${T.toolbox} · ${NESIO_TOOLS.length}`} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        {NESIO_TOOLS.map((tool) => (
          <div key={tool.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: tool.owned ? 1 : 0.55 }}>
            <img src={TOOL_ICON(tool.icon)} alt="" width={48} height={48} style={{ borderRadius: 13 }} />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-ink)', textAlign: 'center' }}>{tool.name[locale]}</span>
            {!tool.owned && <span style={{ fontSize: '0.56rem', color: 'var(--portal-muted)' }}>🔒</span>}
          </div>
        ))}
      </div>
    </Sheet>
  );
}

function AISheet({ locale, picked, toggle, onClose }) {
  const T = NESIO_I18N[locale];
  const [msg, setMsg] = React.useState('');
  return (
    <Sheet title={T.ai} onClose={onClose} height="80vh">
      <p style={{ margin: '0 0 12px', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>{T.aiHint}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {NESIO_AIS.map((ai) => {
          const on = picked.includes(ai.id);
          return (
            <button key={ai.id} onClick={() => toggle(ai.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px 7px 8px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? 'var(--portal-blue-deep)' : 'var(--glass-border)'}`,
                background: on ? 'color-mix(in srgb, var(--portal-blue-light) 50%, transparent)' : 'var(--glass-bg)',
                color: 'var(--portal-ink)', fontSize: 'var(--text-sm)', fontWeight: 600 }}>
              <img src={AI_ICON(ai.icon)} alt="" width={22} height={22} style={{ borderRadius: 6 }} />
              {ai.name}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <Bubble who={NESIO_AIS.find((a) => a.id === picked[0])?.name || 'AI'} icon={picked[0]}
          text={{ zh: '今晚的待办我帮你按精力排了序，先做最轻的一件好吗？', en: "I've sorted tonight's to-dos by energy — start with the lightest?", ja: '今夜のタスクをエネルギー順に並べたよ。一番軽いのから始める？', ko: '오늘 저녁 할 일을 에너지 순으로 정리했어요. 가장 가벼운 것부터 할까요?' }[locale]} />
        <Bubble who={NESIO_AIS.find((a) => a.id === picked[1])?.name || 'AI'} icon={picked[1]}
          text={{ zh: '补充一句：买牛奶可以顺路，不用专门跑。', en: 'One add: grab milk on the way — no special trip needed.', ja: '一言：牛乳はついでで大丈夫、わざわざ行かなくても。', ko: '한마디: 우유는 지나는 길에 — 따로 갈 필요 없어요.' }[locale]} align="right" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={NESIO_I18N[locale].notePlaceholder}
          style={{ flex: 1, fontFamily: 'inherit', fontSize: 'var(--text-body)', color: 'var(--portal-ink)', background: 'var(--glass-bg-solid)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', padding: '11px 16px', outline: 'none' }} />
        <Button variant="primary" pill onClick={() => setMsg('')}>{T.send}</Button>
      </div>
    </Sheet>
  );
}

function Bubble({ who, icon, text, align = 'left' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', gap: 4 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.64rem', color: 'var(--portal-muted)' }}>
        {icon && <img src={AI_ICON(icon)} alt="" width={14} height={14} style={{ borderRadius: 4 }} />}{who}
      </span>
      <div style={{ maxWidth: '82%', fontSize: 'var(--text-sm)', lineHeight: 1.5, color: 'var(--portal-ink)', padding: '9px 13px', borderRadius: 'var(--radius-md)',
        background: align === 'right' ? 'color-mix(in srgb, var(--portal-blue-light) 55%, transparent)' : 'var(--glass-bg-solid)', border: '1px solid var(--glass-border)' }}>
        {text}
      </div>
    </div>
  );
}

function NoteSheet({ locale, onClose }) {
  const T = NESIO_I18N[locale];
  const [val, setVal] = React.useState('');
  return (
    <Sheet title={T.note} onClose={onClose} height="60vh">
      <textarea value={val} onChange={(e) => setVal(e.target.value)} placeholder={T.notePlaceholder} rows={5}
        style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 'var(--text-body)', lineHeight: 1.6, color: 'var(--portal-ink)', background: 'var(--glass-bg-solid)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', padding: 14, outline: 'none', resize: 'none', marginBottom: 12 }} />
      <p style={{ margin: '0 0 14px', fontSize: 'var(--text-xs)', color: 'var(--portal-muted)' }}>
        {{ zh: '笔记只是一个入口 — 可以连接 flomo、Notion，或用宝盒自己的。', en: 'Notes is just an entry — link flomo, Notion, or use Nesio\u2019s own.', ja: 'ノートは入口だけ — flomoやNotion、宝箱自身も使えます。', ko: '노트는 입구일 뿐 — flomo, Notion 또는 보물상자 자체를 쓸 수 있어요.' }[locale]}
      </p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>{T.later}</Button>
        <Button variant="primary" onClick={() => { setVal(''); onClose(); }}>{T.send}</Button>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ locale, setLocale, theme, setTheme, onClose }) {
  const T = NESIO_I18N[locale];
  const labels = { zh: '简体中文', en: 'English', ja: '日本語', ko: '한국어' };
  return (
    <Sheet title={T.settings} onClose={onClose} height="64vh">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={rowLabel}>{ { zh:'显示语言', en:'Language', ja:'表示言語', ko:'표시 언어' }[locale] }</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['zh', 'en', 'ja', 'ko'].map((l) => (
              <button key={l} onClick={() => setLocale(l)} style={chipStyle(locale === l)}>{labels[l]}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={rowLabel}>{ { zh:'外观', en:'Appearance', ja:'外観', ko:'외관' }[locale] }</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['day', T.navHome === 'Home' ? 'Day' : '日间'], ['night', T.navHome === 'Home' ? 'Night' : '夜间'], ['auto', T.navHome === 'Home' ? 'Auto' : '随系统']].map(([v, lb]) => (
              <button key={v} onClick={() => setTheme(v === 'auto' ? 'day' : v)} style={chipStyle(theme === v)}>{lb}</button>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
const rowLabel = { fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--portal-muted)', marginBottom: 8, letterSpacing: '0.02em' };
function chipStyle(on) {
  return { padding: '9px 16px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600,
    border: `1px solid ${on ? 'var(--portal-blue-deep)' : 'var(--glass-border)'}`,
    background: on ? 'var(--portal-blue-deep)' : 'var(--glass-bg)', color: on ? '#fff' : 'var(--portal-ink)' };
}

window.Home = Home;