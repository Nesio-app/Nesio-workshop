'use client';

/**
 * 分析师日报卡 —— /admin 顶部。替你读面板:把指标 + 治理压成「精简要点 + 重要预警」。
 * 规则大脑在 lib/portal/analyst.mjs(与邮件日报同一个);这里在客户端跑,复用已有的
 * /api/admin/metrics + /api/admin/governance,零额外基建、零 AI 成本、即时。
 */
import { useCallback, useEffect, useState } from 'react';
import { buildDailyReport } from '@/lib/portal/analyst.mjs';

type Severity = 'go' | 'gentle' | 'risk';
interface Alert { severity: Severity; title: string; detail: string; advice: string }
interface Report { date: string; status: Severity; headline: string; keyPoints: string[]; alerts: Alert[] }

const SEV_COLOR: Record<Severity, string> = { go: '#2e9e6b', gentle: '#c98a1a', risk: '#d64545' };
const card: React.CSSProperties = {
  background: 'var(--glass-bg-raised)', border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-lg)', padding: '1rem 1.1rem', boxShadow: 'var(--shadow-card)',
};

export function AnalystCard({ secret }: { secret: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    setLoading(true);
    const h: Record<string, string> = s ? { 'x-nesio-admin-secret': s } : {};
    try {
      const [mRes, gRes] = await Promise.all([
        fetch('/api/admin/metrics', { headers: h }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/admin/governance', { headers: h }).then((r) => r.json()).catch(() => ({})),
      ]);
      setReport(buildDailyReport(mRes, gRes) as Report);
    } catch {
      setReport(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(secret); }, [load, secret]);

  const emailNow = useCallback(async () => {
    setSent('sending');
    try {
      const res = await fetch('/api/admin/analyst/run', {
        method: 'POST',
        headers: secret ? { 'x-nesio-admin-secret': secret } : {},
      });
      const j = await res.json();
      setSent(j.ok ? (j.emailed ? 'ok' : 'no-email') : 'err');
    } catch { setSent('err'); }
  }, [secret]);

  if (loading && !report) return <section style={{ ...card, marginBottom: '1rem' }}>分析师读取中…</section>;
  if (!report) return null;

  const c = SEV_COLOR[report.status];
  const sentMsg = { sending: '发送中…', ok: '已发到邮箱 ✓', 'no-email': '未配置邮箱(设 RESEND_API_KEY + ANALYST_EMAIL_TO)', err: '发送失败' };

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
          {report.alerts.map((a, i) => (
            <div key={i} style={{
              fontSize: '0.76rem', padding: '0.5rem 0.65rem', borderRadius: 9,
              background: `color-mix(in srgb, ${SEV_COLOR[a.severity]} 10%, transparent)`,
              borderLeft: `2px solid ${SEV_COLOR[a.severity]}`,
            }}>
              <b style={{ color: SEV_COLOR[a.severity] }}>{a.title}</b>
              <span style={{ color: 'var(--portal-muted)' }}> —— {a.detail} </span>
              <span style={{ color: 'var(--portal-ink)' }}>建议:{a.advice}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <button type="button" onClick={() => void emailNow()} disabled={sent === 'sending'} style={{
          fontSize: '0.72rem', padding: '0.35rem 0.7rem', borderRadius: 8, cursor: 'pointer',
          border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--portal-ink)',
        }}>发送到邮箱</button>
        {sent && <span style={{ fontSize: '0.68rem', color: 'var(--portal-muted)' }}>{sentMsg[sent as keyof typeof sentMsg]}</span>}
      </div>
    </section>
  );
}
