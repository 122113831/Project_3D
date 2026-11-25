import { NextResponse } from 'next/server';
import { fetchDepotYard } from '@/lib/depot';

/**
 * Sumber data lapangan.
 *
 * Hanya database depot (Oracle). Sumber "demo" bangkitan sudah dihapus.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    return NextResponse.json(await fetchDepotYard());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[depot] gagal membaca database:', message);
    // Status 503, bukan 500: ini kegagalan dependensi eksternal, dan pesannya
    // ikut dikirim supaya HUD bisa menampilkan sebabnya.
    return NextResponse.json(
      { error: `Failed to read the depot database: ${message}` },
      { status: 503 },
    );
  }
}
