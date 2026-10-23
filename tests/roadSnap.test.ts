import { describe, expect, it } from 'vitest';
import { ROAD } from '@/lib/constants';
import { snapRoad, type SnapBlock, type SnapRoad } from '@/lib/roadSnap';

/**
 * Geometri blok A dan B diambil dari database depot apa adanya — celah 0,40 m
 * dan 6,00 m di antara keduanya adalah kasus nyata yang dulu tidak bisa
 * disambung.
 */
const A: SnapBlock = { originX: -1.5, originZ: 19.4, slots: 19, rows: 5, rot: 0, truckLane: 'L' };
const B: SnapBlock = { originX: -7.5, originZ: 64.5, slots: 20, rows: 6, rot: 0, truckLane: 'L' };
const blocks = [A, B];

const LANE_A_Z = 49.1;
const LANE_A_END = 120.1;
const LANE_B_END = 120.5;

const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

describe('snapRoad — potongan jalan dinamis', () => {
  it('ruang lapang: ubin penuh tepat di ujung lorong', () => {
    const s = snapRoad(blocks, [], 'straight', LANE_A_END + 10, LANE_A_Z);
    expect(near(s.x, 132.1)).toBe(true);
    expect(near(s.len, ROAD.tile)).toBe(true);
    expect(s.ry).not.toBeNull();
  });

  it('menutup celah 19,9 m di depan ubin lain dengan potongan sepanjang celah itu', () => {
    let roads: SnapRoad[] = [{ id: 'jauh', kind: 'straight', x: 200, z: LANE_A_Z, ry: 0 }];
    const place = (clickX: number) => {
      const r = snapRoad(blocks, roads, 'straight', clickX, LANE_A_Z);
      roads = [...roads, { id: 'r' + roads.length, kind: 'straight', x: r.x, z: r.z, ry: r.ry ?? 0, len: r.len }];
      return r;
    };
    expect(near(place(LANE_A_END + 10).x, 132.1)).toBe(true);
    expect(near(place(150).x, 156.1)).toBe(true);
    const third = place(175);
    expect(near(third.x, 178.05)).toBe(true);
    expect(near(third.len, 19.9)).toBe(true);
    // Rapat ke sisi ubin di depannya: 200 - 12 = 188.
    expect(near(third.x + third.len / 2, 188)).toBe(true);
  });

  it('menutup celah 6,00 m sampai ke ujung lorong blok B', () => {
    const roads: SnapRoad[] = [{ id: 'awal', kind: 'straight', x: 138.5, z: 97.1, ry: 0 }];
    const s = snapRoad(blocks, roads, 'straight', 130, 97.1);
    expect(near(s.len, 6)).toBe(true);
    expect(near(s.x - s.len / 2, LANE_B_END)).toBe(true);
  });

  it('belokan tidak pernah memendek', () => {
    const roads: SnapRoad[] = [
      { id: 'jauh', kind: 'straight', x: 200, z: LANE_A_Z, ry: 0 },
      { id: 'a', kind: 'straight', x: 132.1, z: LANE_A_Z, ry: 0 },
      { id: 'b', kind: 'straight', x: 156.1, z: LANE_A_Z, ry: 0 },
    ];
    const s = snapRoad(blocks, roads, 'corner', 175, LANE_A_Z);
    expect(near(s.len, ROAD.tile)).toBe(true);
  });

  it('jauh dari apa pun: jatuh ke kisi global tanpa sudut tempelan', () => {
    const s = snapRoad(blocks, [], 'straight', 1000, 1000);
    expect(s.ry).toBeNull();
    expect(near(s.len, ROAD.tile)).toBe(true);
  });
});
