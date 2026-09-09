import { NextResponse } from 'next/server';
import { fetchDepotYard } from '@/lib/depot';
import { generateYard } from '@/lib/yard';

/**
 * Sumber data lapangan.
 *
 * Default membaca database depot (Oracle). Generator lama tetap bisa dipanggil
 * lewat `?source=demo` — itu yang dipakai preset kepadatan untuk menunjukkan
 * perilaku renderer pada belasan ribu kontainer, jumlah yang tidak ada di
 * database mana pun di sini.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const source = params.get('source') === 'demo' ? 'demo' : 'depot';

  if (source === 'demo') {
    const fill = Number(params.get('fill') ?? 0.68);
    return NextResponse.json(generateYard({ fill: Number.isFinite(fill) ? fill : 0.68 }));
  }

  try {
    return NextResponse.json(await fetchDepotYard());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[depot] gagal membaca database:', message);
    // Status 503, bukan 500: ini kegagalan dependensi eksternal, dan pesannya
    // ikut dikirim supaya HUD bisa menampilkan sebabnya.
    return NextResponse.json(
      { error: `Gagal membaca database depot: ${message}` },
      { status: 503 },
    );
  }
}
