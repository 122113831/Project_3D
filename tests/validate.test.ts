import { describe, expect, it } from 'vitest';
import { PITCH, ROAD } from '@/lib/constants';
import type { LayoutBlock, LayoutRoad } from '@/lib/layout';
import { obbIntersects, validateLayout } from '@/lib/validate';

const block = (id: string, x: number, z: number, rot = 0): LayoutBlock => ({
  id,
  originX: x,
  originZ: z,
  slots: 10,
  rows: 4,
  tiers: 5,
  slotStep: 2,
  rot,
  truckLane: 'L',
  slotStart: 'L',
});
const road = (id: string, x: number, z: number): LayoutRoad => ({ id, kind: 'straight', x, z, ry: 0 });

describe('obbIntersects', () => {
  it('bersentuhan di tepi bukan menimpa, bergeser sedikit baru menimpa', () => {
    const a = { cx: 0, cz: 0, sx: 10, sz: 4, ry: 0 };
    expect(obbIntersects(a, { ...a, cx: 10 })).toBe(false);
    expect(obbIntersects(a, { ...a, cx: 9 })).toBe(true);
  });
  it('memperhitungkan rotasi', () => {
    const a = { cx: 0, cz: 0, sx: 20, sz: 2, ry: 0 };
    const b = { cx: 0, cz: 6, sx: 20, sz: 2, ry: 0 };
    expect(obbIntersects(a, b)).toBe(false);
    // Diputar 90°, kotak b sekarang memotong a.
    expect(obbIntersects(a, { ...b, ry: Math.PI / 2 })).toBe(true);
  });
});

describe('validateLayout', () => {
  const L = 10 * PITCH.teu;
  const W = 4 * PITCH.row;
  it('tata letak bersih tidak menghasilkan temuan selain gate', () => {
    const issues = validateLayout({
      blocks: [block('A', 0, 0), block('B', 0, W + 30)],
      roads: [road('r1', L / 2, W + 15)],
      equipment: [],
      diag: null,
    });
    expect(issues.map((i) => i.id).sort()).toEqual(['no-gate-in', 'no-gate-out']);
  });
  it('menemukan blok bertindihan dan jalan tertimpa', () => {
    const issues = validateLayout({
      blocks: [block('A', 0, 0), block('B', L / 2, 0)],
      roads: [road('r1', L / 2, W / 2)],
      equipment: [{ id: 'g', kind: 'gate', x: -60, z: 0, ry: 0 }],
      diag: { gatesIn: 1, gatesOut: 1, unreachable: ['A'], gatesUnlinked: ['g'] },
    });
    const ids = issues.map((i) => i.id);
    expect(ids).toContain('overlap:A:B');
    expect(ids).toContain('road-in-block:r1');
    expect(ids).toContain('gate-unlinked:g');
    expect(ids).toContain('unreachable:A');
    expect(ids).not.toContain('no-gate-in');
  });
  it('ubin melintang 8 m dari ujung blok: petaknya menyentuh, aspalnya tidak', () => {
    // Jalan utara-selatan di ujung timur blok, pusat ubin 8,5 m dari tepi:
    // petak 24 m menjorok 3,5 m ke blok, tapi aspal 14 m masih berjarak 1,5 m.
    const issues = validateLayout({
      blocks: [block('D', 0, 0)],
      roads: [{ id: 'ns', kind: 'straight', x: L + 8.5, z: W / 2, ry: Math.PI / 2 }],
      equipment: [],
      diag: null,
    });
    expect(issues.find((i) => i.id.startsWith('road-in-block'))).toBeUndefined();
    // Digeser 4 m lagi ke dalam, aspalnya ikut masuk: baru dilaporkan.
    const bad = validateLayout({
      blocks: [block('D', 0, 0)],
      roads: [{ id: 'ns', kind: 'straight', x: L + 4.5, z: W / 2, ry: Math.PI / 2 }],
      equipment: [],
      diag: null,
    });
    expect(bad.find((i) => i.id.startsWith('road-in-block'))).toBeDefined();
  });
  it('ubin yang bersebelahan dengan blok tidak dianggap tertimpa', () => {
    const issues = validateLayout({
      blocks: [block('A', 0, 0)],
      roads: [road('r1', L / 2, W + ROAD.tile / 2)],
      equipment: [],
      diag: null,
    });
    expect(issues.find((i) => i.id.startsWith('road-in-block'))).toBeUndefined();
  });
});
