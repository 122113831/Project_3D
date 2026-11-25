import { NextResponse } from 'next/server';
import { lockSlot, unlockBlock, unlockSlot, WriteRefused } from '@/lib/depotWrite';

/**
 * Mengunci dan membuka slot di YARD_ROWTIER.
 *
 * POST { action: 'lock',   block, slot, row, tier } — hapus baris tier..teratas
 * POST { action: 'unlock', block, slot, row }       — sisipkan kembali kolomnya
 * POST { action: 'unlockBlock', block }             — sisipkan kembali seluruh blok
 *
 * `slot` adalah YARD_SLOT apa adanya (ganjil 1, 3, 5, …) dan `row` 1-based,
 * persis seperti di tabel — bukan indeks posisi 3D.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const ref = { block: body?.block, slot: Number(body?.slot), row: Number(body?.row), tier: Number(body?.tier) };
    if (body?.action === 'lock') return NextResponse.json(await lockSlot(ref));
    if (body?.action === 'unlock') return NextResponse.json(await unlockSlot(ref));
    if (body?.action === 'unlockBlock') return NextResponse.json(await unlockBlock(body?.block));
    return NextResponse.json({ error: 'action must be lock, unlock, or unlockBlock.' }, { status: 400 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = e instanceof WriteRefused ? 400 : 503;
    if (status === 503) console.error('[depot] gagal mengubah slot:', e instanceof Error ? e.stack : message);
    return NextResponse.json({ error: message }, { status });
  }
}
