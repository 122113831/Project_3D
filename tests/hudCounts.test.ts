import { describe, expect, it } from 'vitest';
import { filterCounts, legendFor } from '@/lib/hudCounts';
import type { YardContainer } from '@/lib/types';

const ctr = (p: Partial<YardContainer>): YardContainer =>
  ({
    no: 'X', size: 20, type: 'gp', status: 'empty', line: 'MRT', block: 'A', bay: 0, row: 0, tier: 1,
    weightKg: 0, vessel: '', inDate: '', filled: false, damaged: false, typeCode: 'GP', isoCode: '22G1',
    reefer: false, dangerous: false, ...p,
  }) as YardContainer;

const yard = [
  ctr({ line: 'MRT', filled: true, status: 'full', tier: 1 }),
  ctr({ line: 'MRT', size: 40, tier: 2 }),
  ctr({ line: 'RCL', reefer: true, status: 'reefer', tier: 3 }),
  ctr({ line: 'TNT', damaged: true, status: 'damaged', tier: 6 }),
  ctr({ line: 'TNT', type: 'tank', tier: 1 }),
];

describe('jumlah chip filter', () => {
  it('memakai aturan filter yang sama dengan lapangan 3D', () => {
    const n = filterCounts(yard);
    expect(n.lines).toEqual({ MRT: 2, RCL: 1, TNT: 2 });
    expect(n.statuses.full).toBe(1);
    expect(n.statuses.empty).toBe(4); // kosong = tidak terisi, termasuk reefer & rusak
    expect(n.statuses.damaged).toBe(1);
    expect(n.statuses.dangerous).toBe(0);
    expect(n.sizes).toEqual({ 20: 4, 40: 1 });
    expect(n.types).toEqual({ gp: 4, tank: 1, reefer: 1 });
  });
});

describe('legenda pewarnaan', () => {
  it('shipping line: satu baris per line, urut sesuai daftar, dengan jumlahnya', () => {
    const l = legendFor('line', yard, ['MRT', 'RCL', 'SPL', 'TNT']);
    expect(l.map((x) => [x.label, x.n])).toEqual([['MRT', 2], ['RCL', 1], ['SPL', 0], ['TNT', 2]]);
    expect(l.every((x) => /^#|^rgb|^hsl/.test(x.color))).toBe(true);
  });

  it('status mengikuti warna yang dipakai renderer (status kontainer), kosong disembunyikan', () => {
    const l = legendFor('status', yard, []);
    expect(l.map((x) => x.key)).toEqual(['full', 'empty', 'reefer', 'damaged']);
    expect(l.find((x) => x.key === 'empty')!.n).toBe(2);
  });

  it('tier: tier 5 ke atas digabung', () => {
    const l = legendFor('tier', yard, []);
    expect(l.map((x) => [x.label, x.n])).toEqual([['Tier 1', 2], ['Tier 2', 1], ['Tier 3', 1], ['Tier 4', 0], ['Tier 5+', 1]]);
  });

  it('tanpa warna: per jenis aset', () => {
    expect(legendFor('none', yard, []).map((x) => [x.key, x.n])).toEqual([['gp', 4], ['tank', 1], ['reefer', 1]]);
  });

  it('ukuran: 20 ft dan 40 ft', () => {
    expect(legendFor('size', yard, []).map((x) => [x.label, x.n])).toEqual([['20 ft', 4], ['40 ft', 1]]);
  });
});
