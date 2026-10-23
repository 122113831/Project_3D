import { NextResponse } from 'next/server';
import { hubStatus, publish, recentEvents, subscribe } from '@/lib/eventHub';
import { normalizeEvent } from '@/lib/liveEvents';

/**
 * Aliran kejadian gate ke peramban.
 *
 * GET  — Server-Sent Events. Begitu tersambung, peramban menerima status hub
 *        lalu setiap kejadian baru; ping tiap 20 detik menjaga proxy tidak
 *        memutus koneksi yang sepi.
 * POST — menyuntikkan satu kejadian (atau daftar kejadian) dari luar broker:
 *        aplikasi lain, skrip uji, atau trigger. Bentuknya sama dengan pesan
 *        MQTT (lihat normalizeEvent). Kalau EVENTS_SECRET diisi di .env,
 *        header `x-events-secret` harus cocok.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const enc = new TextEncoder();

export async function GET() {
  let cleanup: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      send('status', hubStatus());
      // Kejadian yang baru saja lewat, supaya peramban yang terlambat masuk
      // tidak mulai dari layar kosong.
      for (const e of recentEvents()) send('recent', e);

      const unsub = subscribe((e) => send('trip', e));
      const ping = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: ping\n\n`));
          send('status', hubStatus());
        } catch {
          cleanup?.();
        }
      }, 20_000);
      cleanup = () => {
        clearInterval(ping);
        unsub();
        cleanup = null;
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(request: Request) {
  const secret = process.env.EVENTS_SECRET;
  if (secret && request.headers.get('x-events-secret') !== secret) {
    return NextResponse.json({ error: 'x-events-secret tidak cocok' }, { status: 401 });
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'body bukan JSON' }, { status: 400 });
  }
  const items = Array.isArray(raw) ? raw : [raw];
  const accepted = [];
  for (const it of items) {
    const e = normalizeEvent(it);
    if (e) {
      publish(e);
      accepted.push(e);
    }
  }
  if (accepted.length === 0) {
    return NextResponse.json(
      { error: 'tidak ada kejadian yang sah — minimal perlu ctrNo / CTR_NO' },
      { status: 400 },
    );
  }
  return NextResponse.json({ accepted: accepted.length, events: accepted });
}
