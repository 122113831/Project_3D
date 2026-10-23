import { describe, expect, it } from 'vitest';
import { PITCH, ROAD } from '@/lib/constants';
import { emptyLayout, type LayoutBlock, type LayoutRoad, type YardLayout } from '@/lib/layout';
import { roadLen } from '@/lib/roadSnap';
import { planGrowth } from '@/lib/shift';

const block = (id: string, x: number, z: number, slots: number, rows = 4): LayoutBlock => ({
  id,
  originX: x,
  originZ: z,
  slots,
  rows,
  tiers: 5,
  slotStep: 2,
  rot: 0,
  truckLane: 'L',
  slotStart: 'L',
});
const road = (id: string, x: number, z: number, ry = 0): LayoutRoad => ({ id, kind: 'straight', x, z, ry });

describe('planGrowth', () => {
  const base = { slots: 10, rows: 4 };
  const L0 = 10 * PITCH.teu; // 64 m
  const W = 4 * PITCH.row;

  it('menggeser jalan, alat, dan blok di luar tepi lama sejauh pertumbuhan', () => {
    const layout: YardLayout = {
      ...emptyLayout(),
      blocks: [block('A', 0, 0, 12), block('B', L0 + 40, 0, 10)],
      roads: [road('ujung', L0 + 12, W / 2, Math.PI / 2), road('awal', -12, W / 2, Math.PI / 2)],
      equipment: [
        { id: 'lamp-e', kind: 'lamp', x: L0 + 5, z: -10, ry: 0 },
        { id: 'lamp-w', kind: 'lamp', x: -5, z: -10, ry: 0 },
      ],
    };
    const { plans, layout: out } = planGrowth(layout, 'A', base);
    expect(plans).toHaveLength(1);
    const p = plans[0];
    expect(p.axis).toBe('x');
    expect(p.delta).toBeCloseTo(2 * PITCH.teu);
    expect(p.roads).toEqual(['ujung']);
    expect(p.equipment).toEqual(['lamp-e']);
    expect(p.blocks).toEqual(['B']);
    expect(out.roads.find((r) => r.id === 'ujung')!.x).toBeCloseTo(L0 + 12 + 2 * PITCH.teu);
    expect(out.roads.find((r) => r.id === 'awal')!.x).toBe(-12);
    expect(out.blocks.find((b) => b.id === 'B')!.originX).toBeCloseTo(L0 + 40 + 2 * PITCH.teu);
  });

  it('menutup celah jalan sejajar yang melintasi tepi lama dengan ubin pendek', () => {
    const z = W + ROAD.tile / 2;
    // Dua ubin lurus E-W bersebelahan di sisi selatan blok, sambungannya tepat di tepi lama.
    const layout: YardLayout = {
      ...emptyLayout(),
      blocks: [block('A', 0, 0, 11)],
      roads: [road('kiri', L0 - ROAD.tile / 2, z), road('kanan', L0 + ROAD.tile / 2, z)],
    };
    const { plans, layout: out } = planGrowth(layout, 'A', base);
    expect(plans[0].roads).toEqual(['kanan']);
    expect(plans[0].fillers).toHaveLength(1);
    const f = out.roads.find((r) => r.id === plans[0].fillers[0].id)!;
    expect(roadLen(f)).toBeCloseTo(PITCH.teu);
    expect(f.x).toBeCloseTo(L0 + PITCH.teu / 2);
    expect(f.z).toBeCloseTo(z);
  });

  it('tidak ada rencana kalau blok tidak membesar', () => {
    const layout: YardLayout = { ...emptyLayout(), blocks: [block('A', 0, 0, 10)] };
    expect(planGrowth(layout, 'A', base).plans).toHaveLength(0);
  });

  it('pertumbuhan row menggeser ke +Z', () => {
    const layout: YardLayout = {
      ...emptyLayout(),
      blocks: [block('A', 0, 0, 10, 6)],
      roads: [road('selatan', L0 / 2, W + ROAD.tile / 2)],
    };
    const { plans, layout: out } = planGrowth(layout, 'A', base);
    expect(plans[0].axis).toBe('z');
    expect(out.roads[0].z).toBeCloseTo(W + ROAD.tile / 2 + 2 * PITCH.row);
  });
});
