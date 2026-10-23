import { describe, expect, it } from 'vitest';
import type { LayoutEquipment, LayoutRoad } from '@/lib/layout';
import {
  buildRoadGraph,
  routeFromStop,
  routeToStop,
  stopFor,
  unreachableBlocks,
} from '@/lib/roadGraph';
import type { YardBlock } from '@/lib/types';

/**
 * Lapangan sintetis kecil: blok A dengan lorong di sisi +Z, satu gerbang di
 * perpanjangan lorong itu, dan blok B jauh tanpa jalan sama sekali.
 */
const block = (id: string, originX: number, originZ: number, slots: number, rows: number): YardBlock => ({
  id,
  originX,
  originZ,
  slots,
  rows,
  tiers: 5,
  slotStep: 1,
  rot: 0,
  truckLane: 'L',
  slotStart: 'L',
  containers: [],
});

const A = block('A', 0, 0, 10, 4); // panjang 64 m, lebar 11,6 m
const B = block('B', 0, 400, 10, 4);
// Lorong A: Z = 0 + 11,6/2 + (11,6/2 + 15,2) = 26,8; X dari 0 sampai 64.
const LANE_Z = 11.6 + 15.2;

const gate: LayoutEquipment = { id: 'g1', kind: 'gate', x: 64 + 20, z: LANE_Z, ry: 0 };
const roads: LayoutRoad[] = [];
const centre = { x: 32, z: 100 };

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe('buildRoadGraph', () => {
  const g = buildRoadGraph([A, B], roads, [gate], centre);

  it('menempelkan gerbang ke ujung lorong dan menandai sisi luarnya menjauhi lapangan', () => {
    expect(g.gates).toHaveLength(1);
    const gt = g.gates[0];
    expect(gt.kind).toBe('both');
    // Gerbang tersambung ke setidaknya satu node jalan.
    expect(g.adj[gt.node].length).toBeGreaterThan(0);
    // Sisi luar lebih jauh dari pusat lapangan daripada gerbangnya sendiri.
    expect(dist(gt.outside, centre)).toBeGreaterThan(dist(gt, centre));
  });

  it('merutekan gerbang → bay → gerbang, melewati node gerbang di kedua arah', () => {
    const gt = g.gates[0];
    const stop = stopFor(g, A, 3, 20);
    expect(stop).not.toBeNull();
    const masuk = routeToStop(g, gt, stop!);
    const keluar = routeFromStop(g, stop!, gt);
    expect(masuk).not.toBeNull();
    expect(keluar).not.toBeNull();
    const gateNode = g.nodes[gt.node];
    expect(dist(masuk![0], gt.outside)).toBeLessThan(0.01);
    expect(masuk!.some((p) => dist(p, gateNode) < 0.01)).toBe(true);
    expect(dist(masuk![masuk!.length - 1], stop!.pt)).toBeLessThan(0.01);
    expect(keluar!.some((p) => dist(p, gateNode) < 0.01)).toBe(true);
    expect(dist(keluar![keluar!.length - 1], gt.outside)).toBeLessThan(0.01);
  });

  it('titik berhenti ada di lajur layanan, sejajar bay-nya', () => {
    const stop = stopFor(g, A, 3, 20)!;
    // bay 3 (0-based) berpusat di X = (3 + 0,5) * 6,4 = 22,4
    expect(Math.abs(stop.pt.x - 22.4)).toBeLessThan(0.01);
    // lajur layanan: tepi blok + 3 m
    expect(Math.abs(stop.pt.z - (11.6 + 3))).toBeLessThan(0.01);
  });

  it('melaporkan blok yang tidak tersambung ke gerbang mana pun', () => {
    expect(unreachableBlocks(g)).toEqual(['B']);
  });

  it('tanpa gerbang, semua blok tidak terjangkau', () => {
    const g2 = buildRoadGraph([A, B], roads, [], centre);
    expect(unreachableBlocks(g2).sort()).toEqual(['A', 'B']);
  });

  it('ubin jalan yang menempel ke ujung lorong menyambungkan graf', () => {
    // Ubin lurus 24 m tepat di luar ujung lorong A: 64 + 12 = 76.
    const tile: LayoutRoad = { id: 't1', kind: 'straight', x: 76, z: LANE_Z, ry: 0 };
    const farGate: LayoutEquipment = { id: 'g2', kind: 'gate', x: 76 + 12 + 20, z: LANE_Z, ry: 0 };
    const g3 = buildRoadGraph([A], [tile], [farGate], centre);
    const stop = stopFor(g3, A, 0, 20)!;
    expect(routeToStop(g3, g3.gates[0], stop)).not.toBeNull();
    expect(unreachableBlocks(g3)).toEqual([]);
  });
});
