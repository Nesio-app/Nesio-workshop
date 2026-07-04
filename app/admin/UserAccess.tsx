'use client';

/**
 * UserAccess — /admin 的用户权限管理区。
 * 列出注册用户,改角色(public/tester/personal_lab)和模块开关;
 * 改动即存(PATCH /api/admin/users),用户下次加载 App 生效。
 */

import { useCallback, useEffect, useState } from 'react';

const ROLES = [
  { value: 'public', label: '普通', hint: '只见公开功能' },
  { value: 'tester', label: '测试员', hint: '+ 勾选的模块' },
  { value: 'personal_lab', label: 'Lab', hint: '全部实验功能 + secretary' },
] as const;

// 可按用户开放的 gated/未上架模块(与 tool manifest 的 id 对应)
const GATED_MODULES = ['health', 'fitness', 'reading', 'secretary', 'quiz', 'lifesim'] as const;

interface UserRow {
  identityKey: string;
  email: string | null;
  provider: string | null;
  displayName: string | null;
  accessRole: string;
  featureFlags: Record<string, boolean>;
  createdAt: string | null;
}

const label: React.CSSProperties = { fontSize: '0.7rem', color: 'var(--portal-muted)', letterSpacing: '0.08em' };

export function UserAccess({ secret }: { secret: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<{ code: string; hint?: string } | null>(null);
  const [savingKey, setSavingKey] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users', { headers: { 'x-nesio-admin-secret': secret } });
      const json = await res.json() as { ok: boolean; users?: UserRow[]; error?: string; hint?: string };
      if (json.ok) { setUsers(json.users || []); setError(null); }
      else setError({ code: json.error || 'unknown', hint: json.hint });
    } catch {
      setError({ code: 'network_failed' });
    }
  }, [secret]);

  useEffect(() => { void load(); }, [load]);

  async function patch(identityKey: string, body: { accessRole?: string; featureFlags?: Record<string, boolean> }) {
    setSavingKey(identityKey);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-nesio-admin-secret': secret },
        body: JSON.stringify({ identityKey, ...body }),
      });
      const json = await res.json() as { ok: boolean };
      if (json.ok) {
        setUsers((prev) => prev?.map((u) => u.identityKey === identityKey
          ? { ...u, ...(body.accessRole ? { accessRole: body.accessRole } : {}), ...(body.featureFlags ? { featureFlags: body.featureFlags } : {}) }
          : u) || null);
      }
    } catch { /* 保持原状,下次刷新看真值 */ }
    setSavingKey('');
  }

  if (error) {
    return (
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--status-gentle)' }}>
        用户列表不可用({error.code}){error.hint ? ` — ${error.hint}` : ''}
      </p>
    );
  }
  if (!users) return <p style={label}>加载中…</p>;
  if (users.length === 0) return <p style={label}>还没有注册用户。有人登录后会出现在这里。</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      {users.map((u) => (
        <div key={u.identityKey} style={{ padding: '0.7rem 0', borderBottom: '1px solid var(--portal-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '0.82rem', fontWeight: 600, color: 'var(--portal-ink)' }}>
                {u.email || u.displayName || u.identityKey.slice(0, 18)}
                {savingKey === u.identityKey && <span style={{ ...label, marginLeft: 6 }}>保存中…</span>}
              </p>
              <p style={{ ...label, margin: '0.1rem 0 0' }}>
                {u.provider || '—'}{u.createdAt ? ` · ${u.createdAt.slice(0, 10)} 注册` : ''}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {ROLES.map((r) => (
                <button key={r.value} type="button" title={r.hint}
                  onClick={() => void patch(u.identityKey, { accessRole: r.value })}
                  style={{
                    padding: '0.28rem 0.7rem', borderRadius: 'var(--radius-pill)', fontSize: '0.72rem', cursor: 'pointer',
                    border: `1px solid ${u.accessRole === r.value ? 'var(--portal-accent)' : 'var(--glass-border)'}`,
                    background: u.accessRole === r.value ? 'var(--portal-accent-soft-md)' : 'var(--glass-bg-solid)',
                    color: u.accessRole === r.value ? 'var(--portal-accent)' : 'var(--portal-muted)',
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {u.accessRole === 'tester' && (
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {GATED_MODULES.map((m) => {
                const on = u.featureFlags[m] === true;
                return (
                  <button key={m} type="button"
                    onClick={() => void patch(u.identityKey, { featureFlags: { ...u.featureFlags, [m]: !on } })}
                    style={{
                      padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-pill)', fontSize: '0.68rem', cursor: 'pointer',
                      border: `1px solid ${on ? 'var(--status-go)' : 'var(--glass-border)'}`,
                      background: on ? 'var(--status-go-soft)' : 'var(--glass-bg-solid)',
                      color: on ? 'var(--status-go)' : 'var(--portal-muted)',
                    }}>
                    {on ? '✓ ' : ''}{m}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
