'use client';

/**
 * MoodBeat — 今天页时间线的「现在」第一拍(批次 107;批次 119 按设计规范 12 色定稿重做)。
 *
 * 设计规范(design-spec.html 落位·首页第一拍):
 * - 心情是一天时间线的「现在」第一拍,不占额外空间。用心情波纹方块作节点。
 * - 符号 + 标题文字严格取情绪盘里同一色 var(--emotion-<id>)—— 跟着当天记录的心情变。
 * - 已记:染上情绪色(哑光白核 + 该情绪色光晕,标题该情绪色 + 能量)。
 * - 未记(邀请态):淡紫、波纹符号 =「问你自己」。
 * - 质感与记忆球一致:低饱和、有光韵(彩色光晕),边缘一丝透色而非白边。
 */

import { useEffect, useState } from 'react';
import { getLifeGraph } from '@/lib/portal/life-graph';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

// 12 情绪标签(与 MoodSheet EMOTIONS 同源;首页第一拍取盘里同一 var(--emotion-<id>) 色)
const EMOTION_LABELS: Record<string, [string, string]> = {
  joy: ['开心', 'Joyful'], excited: ['兴奋', 'Excited'], moved: ['感动', 'Moved'],
  calm: ['平静', 'Calm'], content: ['满足', 'Content'], grateful: ['感激', 'Grateful'],
  tired: ['疲惫', 'Tired'], empty: ['空洞', 'Empty'], sad: ['难过', 'Sad'],
  anxious: ['焦虑', 'Anxious'], frustrated: ['烦躁', 'Restless'], angry: ['生气', 'Angry'],
};

interface Beat { emotionId: string | null; label: string; labelEn: string; energyLevel: string; time: string; hasEmotion: boolean }

function readLatestMoodToday(): Beat | null {
  try {
    const moods = getLifeGraph().filter((n) => {
      const tags = n.tags || [];
      return n.type === 'Mind' && (tags.includes('feeling') || tags.includes('moment'));
    });
    if (moods.length === 0) return null;
    moods.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const m = moods[0];
    const t = new Date(m.createdAt);
    const now = new Date();
    if (t.getFullYear() !== now.getFullYear() || t.getMonth() !== now.getMonth() || t.getDate() !== now.getDate()) {
      return null; // 只把「今天」的心情当第一拍
    }
    // 解析情绪 id:优先直接 attributes.emotion,退而用 emotionLabel 反查(兜住旧数据)
    const rawEmotion = typeof m.attributes?.emotion === 'string' ? m.attributes.emotion : '';
    const emotionLabelAttr = typeof m.attributes?.emotionLabel === 'string' ? m.attributes.emotionLabel : '';
    let emotionId: string | null = EMOTION_LABELS[rawEmotion] ? rawEmotion : null;
    if (!emotionId && emotionLabelAttr) {
      const found = Object.entries(EMOTION_LABELS).find(([, [zh]]) => zh === emotionLabelAttr);
      if (found) emotionId = found[0];
    }
    const labels = emotionId ? EMOTION_LABELS[emotionId] : null;
    // 有干净的情绪词(来自 id 或 emotionLabel)才追加能量词,否则退回节点名整条显示(不重复追加能量)
    // 用 || 而非 ??:空串也要兜底(?? 只兜 null/undefined,会漏掉空 emotionLabel)
    const hasEmotion = !!(labels || emotionLabelAttr);
    const zh = labels?.[0] || emotionLabelAttr || m.name.slice(0, 14);
    const en = labels?.[1] || emotionLabelAttr || zh;
    const energyLevel = String(m.attributes?.energyLevel || 'mid');
    const time = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    return { emotionId, label: zh, labelEn: en, energyLevel, time, hasEmotion };
  } catch {
    return null;
  }
}

