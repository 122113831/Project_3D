import type { BlockedCell, YardBlock } from './types';

/**
 * Slot yang dikunci: sel-sel sebuah blok yang tidak boleh ditumpuki.
 *
 * Disimpan di YARD_LAYOUT bersama jalan dan alat, bukan di YARD_ROWTIER.
 * Kolom STATUS di tabel itu berisi jenis muatan ('DRY' untuk seluruh 3.073
 * baris di database dev), bukan saklar hidup-mati, dan memberi arti baru pada
 * kolom milik TOS bisa mengubah perilaku TOS itu sendiri.
 *
 * Satu kunci selalu berlaku DARI DASARNYA KE ATAS: mengunci slot 1 tier 1
 * berarti tier 1 sampai tier teratas di slot dan row itu ikut terkunci,
 * karena tumpukan tidak bisa melompati lubang. Itu sebabnya yang disimpan
 * cuma dasar tiap kolom, dan "membuka" selalu membuka seluruh kolomnya.
 *
 * Berkas ini murni — tanpa React maupun three — supaya bisa diuji langsung.
 */

type Dims = Pick<YardBlock, 'slots' | 'rows' | 'tiers'>;

const key = (bay: number, row: number) => `${bay}:${row}`;

/**
 * Merapikan daftar kunci: membuang yang di luar ukuran blok (misalnya setelah
 * blok dikecilkan), dan menyisakan satu dasar — yang terendah — per kolom.
 */
export function normalizeBlocked(cells: readonly BlockedCell[] | undefined, b: Dims): BlockedCell[] {
  const base = new Map<string, BlockedCell>();
  for (const c of cells ?? []) {
    if (!Number.isInteger(c.bay) || !Number.isInteger(c.row) || !Number.isInteger(c.tier)) continue;
    if (c.bay < 0 || c.bay >= b.slots || c.row < 0 || c.row >= b.rows) continue;
    if (c.tier < 1 || c.tier > b.tiers) continue;
    const k = key(c.bay, c.row);
    const cur = base.get(k);
    if (!cur || c.tier < cur.tier) base.set(k, { bay: c.bay, row: c.row, tier: c.tier });
  }
  return [...base.values()].sort((p, q) => p.bay - q.bay || p.row - q.row);
}

/** Dasar kunci di kolom (bay, row), kalau ada. */
export const blockedBase = (cells: readonly BlockedCell[], bay: number, row: number) =>
  cells.find((c) => c.bay === bay && c.row === row) ?? null;

export function isBlocked(cells: readonly BlockedCell[], bay: number, row: number, tier: number) {
  const e = blockedBase(cells, bay, row);
  return e !== null && tier >= e.tier;
}

/** Jumlah SEL yang terkunci — dasar sampai tier teratas, untuk tiap kolom. */
export function blockedCount(cells: readonly BlockedCell[] | undefined, b: Dims) {
  return normalizeBlocked(cells, b).reduce((n, c) => n + (b.tiers - c.tier + 1), 0);
}

/** Semua sel terkunci satu per satu — untuk digambar. */
export function expandBlocked(cells: readonly BlockedCell[] | undefined, b: Dims): BlockedCell[] {
  const out: BlockedCell[] = [];
  for (const c of normalizeBlocked(cells, b)) {
    for (let tier = c.tier; tier <= b.tiers; tier++) out.push({ bay: c.bay, row: c.row, tier });
  }
  return out;
}

/**
 * Klik pada satu sel.
 *
 *   - Sel bebas            → kolomnya dikunci dari sel ini ke atas.
 *   - Sel sudah terkunci   → seluruh kolom dibuka. Membuka "dari tengah" tidak
 *                            ada artinya: sel di bawahnya tetap tidak bisa
 *                            dicapai lewat lubang.
 *   - Sel bebas DI BAWAH dasar kunci yang ada → dasarnya diturunkan ke sel ini.
 */
export function toggleBlocked(
  cells: readonly BlockedCell[] | undefined,
  b: Dims,
  bay: number,
  row: number,
  tier: number,
): BlockedCell[] {
  const norm = normalizeBlocked(cells, b);
  const e = blockedBase(norm, bay, row);
  const rest = norm.filter((c) => c !== e);
  if (e && tier >= e.tier) return rest;
  return normalizeBlocked([...rest, { bay, row, tier }], b);
}
