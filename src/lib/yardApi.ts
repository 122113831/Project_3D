/**
 * Panggilan ke endpoint tulis lapangan.
 *
 * Dipisah dari store supaya store tetap murni soal keadaan editor, dan supaya
 * setiap tempat yang menulis ke database bisa ditemukan dengan mencari satu
 * nama berkas.
 */

import type { YardLayout } from './layout';
import type { BlockSide, YardContainer, YardSource } from './types';

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

export type ResizeResult = {
  code: string;
  from: { slots: number; rows: number; tiers: number };
  to: { slots: number; rows: number; tiers: number };
  deleted: number;
  inserted: number;
};

/** Ubah slot/row/tier blok di database — lihat /api/yard/block/resize. */
export async function resizeBlockInDb(p: {
  code: string;
  slots: number;
  rows: number;
  tiers: number;
}): Promise<ResizeResult> {
  const res = await fetch('/api/yard/block/resize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal (HTTP ${res.status}).`);
  return json as ResizeResult;
}

/**
 * Kunci slot di YARD_ROWTIER. `slot` = YARD_SLOT (ganjil), `row` 1-based.
 * Lihat /api/yard/slots.
 */
export async function slotAction(
  body:
    | { action: 'lock'; block: string; slot: number; row: number; tier: number }
    | { action: 'unlock'; block: string; slot: number; row: number }
    | { action: 'unlockBlock'; block: string },
): Promise<{ deleted?: number; inserted?: number }> {
  const res = await fetch('/api/yard/slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal (HTTP ${res.status}).`);
  return json;
}

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

// --- perjalanan truk -------------------------------------------------------------

export type { GateTrip } from './depot';
import type { GateTrip } from './depot';

export async function fetchGateTrips(limit: number, openOnly = false): Promise<GateTrip[]> {
  const res = await fetch(`/api/yard/trips?limit=${limit}${openOnly ? '&open=1' : ''}`, {
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal membaca GATE_HIST (HTTP ${res.status}).`);
  return json as GateTrip[];
}

/** Semua perjalanan satu tanggal (YYYY-MM-DD), urut jam. */
export async function fetchGateDay(day: string): Promise<GateTrip[]> {
  const res = await fetch(`/api/yard/trips?day=${encodeURIComponent(day)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal membaca GATE_HIST (HTTP ${res.status}).`);
  return json as GateTrip[];
}

/** Hari-hari yang punya gate in, terbaru lebih dulu. */
export async function fetchGateDays(): Promise<{ day: string; trips: number }[]> {
  const res = await fetch('/api/yard/trips?days=1', { cache: 'no-store' });
  if (!res.ok) return [];
  return (await res.json()) as { day: string; trips: number }[];
}

/** Satu kontainer beserta posisinya sekarang; null kalau tidak di lapangan. */
export async function fetchContainer(no: string): Promise<YardContainer | null> {
  const res = await fetch(`/api/yard/container?no=${encodeURIComponent(no)}`, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal membaca kontainer (HTTP ${res.status}).`);
  return json?.found ? (json.container as YardContainer) : null;
}

// --- KPI ---------------------------------------------------------------------

export type { YardKpi } from './depotKpi';
import type { YardKpi } from './depotKpi';

export async function fetchKpi(): Promise<YardKpi> {
  const res = await fetch('/api/yard/kpi', { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || `Gagal menghitung KPI (HTTP ${res.status}).`);
  return json as YardKpi;
}
