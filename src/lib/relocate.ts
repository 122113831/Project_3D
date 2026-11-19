import { isBlocked } from './slots';
import type { YardBlock, YardContainer } from './types';

/**
 * Memilih satu relokasi contoh di sebuah blok: kontainer 20ft yang berada di
 * PUNCAK tumpukannya, dipindah ke puncak tumpukan lain yang masih muat.
 *
 * Aturan yang dipegang sama dengan lapangan sungguhan: tidak mengangkat
 * kontainer yang tertindih, tidak menumpuk 20ft di atas 40ft (atau
 * sebaliknya), tidak melewati tier teratas, dan tidak menaruh di slot
 * terkunci. Tujuan terdekat (dalam bay) dipilih lebih dulu — relokasi di
 * lapangan memang biasanya geser pendek.
 *
 * Mengembalikan null kalau blok itu tidak punya pasangan yang sah.
 */
export function pickRelocation(
  b: Pick<YardBlock, 'slots' | 'rows' | 'tiers' | 'containers' | 'blocked'>,
  rand: () => number = Math.random,
): { c: YardContainer; to: { bay: number; row: number; tier: number } } | null {
  // Tinggi dan ukuran tiap tumpukan. 40ft menempati dua posisi (bay, bay+1).
  const height = new Map<string, number>();
  const has40 = new Set<string>();
  const key = (bay: number, row: number) => `${bay}:${row}`;
  for (const c of b.containers) {
    const span = c.size === 40 ? 2 : 1;
    for (let i = 0; i < span; i++) {
      const k = key(c.bay + i, c.row);
      height.set(k, Math.max(height.get(k) ?? 0, c.tier));
      if (c.size === 40) has40.add(k);
    }
  }
  const sources = b.containers.filter(
    (c) => c.size === 20 && !has40.has(key(c.bay, c.row)) && height.get(key(c.bay, c.row)) === c.tier,
  );
  if (sources.length === 0) return null;
  // Mulai dari sumber acak supaya tombol contoh tidak selalu memindah yang sama.
  const start = Math.floor(rand() * sources.length);
  for (let n = 0; n < sources.length; n++) {
    const c = sources[(start + n) % sources.length];
    let best: { bay: number; row: number; tier: number; d: number } | null = null;
    for (let bay = 0; bay < b.slots; bay++) {
      for (let row = 0; row < b.rows; row++) {
        if (bay === c.bay && row === c.row) continue;
        const k = key(bay, row);
        if (has40.has(k)) continue;
        const tier = (height.get(k) ?? 0) + 1;
        if (tier > b.tiers) continue;
        if (isBlocked(b.blocked ?? [], bay, row, tier)) continue;
        const d = Math.abs(bay - c.bay) * 2 + Math.abs(row - c.row);
        if (!best || d < best.d) best = { bay, row, tier, d };
      }
    }
    if (best) return { c, to: { bay: best.bay, row: best.row, tier: best.tier } };
  }
  return null;
}
