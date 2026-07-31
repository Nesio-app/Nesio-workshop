'use client';

import { useEffect, useState } from 'react';
import { loadProfileSettings, type PortalLocale } from '@/lib/portal/profile';

export interface LegalSection {
  /** 小节标题 [zh, en] */
  h: [string, string];
  /** 段落列表,每段 [zh, en];以 "· " 开头的段渲染为要点 */
  body: [string, string][];
}

interface LegalPageProps {
  title: [string, string];
  updated: [string, string];
  intro: [string, string];
  sections: LegalSection[];
}

/**
 * 通用法务/说明页外壳(隐私政策、支持)。App Store + Google 都要求隐私政策 URL 与
 * 支持 URL 能打开(否则退回);这页就是那两个 URL 的落地。双语,跟随已存 locale,
 * 顶部可切换 —— 苹果审核员(美区)读 en,产品主力用户读 zh。纯静态内容,主题 token
 * 自动适配昼夜。
 */
export default function LegalPage({ title, updated, intro, sections }: LegalPageProps) {
  const [locale, setLocale] = useState<PortalLocale>('zh');
  useEffect(() => { setLocale(loadProfileSettings().locale); }, []);
  const i = locale === 'zh' ? 0 : 1;

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--portal-bg, #f6f8fc)', color: 'var(--portal-ink, #2c2c2c)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem 1.25rem 4rem', fontFamily: 'var(--font-sans)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', gap: '1rem' }}>
          <a href="/" style={{ color: 'var(--portal-accent, #588ce3)', textDecoration: 'none', fontSize: 'var(--text-body)' }}>
            {i === 0 ? '← 返回 Nesio' : '← Back to Nesio'}
          </a>
          <div style={{ display: 'flex', gap: '0.25rem', fontSize: 'var(--text-sm)' }}>
            <button type="button" onClick={() => setLocale('zh')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: locale === 'zh' ? 700 : 400, color: locale === 'zh' ? 'var(--portal-accent, #588ce3)' : 'var(--portal-muted, #8a94a6)' }}>中文</button>
            <span style={{ color: 'var(--portal-line, #d7deea)' }}>·</span>
            <button type="button" onClick={() => setLocale('en')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: locale === 'en' ? 700 : 400, color: locale === 'en' ? 'var(--portal-accent, #588ce3)' : 'var(--portal-muted, #8a94a6)' }}>English</button>
          </div>
        </div>

        <h1 style={{ fontSize: 'var(--text-h1)', fontWeight: 700, margin: '0 0 0.35rem' }}>{title[i]}</h1>
        <p style={{ color: 'var(--portal-muted, #8a94a6)', fontSize: 'var(--text-sm)', margin: '0 0 1.5rem' }}>{updated[i]}</p>
        <p style={{ lineHeight: 1.7, margin: '0 0 2rem' }}>{intro[i]}</p>

        {sections.map((s, idx) => (
          <section key={idx} style={{ marginBottom: '1.75rem' }}>
            <h2 style={{ fontSize: 'var(--text-h3)', fontWeight: 700, margin: '0 0 0.6rem' }}>{s.h[i]}</h2>
            {s.body.map((p, j) => {
              const text = p[i];
              const isBullet = text.startsWith('· ');
              return (
                <p key={j} style={{
                  lineHeight: 1.7,
                  margin: isBullet ? '0.2rem 0 0.2rem 0.5rem' : '0 0 0.7rem',
                  color: isBullet ? 'var(--portal-ink, #2c2c2c)' : undefined,
                }}>{text}</p>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
