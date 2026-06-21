export type CloudIdentityInput = {
  id?: string;
};

export type CloudIdentity = {
  identityKey: string;
  userId: string | null;
  provider: 'supabase' | 'wechat' | 'external';
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY_KEY_RE = /^[a-z0-9_:-]{3,240}$/i;

function normalizeIdentityKey(value: string): string {
  return value.trim().replace(/[^a-z0-9_:-]/gi, '_').slice(0, 240);
}

export function deriveCloudIdentity(user: CloudIdentityInput | null | undefined): CloudIdentity | null {
  const rawId = typeof user?.id === 'string' ? user.id.trim() : '';
  if (!rawId) return null;

  if (UUID_RE.test(rawId)) {
    return {
      identityKey: `supabase:${rawId}`,
      userId: rawId,
      provider: 'supabase',
    };
  }

  if (rawId.startsWith('wechat_openid:')) {
    const identityKey = normalizeIdentityKey(rawId);
    if (!IDENTITY_KEY_RE.test(identityKey)) return null;
    return {
      identityKey,
      userId: null,
      provider: 'wechat',
    };
  }

  const identityKey = normalizeIdentityKey(`external:${rawId}`);
  if (!IDENTITY_KEY_RE.test(identityKey)) return null;
  return {
    identityKey,
    userId: null,
    provider: 'external',
  };
}
