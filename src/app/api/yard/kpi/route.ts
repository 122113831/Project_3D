import { NextResponse } from 'next/server';
import { readKpi } from '@/lib/depotKpi';

/**
 * Indikator operasional untuk panel KPI — hanya membaca.
 *
 * Dipanggil peramban tiap menit. Perhitungannya terjadi di Oracle (lihat
 * depotKpi.ts), jadi biayanya tidak ikut membesar bersama jumlah penonton.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await readKpi());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[depot] gagal menghitung KPI:', message);
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
