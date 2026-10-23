import { NextResponse } from 'next/server';
import { resizeBlock, WriteRefused } from '@/lib/depotWrite';

/**
 * Mengubah ukuran blok di database.
 *
 * POST { code, slots, rows, tiers } — CORE_YARD_BLOCK diperbarui, baris
 * YARD_ROWTIER di luar ukuran baru dihapus (hanya yang kosong), dan baris
 * untuk daerah baru disisipkan. Lihat resizeBlock di depotWrite.ts.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await resizeBlock(body));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof WriteRefused ? 400 : 503;
    if (status === 503) console.error('[depot] gagal mengubah ukuran blok:', e instanceof Error ? e.stack : message);
    return NextResponse.json({ error: message }, { status });
  }
}
