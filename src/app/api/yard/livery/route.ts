import { NextResponse } from 'next/server';
import { readLiveries } from '@/lib/depot';
import { FALLBACK_LIVERIES } from '@/lib/livery';

/**
 * Master livery kontainer (YARD_LIVERY + YARD_LIVERY_MAP). Hanya membaca.
 *
 * Kalau master tidak terbaca — sumber demo tanpa database, atau tabelnya belum
 * dibuat di lingkungan ini — dikirim set bawaan (source: 'fallback') dengan
 * status 200, supaya lapangan tetap tergambar dengan livery yang masuk akal.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await readLiveries());
  } catch (e) {
    console.warn('[depot] master livery tidak terbaca, pakai bawaan:', e instanceof Error ? e.message : e);
    return NextResponse.json(FALLBACK_LIVERIES);
  }
}
