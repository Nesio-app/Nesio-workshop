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
import { rememberAI, recallAI, sig } from '@/lib/portal/ai-cache';
import { draftLocally } from '@/lib/portal/local-draft';
import { canUse } from '@/lib/portal/entitlement';
import NesioSheet from './ui/NesioSheet';

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
  // AI 离线时初稿的来源:'cache'=复用上次 AI 给的,'local'=本地骨架。null=AI 现写的。
  const [draftSource, setDraftSource] = useState<'cache' | 'local' | null>(null);
  // 批次 32:发件身份预检 —— 发送走「数据接入」连接的 Gmail,可能 ≠ 登录账号,先亮出来
  const [fromEmail, setFromEmail] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/portal/gmail/send', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { ok?: boolean; email?: string }) => { if (!cancelled && d.ok && d.email) setFromEmail(d.email); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

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
    setDraftSource(null);
  }, [open, context.from, context.subject]);

  if (!open) return null;

  const TONES: Array<{ key: Tone; zh: string; en: string }> = [
    { key: 'polite', zh: '礼貌', en: 'Polite' },
    { key: 'concise', zh: '简洁', en: 'Concise' },
    { key: 'warm', zh: '热情', en: 'Warm' },
    { key: 'decline', zh: '婉拒', en: 'Decline' },
    { key: 'followup', zh: '跟进', en: 'Follow up' },
  ];

  // 起草用的缓存签名:同样的意图+语气+这封邮件,离线时能复用上次 AI 给过的初稿。
  const draftKey = () => sig(`${intent}|${tone || ''}|${context.subject || ''}|${(context.snippet || '').slice(0, 80)}`);

  // AI 不在线时的兜底:先找上次 AI 给过的同类初稿,没有就本地拼一个能改的骨架。永不空手。
  function fallbackDraft() {
    const cached = recallAI<string>('draft-reply', draftKey());
    if (cached) {
      setBody(cached);
      setDraftSource('cache');
      setError('');
      return;
    }
    setBody(draftLocally({ from: context.from, intent, tone: tone || '', locale: dict === 'zh' ? 'zh' : 'en' }));
    setDraftSource('local');
    setError('');
  }

  async function aiDraft() {
    // 安全审计 #3:email_reply 是 PRO_ONLY 整功能(会员页承诺),此前门从未接线 —— 免费用户
    // 照打云 draft-reply。现接线:免费 → 升级引导 + 本地可改骨架(确定性兜底),不打付费云。
    if (!canUse('email_reply')) {
      window.dispatchEvent(new CustomEvent('nesio-pro-gate', { detail: { feature: 'email_reply' } }));
      fallbackDraft();
      return;
    }
    setError('');
    setDraftSource(null);
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
        setDraftSource(null);
        rememberAI('draft-reply', draftKey(), data.draft); // 从 AI 的初稿里学:记住,离线可复用
      } else if (data.error === 'auth_required') {
        // 登录问题不是"AI 离线",老实报，让用户重新登录
        setError(L(dict, '登录已过期,请重新登录 Nesio 再起草', 'Session expired — sign in to Nesio again'));
      } else if (data.error === 'no_context' && !intent.trim()) {
        // 既没原文又没写意图 —— 本地也拼不出有意义的东西,提示先写一句
        setError(L(dict, '这封邮件没有正文可参考,先写一句你想说的', 'No email body to work from — write a line first'));
      } else {
        // ai_not_configured / 5xx / 限流 / 空返回 —— 都算"AI 暂时离线",走本地兜底,不再把用户挡在空白框前
        fallbackDraft();
      }
    } catch {
      fallbackDraft(); // 网络错误也兜底
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

  const label = { fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', marginBottom: 'var(--space-1)', display: 'block' } as const;

  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-settings-sheet-card"
      style={{ display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}
      ariaLabel={L(dict, '写邮件', 'Compose email')}
    >
        <div className="nesio-settings-sheet-header">
          <h2 className="nesio-settings-sheet-title">{L(dict, '回复邮件', 'Reply')}</h2>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-5)' }}>
            <p style={{ color: 'var(--status-go)', fontSize: '2rem', margin: 0, lineHeight: 1 }}>✓</p>
            <p style={{ color: 'var(--status-go)', fontSize: 'var(--text-h3)', fontWeight: 700, marginTop: 'var(--space-2)' }}>{L(dict, '已发送', 'Sent')}</p>
          </div>
        ) : (
          <div style={{ overflowY: 'auto', padding: '0 var(--space-1) var(--space-2)' }}>
            {fromEmail && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--portal-muted)', margin: '0 0 var(--space-2)' }}>
                {L(dict, `发件人:${fromEmail}(数据接入里连接的 Gmail)`, `From: ${fromEmail} (the Gmail connected in Data sources)`)}
              </p>
            )}
            <label style={label}>{L(dict, '收件人', 'To')}</label>
            <input className="nesio-ob-input" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" style={{ marginBottom: 'var(--space-2)' }} />

            <label style={label}>{L(dict, '主题', 'Subject')}</label>
            <input className="nesio-ob-input" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ marginBottom: 'var(--space-2)' }} />

            {/* AI 起草区 */}
            <div style={{ background: 'var(--portal-accent-soft)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <label style={label}>{L(dict, '想表达什么?(可选,交给 AI 起草)', 'What to say? (optional — let AI draft it)')}</label>
              <input
                className="nesio-ob-input"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder={L(dict, '例:同意周四见面,把时间定在下午三点', 'e.g. Agree to meet Thursday, propose 3pm')}
                style={{ marginBottom: 'var(--space-2)' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
                {TONES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTone(tone === t.key ? '' : t.key)}
                    style={{
                      fontSize: 'var(--text-xs)', padding: 'var(--space-1) var(--space-2)', borderRadius: 999,
                      border: `1px solid ${tone === t.key ? 'var(--portal-accent)' : 'var(--portal-line)'}`,
                      background: tone === t.key ? 'var(--portal-accent)' : 'transparent',
                      color: tone === t.key ? '#fff' : 'var(--portal-muted)',
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
              onChange={(e) => { setBody(e.target.value); if (draftSource) setDraftSource(null); }}
              rows={9}
              placeholder={L(dict, '在这里写你的回复,或点上面「AI 帮我写」', 'Write your reply, or tap “Draft with AI” above')}
              style={{ resize: 'vertical', minHeight: 160, lineHeight: 1.6 }}
            />

            {draftSource && (
              <p style={{ color: 'var(--text-tertiary, #9ca3af)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)', lineHeight: 1.5 }}>
                {draftSource === 'cache'
                  ? L(dict, 'AI 暂时离线 · 复用了上次给你的初稿,改一改就能发', 'AI is offline · reused a past draft — tweak and send')
                  : L(dict, 'AI 暂时离线 · 这是本地起的骨架,把你的话补进去', 'AI is offline · a local skeleton — fill in your words')}
              </p>
            )}

            {error && <p style={{ color: 'var(--status-risk)', fontSize: 'var(--text-sm)', marginTop: 'var(--space-2)' }}>{error}</p>}

            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <button
                type="button"
                onClick={onClose}
                style={{ flex: 1, padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--portal-line)', background: 'transparent', color: 'var(--portal-muted)', cursor: 'pointer', fontSize: 'var(--text-body)' }}
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
            <p style={{ fontSize: 'var(--text-overline)', color: 'var(--portal-muted)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
              {L(dict, '以你的 Gmail 账号发送 · 每封都由你亲手点发送', 'Sent from your Gmail · you send every message yourself')}
            </p>
          </div>
        )}
    </NesioSheet>
  );
}
