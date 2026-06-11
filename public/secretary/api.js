function apiBase() {
  if (typeof window !== 'undefined' && window.SECRETARY_API) {
    const v = String(window.SECRETARY_API).replace(/\/$/, '');
    if (v) return v;
  }
  if (typeof location === 'undefined') return 'https://treasurebox-nu.vercel.app';

  const { protocol, hostname, origin } = location;
  if (protocol === 'capacitor:' || protocol === 'file:' || hostname === 'localhost') {
    return 'https://treasurebox-nu.vercel.app';
  }
  if (origin && origin !== 'null') return origin.replace(/\/$/, '');
  return 'https://treasurebox-nu.vercel.app';
}

async function checkSecretaryHealth() {
  try {
    const res = await fetch(apiBase() + '/api/secretary/health', { method: 'GET' });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return { ok: Boolean(data.ok), gemini: Boolean(data.gemini) };
  } catch {
    return { ok: false };
  }
}

async function sendSecretaryMessage(message, history, model) {
  const res = await fetch(apiBase() + '/api/secretary/chat', {
    method: 'POST',
    mode: 'cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, model: model || 'gemini' }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
