'use client';

/**
 * GrowthTab — 洞察「成长」tab(用户定:被动观察 → 个性化引导提升)。
 * 三层:今日引导卡(growth-guide 规则,零 AI 成本)→ 回看流(已答卡时间线,
 * 本 tab 的灵魂:当时的问题+数据快照+你的回答)→ 框架书架(结构化提问模板,
 * 复制后带自己的内容去问一问)。进度只用「连续回看天数」轻轻带过,不搞段位。
 */

import { useEffect, useState } from 'react';
import {
  todayGrowthCards, recordGrowthAnswer, growthHistory, growthStreakDays,
  GROWTH_FRAMEWORKS, type GrowthCard, type GrowthAnswer,
} from '@/lib/portal/growth-guide';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';

export default function GrowthTab() {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const en = dict === 'en';
  const [cards, setCards] = useState<GrowthCard[]>([]);
  const [history, setHistory] = useState<GrowthAnswer[]>([]);
  const [streak, setStreak] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');

  const refresh = () => {
    try {
      setCards(todayGrowthCards());
      setHistory(growthHistory());
      setStreak(growthStreakDays());
    } catch { /* 本地数据读取失败:空态兜底 */ }
  };
  useEffect(() => { refresh(); }, []);

  function submit(card: GrowthCard) {
    const text = (draft[card.id] || '').trim();
    if (!text) return;
    recordGrowthAnswer(card, text);
    setDraft((p) => ({ ...p, [card.id]: '' }));
    refresh();
  }

  async function copyFramework(id: string, prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(id);
      setTimeout(() => setCopied(''), 2200);
    } catch {
      setCopied('!' + id); // 设计红线:异步动作必有可见失败态
      setTimeout(() => setCopied(''), 2200);
    }
  }

  const fmtDay = (iso: string) => en
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${new Date(iso).getMonth() + 1}月${new Date(iso).getDate()}日`;

  return (
    <div>
      {streak > 1 && (
        <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-3)' }}>
          {L(dict, `已连续回看 ${streak} 天`, `${streak} days of looking back in a row`)}
        </p>
      )}

      <p className="nesio-insights-section-label">{L(dict, '今日引导', "Today's prompts")}</p>
      {cards.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {L(dict, '今天没有要回看的 —— 记录多了,这里会从你的数据里挑值得回头看一眼的事。',
            'Nothing to look back on today — as your records grow, prompts will surface from your own data.')}
        </p>
      ) : cards.map((c) => (
        <div key={c.id} style={{ border: '1px solid var(--portal-line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', marginBottom: 'var(--space-3)' }}>
          <p style={{ color: 'var(--portal-ink)', lineHeight: 1.6, margin: 0 }}>{en ? c.questionEn : c.question}</p>
          <p className="nesio-settings-option-hint" style={{ margin: 'var(--space-2) 0' }}>{c.context}</p>
          <textarea
            className="nesio-routine-input"
            style={{ minHeight: '3.4rem', resize: 'vertical', width: '100%' }}
            placeholder={L(dict, '答一句就够 —— 会存进回看流', 'One line is enough — saved to your review trail')}
            value={draft[c.id] || ''}
            onChange={(e) => setDraft((p) => ({ ...p, [c.id]: e.target.value }))}
          />
          <button type="button" className="nesio-ob-primary-btn" style={{ width: '100%', marginTop: 'var(--space-2)' }}
            disabled={!(draft[c.id] || '').trim()} onClick={() => submit(c)}>
            {L(dict, '记下这条回看', 'Save this reflection')}
          </button>
        </div>
      ))}

      <p className="nesio-insights-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '回看流', 'Review trail')}</p>
      {history.length === 0 ? (
        <p className="nesio-settings-option-hint">
          {L(dict, '答过的引导会留在这里:当时的问题、数据和你的回答 —— 复利在回看。',
            'Answered prompts live here: the question, the data, and what you said — the compounding is in the rereading.')}
        </p>
      ) : history.slice(0, 30).map((a, i) => (
        <div key={`${a.at}-${i}`} style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--portal-line)' }}>
          <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{fmtDay(a.at)}{a.context ? ` · ${a.context}` : ''}</p>
          <p style={{ color: 'var(--portal-muted)', fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0' }}>{a.question}</p>
          <p style={{ color: 'var(--portal-ink)', margin: 0, lineHeight: 1.55 }}>{a.answer}</p>
        </div>
      ))}

      <p className="nesio-insights-section-label" style={{ marginTop: 'var(--space-5)' }}>{L(dict, '框架书架', 'Framework shelf')}</p>
      <p className="nesio-settings-option-hint" style={{ marginBottom: 'var(--space-2)' }}>
        {L(dict, '复制一个框架,贴进「问一问」,套在你自己的内容上。', 'Copy a framework, paste it into Ask, apply it to your own content.')}
      </p>
      {GROWTH_FRAMEWORKS.map((f) => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--portal-line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: 'var(--portal-ink)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>{en ? f.nameEn : f.name}</p>
            <p className="nesio-settings-option-hint" style={{ margin: 0 }}>{en ? f.descEn : f.desc}</p>
          </div>
          <button type="button" className="nesio-connector-connect" style={{ flexShrink: 0 }} onClick={() => void copyFramework(f.id, f.prompt)}>
            {copied === f.id ? L(dict, '已复制', 'Copied') : copied === '!' + f.id ? L(dict, '复制失败,长按选中', 'Copy failed — select manually') : L(dict, '复制', 'Copy')}
          </button>
        </div>
      ))}
    </div>
  );
}
