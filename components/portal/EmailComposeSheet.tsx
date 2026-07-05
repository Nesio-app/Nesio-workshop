'use client';

/**
 * EmailComposeSheet — write & send a Gmail reply from inside Nesio.
 * 批次 36:读→写→发 的「写/发」。AI 起草只填进撰写框,永远由用户过目、编辑、
 * 亲手点「发送」。发送走 /api/portal/gmail/send,起草走 /api/portal/gmail/draft-reply。
 */

import { useEffect, useState } from 'react';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from './use-portal-locale';

export interface EmailComposeContext {
  emailId?: string;
  from?: string;     // 原发件人 "Name <email>" —— 作为回复的收件人
  subject?: string;
  snippet?: string;
  article?: string;  // 原文正文(供 AI 起草参考)
}

interface EmailComposeSheetProps {
  open: boolean;
  onClose: () => void;
  context: EmailComposeContext;
}

/** 从 "Name <email@x.com>" 里取出邮箱;取不到就原样返回。 */
function extractEmail(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}

type Tone = 'polite' | 'concise' | 'warm' | 'decline' | 'followup';

export default function EmailComposeSheet({ open, onClose, context }: EmailComposeSheetProps) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [intent, setIntent] = useState('');
  const [tone, setTone] = useState<Tone | ''>('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  // 每次打开都用原邮件重置字段
  useEffect(() => {
    if (!open) return;
    setTo(extractEmail(context.from || ''));
    const s = context.subject || '';
    setSubject(s ? (/^re:/i.test(s) ? s : `Re: ${s}`) : '');
    setBody('');
    setIntent('');
    setTone('');
    setDrafting(false);
    setSending(false);
    setSent(false);
    setError('');
  }, [open, context.from, context.subject]);

  if (!open) return null;

  const TONES: Array<{ key: Tone; zh: string; en: string }> = [
    { key: 'polite', zh: '礼貌', en: 'Polite' },
    { key: 'concise', zh: '简洁', en: 'Concise' },
    { key: 'warm', zh: '热情', en: 'Warm' },
    { key: 'decline', zh: '婉拒', en: 'Decline' },
    { key: 'followup', zh: '跟进', en: 'Follow up' },
  ];

  async function aiDraft() {
    setError('');
    setDrafting(true);
    try {
      const res = await fetch('/api/portal/gmail/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: context.emailId,
          from: context.from,
          subject: context.subject,
          snippet: context.snippet,
          article: context.article,
          intent,
          tone: tone || undefined,
        }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; draft?: string; error?: string; detail?: string };
      if (data.ok && data.draft) {
        setBody(data.draft);
      } else if (data.error === 'ai_not_configured') {
        setError(L(dict, 'AI 起草暂未开通,你可以直接手写', 'AI drafting is off — write it yourself'));
      } else if (data.error === 'auth_required') {
        setError(L(dict, '登录已过期,请重新登录 Nesio 再起草', 'Session expired — sign in to Nesio again'));
      } else if (data.error === 'no_context') {
        setError(L(dict, '这封邮件没有正文可参考,先手写一句吧', 'No email body to work from — write a line first'));
      } else if (!res.ok && res.status >= 500) {
        // 把服务端的 detail 带出来,方便定位(AI 供应商报错/限流等)
        setError(L(dict, `AI 起草失败:${data.detail || data.error || res.status}`, `Draft failed: ${data.detail || data.error || res.status}`));
      } else {
        setError(L(dict, 'AI 起草失败,请重试或手写', 'Draft failed — retry or write it yourself'));
      }
    } catch {
      setError(L(dict, '网络错误,起草失败', 'Network error — draft failed'));
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (sending) return;
    if (!to.includes('@')) { setError(L(dict, '收件人邮箱不对', 'Recipient email looks wrong')); return; }
    if (!body.trim()) { setError(L(dict, '正文是空的', 'The message is empty')); return; }
    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/portal/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body, emailId: context.emailId }),
      });
      const data = await res.json() as { ok?: boolean; error?: string; connectUrl?: string };
      if (data.ok) {
        setSent(true);
        setTimeout(onClose, 1300);
      } else if (data.error === 'insufficient_scope' || data.error === 'not_connected') {
        setError(L(dict, '需要先授权发送权限 —— 去设置里重新连接 Gmail', 'Grant send permission first — reconnect Gmail in Settings'));
        setSending(false);
      } else {
        setError(L(dict, '发送失败,请重试', 'Send failed — please try again'));
        setSending(false);
      }
    } catch {
      setError(L(dict, '发送失败,请重试', 'Send failed — please try again'));
      setSending(false);
    }
  }

  const label = { fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.25rem', display: 'block' } as const;

  return (
    <div className="nesio-node-detail-overlay" role="dialog" aria-modal="true" aria-label={L(dict, '写邮件', 'Compose email')} style={{ zIndex: 60 }}>
      <button type="button" className="nesio-settings-sheet-backdrop" onClick={onClose} aria-label={L(dict, '关闭', 'Close')} />
      <div className="nesio-settings-sheet-card" style={{ display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
        <div className="nesio-sheet-handle" aria-hidden />
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '回复邮件', 'Reply')}</h2>
          <button type="button" className="nesio-voice-sheet-close" onClick={onClose} aria-label={L(dict, '关闭', 'Close')}>✕</button>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '2rem 1.25rem' }}>
            <p style={{ color: 'var(--status-go)', fontSize: '2rem', margin: 0, lineHeight: 1 }}>✓</p>
            <p style={{ color: 'var(--status-go)', fontSize: '1.05rem', fontWeight: 700, marginTop: '0.5rem' }}>{L(dict, '已发送', 'Sent')}</p>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', padding: '0 0.25rem 0.5rem' }}>
            <label style={label}>{L(dict, '收件人', 'To')}</label>
            <input className="nesio-ob-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" style={{ marginBottom: '0.6rem' }} />

            <label style={label}>{L(dict, '主题', 'Subject')}</label>
            <input className="nesio-ob-input" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ marginBottom: '0.6rem' }} />

            {/* AI 起草区 */}
            <div style={{ background: 'var(--surface-2, rgba(127,127,127,0.06))', borderRadius: 12, padding: '0.7rem', marginBottom: '0.7rem' }}>
              <label style={label}>{L(dict, '想表达什么?(可选,交给 AI 起草)', 'What to say? (optional — let AI draft it)')}</label>
              <input
                className="nesio-ob-input"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={L(dict, '例:同意周四见面,把时间定在下午三点', 'e.g. Agree to meet Thursday, propose 3pm')}
                style={{ marginBottom: '0.5rem' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.55rem' }}>
                {TONES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTone(tone === t.key ? '' : t.key)}
                    style={{
                      fontSize: '0.72rem', padding: '0.25rem 0.6rem', borderRadius: 999,
                      border: `1px solid ${tone === t.key ? 'var(--accent, #10b981)' : 'var(--border, rgba(127,127,127,0.3))'}`,
                      background: tone === t.key ? 'var(--accent, #10b981)' : 'transparent',
                      color: tone === t.key ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {L(dict, t.zh, t.en)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="nesio-ob-primary-btn"
                onClick={aiDraft}
                disabled={drafting}
                style={{ width: '100%', opacity: drafting ? 0.6 : 1 }}
              >
                {drafting
                  ? L(dict, 'AI 起草中…', 'Drafting…')
                  : body
                    ? L(dict, 'AI 重写', 'AI rewrite')
                    : L(dict, 'AI 帮我写', 'Draft with AI')}
              </button>
            </div>

            <label style={label}>{L(dict, '正文(发送前可随意修改)', 'Message (edit freely before sending)')}</label>
            <textarea
              className="nesio-ob-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={9}
              placeholder={L(dict, '在这里写你的回复,或点上面「AI 帮我写」', 'Write your reply, or tap “Draft with AI” above')}
              style={{ resize: 'vertical', minHeight: 160, lineHeight: 1.6 }}
            />

            {error && <p style={{ color: 'var(--status-stop, #ef4444)', fontSize: '0.8rem', marginTop: '0.5rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.8rem' }}>
              <button
                type="button"
                onClick={onClose}
                style={{ flex: 1, padding: '0.7rem', borderRadius: 12, border: '1px solid var(--border, rgba(127,127,127,0.3))', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' }}
              >
                {L(dict, '取消', 'Cancel')}
              </button>
              <button
                type="button"
                className="nesio-ob-primary-btn"
                onClick={send}
                disabled={sending}
                style={{ flex: 2, opacity: sending ? 0.6 : 1 }}
              >
                {sending ? L(dict, '发送中…', 'Sending…') : L(dict, '发送', 'Send')}
              </button>
            </div>
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.5rem', textAlign: 'center' }}>
              {L(dict, '以你的 Gmail 账号发送 · 每封都由你亲手点发送', 'Sent from your Gmail · you send every message yourself')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
