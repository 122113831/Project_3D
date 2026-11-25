import { NextResponse } from 'next/server';

/**
 * Cuaca saat ini di lokasi depot, dari Open-Meteo (gratis, tanpa kunci API).
 *
 * Yang dikirim ke Open-Meteo HANYA koordinat depot — DEPOT_LAT / DEPOT_LON di
 * .env, default pelabuhan Tanjung Perak Surabaya. Tidak ada data lapangan,
 * kontainer, maupun pengguna yang ikut keluar.
 *
 * Lewat server, bukan langsung dari peramban, supaya koordinat diatur di satu
 * tempat dan hasilnya disinggahkan 10 menit untuk semua pengguna: cuaca tidak
 * berubah secepat itu, dan tiap tab tidak perlu bertanya sendiri.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export type Weather = {
  /** Tutupan awan, 0..1. */
  cloud: number;
  /** Curah hujan, mm/jam. */
  rain: number;
  /** Jarak pandang, meter (null kalau tidak tersedia). */
  visibility: number | null;
  /** Kode cuaca WMO. */
  code: number;
  at: string;
  lat: number;
  lon: number;
};

const TTL = 10 * 60 * 1000;
let cache: { at: number; data: Weather } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) return NextResponse.json(cache.data);
  const lat = Number(process.env.DEPOT_LAT ?? -7.2);
  const lon = Number(process.env.DEPOT_LON ?? 112.73);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=cloud_cover,precipitation,weather_code,visibility&timezone=auto';
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const j = await res.json();
    const c = j?.current ?? {};
    const data: Weather = {
      cloud: Math.max(0, Math.min(1, Number(c.cloud_cover ?? 0) / 100)),
      rain: Math.max(0, Number(c.precipitation ?? 0)),
      visibility: c.visibility != null ? Number(c.visibility) : null,
      code: Number(c.weather_code ?? 0),
      at: String(c.time ?? new Date().toISOString()),
      lat,
      lon,
    };
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Penyebab sebenarnya ada di `cause` (fetch hanya bilang "fetch failed").
    const cause = (e as { cause?: { code?: string } })?.cause?.code;
    const hint =
      cause === 'SELF_SIGNED_CERT_IN_CHAIN' || cause === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
        ? ' — HTTPS intercepted by antivirus/proxy; install its root certificate via NODE_EXTRA_CA_CERTS'
        : '';
    return NextResponse.json(
      { error: `Weather unavailable: ${message}${cause ? ` (${cause})` : ''}${hint}` },
      { status: 503 },
    );
  }
}
