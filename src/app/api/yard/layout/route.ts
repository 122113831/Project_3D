import { NextResponse } from 'next/server';
import {
  LayoutConflict,
  layoutCode,
  readLayout,
  WriteRefused,
  writeLayout,
} from '@/lib/depotWrite';

/**
 * Tata letak lapangan yang dipakai bersama.
 *
 * GET ?source=depot|demo — tata letak tersimpan, atau json null kalau belum
 *                          pernah ada yang menyimpan.
 * PUT                    — simpan. Body: { source, layout, baseRevision }.
 *
 * Satu baris per sumber, dibagi seluruh pengguna: inilah yang membuat suntingan
 * di satu PC muncul sama persis di PC lain. Yang TIDAK lewat sini adalah posisi
 * dan sudut blok yang sungguh ada — itu tetap ditulis ke CORE_YARD_BLOCK lewat
 * /api/yard/block, karena di sanalah data itu memang tinggal.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function fail(e: unknown) {
  if (e instanceof LayoutConflict) {
    // 409, bukan 400: klien perlu membedakan "kiriman salah" dari "kamu
    // ketinggalan", karena yang kedua obatnya memuat ulang, bukan memperbaiki.
    return NextResponse.json({ error: e.message, current: e.current }, { status: 409 });
  }
  const message = e instanceof Error ? e.message : String(e);
  const status = e instanceof WriteRefused ? 400 : 503;
  if (status === 503) {
    console.error('[depot] gagal menyimpan tata letak:', e instanceof Error ? e.stack : message);
  }
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const source = new URL(request.url).searchParams.get('source');
    return NextResponse.json(await readLayout(layoutCode(source)));
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const saved = await writeLayout(
      layoutCode(body?.source),
      // Tata letak diserialkan di sini, bukan dikirim klien sebagai string:
      // dengan begitu yang tersimpan selalu JSON yang sudah lewat parser.
      JSON.stringify(body?.layout ?? null),
      Number(body?.baseRevision) || 0,
    );
    return NextResponse.json(saved);
  } catch (e) {
    return fail(e);
  }
}
