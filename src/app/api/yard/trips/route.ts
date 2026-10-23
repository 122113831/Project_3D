import { NextResponse } from 'next/server';
import { readGateTrips } from '@/lib/depot';

/**
 * Perjalanan truk terakhir dari GATE_HIST, terbaru lebih dulu.
 *
 * GET ?limit=N — hanya membaca. Kejadian langsung (gate in, stack, gate out)
 * kelak datang lewat MQTT; endpoint ini untuk memutar ulang dan untuk mengisi
 * keadaan awal saat halaman dibuka.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit') ?? 20);
    return NextResponse.json(await readGateTrips(limit, url.searchParams.get('open') === '1'));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[depot] gagal membaca GATE_HIST:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
