'use client';

/**
 * 分析师日报卡 —— /admin 顶部。替你读面板:精简要点 + 重要预警 + 学习状态。
 * 数据来自 GET /api/admin/analyst(服务端跑规则大脑:历史基线 + 你的反馈)。
 * 每条预警可点「有用/没用/误报」——这就是反馈学习的输入:分析师据此静音你老忽略的、
 * 把你在乎的排前面(risk 级永不静音)。
 */
import { useCallback, useEffect, useState } from 'react';

type Severity = 'go' | 'gentle' | 'risk';
interface Alert { type: string; severity: Severity; title: string; detail: string; advice: string; explain?: string; basis?: string }
interface Learning { historyDays: number; learnedAlerts: number; mutedByFeedback: number; feedbackTypes: number }
interface Report { date: string; status: Severity; headline: string; keyPoints: string[]; alerts: Alert[]; learning?: Learning }

const SEV_COLOR: Record<Severity, string> = { go: '#2e9e6b', gentle: '#c98a1a', risk: '#d64545' };
const card: React.CSSProperties = {
  background: 'var(--glass-bg-raised)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-lg)', padding: '1rem 1.1rem', boxShadow: 'var(--shadow-card)',
};

export function AnalystCard({ secret }: { secret: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<string | null>(null);
  const [voted, setVoted] = useState<Record<string, string>>({});

  const headers = useCallback((): Record<string, string> => (secret ? { 'x-nesio-admin-secret': secret } : {}), [secret]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/analyst', { headers: headers() });
      const j = await res.json();
      setReport(j.ok ? j.report as Report : null);
    } catch { setReport(null); } finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const vote = useCallback(async (alertType: string, reaction: 'useful' | 'dismiss' | 'wrong') => {
    setVoted((p) => ({ ...p, [alertType]: reaction }));
    try {
      await fetch('/api/admin/analyst/feedback', {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ alertType, reaction, date: report?.date }),
      });
    } catch { /* 已乐观标记 */ }
  }, [headers, report?.date]);

  const emailNow = useCallback(async () => {
    setSent('sending');
    try {
      const res = await fetch('/api/admin/analyst/run', { method: 'POST', headers: headers() });
      const j = await res.json();
      setSent(j.ok ? (j.emailed ? 'ok' : 'no-email') : 'err');
    } catch { setSent('err'); }
  }, [headers]);

  if (loading && !report) return <section style={{ ...card, marginBottom: '1rem' }}>分析师读取中…</section>;
  if (!report) return null;

  const c = SEV_COLOR[report.status];
  const L = report.learning;
  const sentMsg: Record<string, string> = { sending: '发送中…', ok: '已发到邮箱 ✓', 'no-email': '未配置邮箱(设 RESEND_API_KEY + ANALYST_EMAIL_TO)', err: '发送失败' };
  const voteBtn = (t: string, r: 'useful' | 'dismiss' | 'wrong', label: string) => (
    <button type="button" onClick={() => void vote(t, r)} disabled={!!voted[t]} style={{
      fontSize: '0.66rem', padding: '2px 7px', borderRadius: 6, cursor: voted[t] ? 'default' : 'pointer',
      border: '1px solid var(--glass-border)',
      background: voted[t] === r ? 'color-mix(in srgb, var(--portal-accent, #4a6cf7) 18%, transparent)' : 'transparent',
      color: 'var(--portal-muted)', opacity: voted[t] && voted[t] !== r ? 0.4 : 1,
    }}>{label}</button>
  );

  return (
    <section style={{ ...card, marginBottom: '1rem', borderLeft: `3px solid ${c}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.55rem' }}>
          <span style={{ fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--portal-muted)', textTransform: 'uppercase' }}>分析师日报</span>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: c }}>{report.headline}</span>
        </div>
        <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{report.date}</span>
      </div>

      <ul style={{ margin: '0.7rem 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {report.keyPoints.map((p, i) => (
          <li key={i} style={{ fontSize: '0.8rem', color: 'var(--portal-ink)', display: 'flex', gap: '0.5rem' }}>
            <span style={{ color: 'var(--portal-muted)' }}>·</span><span>{p}</span>
          </li>
        ))}
      </ul>

      {report.alerts.length > 0 && (
        <div style={{ marginTop: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {report.alerts.map((a) => (
            <div key={a.type} style={{
              fontSize: '0.76rem', padding: '0.5rem 0.65rem', borderRadius: 9,
              background: `color-mix(in srgb, ${SEV_COLOR[a.severity]} 10%, transparent)`,
              borderLeft: `2px solid ${SEV_COLOR[a.severity]}`,
            }}>
              <div>
                <b style={{ color: SEV_COLOR[a.severity] }}>{a.title}</b>
                {a.basis === 'learned' && <span style={{ fontSize: '0.6rem', marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'color-mix(in srgb, #4a6cf7 15%, transparent)', color: 'var(--portal-muted)' }}>基线</span>}
                <span style={{ color: 'var(--portal-muted)' }}> —— {a.detail} </span>
                <span style={{ color: 'var(--portal-ink)' }}>建议:{a.advice}</span>
              </div>
              {a.explain && <div style={{ fontSize: '0.66rem', color: 'var(--portal-muted)', marginTop: 3 }}>依据:{a.explain}</div>}
              <div style={{ display: 'flex', gap: 5, marginTop: 5, alignItems: 'center' }}>
                {voted[a.type]
                  ? <span style={{ fontSize: '0.64rem', color: 'var(--portal-muted)' }}>已反馈 ✓ 分析师会据此调整</span>
                  : <>{voteBtn(a.type, 'useful', '有用')}{voteBtn(a.type, 'dismiss', '没用')}{voteBtn(a.type, 'wrong', '误报')}</>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void emailNow()} disabled={sent === 'sending'} style={{
          fontSize: '0.72rem', padding: '0.35rem 0.7rem', borderRadius: 8, cursor: 'pointer',
          border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--portal-ink)',
        }}>发送到邮箱</button>
        {sent && <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{sentMsg[sent]}</span>}
        {L && (
          <span style={{ fontSize: '0.64rem', color: 'var(--portal-muted)', marginLeft: 'auto' }}>
            学习:历史 {L.historyDays} 天 · 基线判定 {L.learnedAlerts} · 反馈静音 {L.mutedByFeedback}
            {L.historyDays < 10 && '(冷启动·攒够 10 天切基线)'}
          </span>
        )}
      </div>
    </section>
  );
}
