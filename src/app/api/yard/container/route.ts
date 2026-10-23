import { NextResponse } from 'next/server';
import { readContainer } from '@/lib/depot';

/**
 * Satu kontainer menurut nomornya, lengkap dengan posisinya di lapangan.
 *
 * GET ?no=XXXX1234567 → YardContainer, atau { found: false } kalau nomornya
 * tidak sedang menempati slot mana pun.
 *
 * Dipakai aliran langsung: saat pesan "ditangani" datang tanpa posisi, peramban
 * bertanya ke sini — database sudah tahu kontainer itu ditaruh di blok, slot,
 * row, tier berapa, dan jawaban itulah yang dipakai menaruhnya di tumpukan
 * tanpa memuat ulang seluruh lapangan.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const no = new URL(request.url).searchParams.get('no')?.trim().toUpperCase();
  if (!no) return NextResponse.json({ error: 'parameter no wajib' }, { status: 400 });
  try {
    const c = await readContainer(no);
    return NextResponse.json(c ? { found: true, container: c } : { found: false });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[depot] gagal membaca kontainer:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