export default function MoodBeat() {
  const onOpenMood = () => window.dispatchEvent(new CustomEvent('nesio-open-mood'));
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [beat, setBeat] = useState<Beat | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const refresh = () => { setBeat(readLatestMoodToday()); setReady(true); };
    refresh();
    window.addEventListener('nesio-life-graph-updated', refresh);
    return () => window.removeEventListener('nesio-life-graph-updated', refresh);
  }, []);

  if (!ready) return null;

  // 未记(邀请态):淡紫、波纹符 =「问你自己」
  if (!beat) {
    return (
      <button
        type="button"
        className="nesio-tl-node nesio-tl-node--mood nesio-tl-node--invite"
        onClick={() => window.dispatchEvent(new CustomEvent('nesio-open-mood'))}
      >
        <span className="nesio-tl-dot nesio-tl-dot--mood nesio-tl-dot--mood-invite" aria-hidden><MoodRipple /></span>
        <span className="nesio-tl-time">{L(dict, '现在', 'Now')}</span>
        {/* 2026-07-31:副标题「滑一下记 5 秒 · 今天还没记」删掉。
            「今天还没记」是每天必现的一句 —— 它把「还没做」摆到首页上,
            正是文案红线里要避的那种催促;而「滑一下记 5 秒」是操作说明,
            点进去就知道,不必在首页上先教一遍。标题那句已经是邀请了。 */}
        <span className="nesio-tl-title">{L(dict, '此刻,你感觉——', 'This moment, you feel —')}</span>
      </button>
    );
  }

  // 已记:符号 + 标题都染上当天情绪色(取盘里同一 var(--emotion-<id>))。
  // 整块点一下 = 再记一次(支持一天多记:每记一次是新节点,第一拍显示最新)。
  //
  // 2026-07-29 用户实锤:删掉底下那行「09:57 · 记录 · 再记一次 · 这周趋势 ›」。
  //   · 时间和「记录」两个字是**元数据**,不是这一拍要说的事;
  //   · 「再记一次」和整块点击是同一个动作,摆两遍;
  //   · 「这周趋势」是回顾,不属于今天页的「现在」—— 挪去健康页(那里才是看走势的地方)。
  // 留下的正是用户要的那半:情绪词 + 能量环。
  const moodC = beat.emotionId ? `var(--emotion-${beat.emotionId})` : 'var(--portal-muted)';
  return (
    <div
      className="nesio-tl-node nesio-tl-node--mood nesio-tl-node--mood-logged"
      style={{ ['--mood-c']: moodC } as React.CSSProperties}
    >
      <span className="nesio-tl-dot nesio-tl-dot--mood" aria-hidden><MoodRipple /></span>
      <button type="button" className="nesio-tl-mood-main" onClick={onOpenMood}
        aria-label={L(dict, '再记一次心情', 'Log mood again')}>
        {/* bug2:「今天」两字删掉 —— 这一拍本身就是「现在」,再标一次日期是同话重说 */}
        {/* 批次 128·新时间线规格:情绪词后缀环形能量表(弧长=高低,替掉「能量高/中/低」文字) */}
        <span className="nesio-tl-title">
          <span className="nesio-mood-word">{L(dict, beat.label, beat.labelEn)}</span>
          {beat.hasEmotion && <EnergyRing level={beat.energyLevel} />}
        </span>
      </button>
    </div>
  );
}

/** 环形能量表(批次 128·新时间线规格):替掉「能量高/中/低」文字 —— 弧长=高低,色随情绪。
 *  低≈30% · 中≈58% · 高≈88%。环绕在心情波纹符号外。 */
function EnergyRing({ level }: { level: string }) {
  const pct = level === 'high' ? 0.88 : level === 'low' ? 0.30 : 0.58;
  const r = 6.4;
  const c = 2 * Math.PI * r;
  return (
    <svg className="nesio-mood-ring" viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden>
      <circle cx="8" cy="8" r={r} stroke="currentColor" strokeWidth="1.8" strokeOpacity="0.16" />
      <circle cx="8" cy="8" r={r} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
        strokeDasharray={`${(c * pct).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 8 8)" />
    </svg>
  );
}

/** 心情波纹符号(设计规范 mood-node.html 权威:一道情绪波纹曲线,不是双波、不用圆点) */
function MoodRipple() {
  return (
    <svg className="nesio-mood-ripple" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 13c2 0 2.4-4 3.8-4s1.9 6 3.8 6 2.4-8 3.8-8 1.9 5 3.8 5" />
    </svg>
  );
}
