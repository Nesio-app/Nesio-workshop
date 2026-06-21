import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024;

function safeJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(
    {
      safePublicStatus: true,
      secretsRedacted: true,
      ...body,
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return safeJson({ ok: false, error: 'Invalid form' }, 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return safeJson({ ok: false, error: 'file required' }, 400);
  }
  if (!file.type.startsWith('image/')) {
    return safeJson({ ok: false, error: 'images only' }, 400);
  }
  if (file.size > MAX_BYTES) {
    return safeJson({ ok: false, error: 'file too large' }, 400);
  }

  try {
    const upstream = new FormData();
    upstream.append('file', file, file.name || 'image.jpg');

    const res = await fetch('https://0x0.st', {
      method: 'POST',
      body: upstream,
      cache: 'no-store',
    });

    const text = (await res.text()).trim();
    if (!res.ok || !text.startsWith('http')) {
      return safeJson(
        { ok: false, error: 'upload host failed' },
        502,
      );
    }

    return safeJson({ ok: true, url: text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload failed';
    return safeJson({ ok: false, error: msg }, 502);
  }
}
