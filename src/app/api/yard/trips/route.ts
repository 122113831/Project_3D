import { NextResponse } from 'next/server';
import { readGateDay, readGateDays, readGateTrips } from '@/lib/depot';

/**
 * Perjalanan truk dari GATE_HIST. Hanya membaca.
 *
 * GET ?limit=N        — N perjalanan terakhir, terbaru lebih dulu.
 * GET ?open=1         — yang sudah gate in tapi belum gate out.
 * GET ?day=YYYY-MM-DD — semua perjalanan satu hari, urut jam (putar ulang hari).
 * GET ?days=1         — hari-hari yang punya aktivitas, dengan jumlahnya.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const day = url.searchParams.get('day');
    if (day) return NextResponse.json(await readGateDay(day));
    if (url.searchParams.get('days') === '1') return NextResponse.json(await readGateDays());
    const limit = Number(url.searchParams.get('limit') ?? 20);
    return NextResponse.json(await readGateTrips(limit, url.searchParams.get('open') === '1'));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message.startsWith('Tanggal harus') ? 400 : 503;
    if (status === 503) console.error('[depot] gagal membaca GATE_HIST:', message);
    return NextResponse.json({ error: message }, { status });
  }
}
