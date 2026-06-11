import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid form' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 });
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ ok: false, error: 'images only' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'file too large' }, { status: 400 });
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
      return NextResponse.json(
        { ok: false, error: 'upload host failed' },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, url: text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'upload failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
