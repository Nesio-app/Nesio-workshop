'use client';

/**
 * /plaid-oauth — Plaid Link OAuth 续接页(iOS PWA/webview 修)。
 *
 * OAuth 银行(Chase 等)授权后,Plaid 按 link/token/create 里的 redirect_uri
 * 把浏览器带回这里(带 ?oauth_state_id=…)。旧实现没有这一页:授权开在新窗口,
 * 收尾依赖发起页还活着 —— iOS 把 PWA 杀掉重载后即黑屏断链,绑定永远差最后一步。
 * 这里用发起时存下的 link_token + receivedRedirectUri 就地重建 Link,Plaid 自动
 * 续上会话并回调 onSuccess,完成 public_token 兑换后回主页。
 *
 * 前提:dashboard.plaid.com → API → Allowed redirect URIs 登记本页完整 URL。
 */
import { useEffect, useState } from 'react';

const LINK_TOKEN_KEY = 'nesio-plaid-link-token';

type PlaidHandle = { open: () => void };
type PlaidGlobal = { create: (cfg: object) => PlaidHandle };

export default function PlaidOAuthResumePage() {
  const [msg, setMsg] = useState('正在完成银行绑定…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // stash 兼容两代格式:旧=裸 link_token 字符串;新=JSON {token, update}
    // (update 模式的 onSuccess 不做 exchange —— 修复既有 item,public_token 不可换)。
    const raw = localStorage.getItem(LINK_TOKEN_KEY) || '';
    let linkToken = raw;
    let isUpdate = false;
    try {
      const parsed = JSON.parse(raw) as { token?: string; update?: boolean };
      if (parsed && typeof parsed.token === 'string') { linkToken = parsed.token; isUpdate = Boolean(parsed.update); }
    } catch { /* 旧格式:裸字符串 */ }
    if (!params.get('oauth_state_id') || !linkToken) {
      // 直接访问/上下文对不上(如换了浏览器环境):无从续接,回主页重连一次即可。
      window.location.replace('/');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        if (!(window as unknown as { Plaid?: PlaidGlobal }).Plaid) {
          await new Promise<void>((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
            sc.onload = () => resolve();
            sc.onerror = () => reject(new Error('link_script'));
            document.head.appendChild(sc);
          });
        }
        if (cancelled) return;
        const Plaid = (window as unknown as { Plaid?: PlaidGlobal }).Plaid;
        if (!Plaid) throw new Error('link_script');
        const link = Plaid.create({
          token: linkToken,
          receivedRedirectUri: window.location.href,
          onSuccess: async (publicToken: string) => {
            localStorage.removeItem(LINK_TOKEN_KEY);
            if (isUpdate) {
              // 修复模式:item 已就地修好,无需 exchange,直接回家标记已连。
              window.location.replace('/?connector=plaid&status=connected');
              return;
            }
            setMsg('银行已授权,正在写入…');
            // 错付防线:OAuth 回来 exchange 失败时,Plaid 侧已建的 Item 必须释放,否则每次
            // 失败占 1 个试用名额(20/10 的根因)。navigating 前 await 清理,别让 replace 掐断。
            const release = async () => {
              try {
                await fetch('/api/portal/plaid/remove', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ publicToken, linkToken }),
                });
              } catch { /* best-effort */ }
            };
            try {
              const ex = await fetch('/api/portal/plaid/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicToken, linkToken }),
              });
              const exData = await ex.json() as { ok?: boolean; error?: string };
              localStorage.removeItem(LINK_TOKEN_KEY);
              if (exData.ok) {
                // 与 Portal 的 OAuth 回参处理约定一致:connector+status 会写连接标记。
                window.location.replace('/?connector=plaid&status=connected');
              } else {
                await release();
                window.location.replace(`/?connector=plaid&error=${encodeURIComponent(exData.error || 'exchange_failed')}`);
              }
            } catch {
              await release();
              window.location.replace('/?connector=plaid&error=exchange_network');
            }
          },
          onExit: () => {
            localStorage.removeItem(LINK_TOKEN_KEY);
            window.location.replace('/');
          },
        });
        link.open();
      } catch {
        if (!cancelled) setMsg('Plaid 加载失败 — 回到 App 里重新点一次「+ 银行」即可');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <main style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--portal-bg)', color: 'var(--portal-ink)',
      fontFamily: 'var(--font-sans)', padding: 'var(--space-6)', textAlign: 'center',
    }}>
      <p style={{ fontSize: 'var(--text-body)', color: 'var(--portal-muted)' }}>{msg}</p>
    </main>
  );
}
