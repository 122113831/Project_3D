/**
 * Panggilan ke endpoint tulis lapangan.
 *
 * Dipisah dari store supaya store tetap murni soal keadaan editor, dan supaya
 * setiap tempat yang menulis ke database bisa ditemukan dengan mencari satu
 * nama berkas.
 */

import type { YardLayout } from './layout';
import type { BlockSide, YardSource } from './types';

export type WriteTarget = { enabled: boolean; target: string };

export type NewBlockPayload = {
  code: string;
  name: string;
  slots: number;
  rows: number;
  tiers: number;
  mapX: number;
  mapY: number;
  rotDeg: number;
  truckLane: BlockSide;
  slotStart: BlockSide;
};

export type PlacementPayload = {
  code: string;
  mapX: number;
  mapY: number;
  rotDeg: number;
  truckLane: BlockSide;
  slotStart: BlockSide;
};

/** Melempar pesan dari server apa adanya — sudah ditulis untuk dibaca orang. */
async function send<T>(method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch('/api/yard/block', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal (HTTP ${res.status}).`);
  return json as T;
}

export const createBlockInDb = (p: NewBlockPayload) =>
  send<{ code: string; slotRows: number; ms: number }>('POST', p);

export const savePlacement = (p: PlacementPayload) => send<{ ok: true }>('PATCH', p);

export async function fetchWriteTarget(): Promise<WriteTarget> {
  try {
    const res = await fetch('/api/yard/block');
    if (!res.ok) return { enabled: false, target: '?' };
    return (await res.json()) as WriteTarget;
  } catch {
    return { enabled: false, target: '?' };
  }
}

// --- tata letak bersama -------------------------------------------------------

export type SharedLayout = {
  code: 'DEPOT' | 'DEMO';
  /** JSON mentah dari kolom CLOB; null berarti belum pernah ada yang menyimpan. */
  json: string | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Baris YARD_LAYOUT untuk satu sumber data. Membaca tidak butuh izin tulis. */
export async function fetchSharedLayout(source: YardSource): Promise<SharedLayout> {
  const res = await fetch(`/api/yard/layout?source=${source}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal memuat tata letak (HTTP ${res.status}).`);
  return json as SharedLayout;
}

/** Ditolak karena ada yang menyimpan lebih dulu; `current` adalah isi terbaru. */
export class LayoutStale extends Error {
  constructor(
    message: string,
    public current: SharedLayout | null,
  ) {
    super(message);
  }
}

export async function saveSharedLayout(
  source: YardSource,
  layout: YardLayout,
  baseRevision: number,
): Promise<SharedLayout> {
  const res = await fetch('/api/yard/layout', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, layout, baseRevision }),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 409) throw new LayoutStale(json?.error ?? 'Tata letak basi.', json?.current ?? null);
  if (!res.ok) throw new Error(json?.error || `Gagal menyimpan tata letak (HTTP ${res.status}).`);
  return json as SharedLayout;
}
