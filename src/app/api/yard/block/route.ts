import { NextResponse } from 'next/server';
import { createBlock, updatePlacement, WriteRefused, writeTarget } from '@/lib/depotWrite';

/**
 * Membuat dan memindahkan blok di database depot.
 *
 * POST  — blok baru: satu baris CORE_YARD_BLOCK + satu baris YARD_ROWTIER per
 *         slot x row x tier.
 * PATCH — posisi dan sudut blok yang sudah ada.
 * GET   — apakah penulisan sedang diizinkan, dan ke server mana. Dipakai HUD
 *         untuk menampilkan tujuan SEBELUM pengguna menekan simpan, bukan
 *         sesudahnya.
 *
 * Koordinat yang masuk sudah dalam SATUAN PETA (kolom X/Y), bukan meter.
 * Konversinya dikerjakan di klien memakai meta.mapTransform yang datang
 * bersama data yang sedang ditampilkan — jadi yang tersimpan persis sesuai
 * yang terlihat, bukan hasil hitungan ulang yang bisa berbeda.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Kegagalan yang disebabkan masukan pengguna dijawab 400; sisanya 503. */
function fail(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof WriteRefused ? 400 : 503;
  if (status === 503) console.error('[depot] gagal menulis:', e instanceof Error ? e.stack : message);
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  return NextResponse.json(writeTarget());
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await createBlock(body));
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    await updatePlacement(body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
