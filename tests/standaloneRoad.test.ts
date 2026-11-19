import { describe, expect, it } from 'vitest';
import { PITCH, ROAD } from '@/lib/constants';
import type { LayoutEquipment, LayoutRoad } from '@/lib/layout';
import { buildRoadGraph, onRoadBody, routeToStop, stopFor, unreachableBlocks } from '@/lib/roadGraph';
import { laneRoadTiles, roadLen, snapRoad } from '@/lib/roadSnap';
import type { YardBlock } from '@/lib/types';

const block = (ownRoad: boolean): YardBlock => ({
  id: 'N',
  originX: 0,
  originZ: 0,
  slots: 10,
  rows: 4,
  tiers: 5,
  slotStep: 2,
  rot: 0,
  truckLane: 'L',
  slotStart: 'L',
  containers: [],
  ownRoad,
});
const L = 10 * PITCH.teu; // 64 m

describe('jalan berdiri sendiri', () => {
  it('laneRoadTiles menutup panjang lorong persis, potongan terakhir dipendekkan', () => {
    const tiles = laneRoadTiles(block(true), () => 'r');
    expect(tiles).toHaveLength(3);
    const total = tiles.reduce((n, t) => n + roadLen(t), 0);
    expect(total).toBeCloseTo(L);
    expect(tiles[2].len).toBeCloseTo(L - 2 * ROAD.tile);
  });

  it('blok tanpa jalan bawaan: tak terjangkau sampai ada ubin di lorongnya', () => {
    const b = block(false);
    const tiles = laneRoadTiles(b, () => 'x').map((t, i) => ({ ...t, id: `t${i}` }));
    // Gate di ujung barat lorong, sumbunya searah lorong.
    const laneZ = tiles[0].z;
    const gate: LayoutEquipment = { id: 'g', kind: 'gate', x: -60, z: laneZ, ry: 0 };
    // Ubin penghubung gate: berhenti 4 m sebelum ujung lorong — belum menyentuh blok.
    const extra: LayoutRoad = { id: 'w', kind: 'straight', x: -24, z: laneZ, ry: 0, len: 40 } as LayoutRoad;
    const bridge: LayoutRoad = { id: 'b', kind: 'straight', x: -2, z: laneZ, ry: 0, len: 4 } as LayoutRoad;

    const bare = buildRoadGraph([b], [extra], [gate], { x: 0, z: 0 });
    expect(unreachableBlocks(bare)).toEqual(['N']);
    expect(stopFor(bare, b, 3, 20)).toBeNull();

    const g = buildRoadGraph([b], [extra, bridge, ...tiles], [gate], { x: 0, z: 0 });
    expect(unreachableBlocks(g)).toEqual([]);
    const stop = stopFor(g, b, 3, 20)!;
    expect(stop).not.toBeNull();
    expect(routeToStop(g, g.gates[0], stop)).not.toBeNull();
  });

  it('onRoadBody: badan aspal, bukan petak penuh', () => {
    const r: LayoutRoad = { id: 'a', kind: 'straight', x: 0, z: 0, ry: 0 };
    expect(onRoadBody([r], 10, 0)).toBe(true);
    expect(onRoadBody([r], 0, ROAD.width / 2 - 0.1)).toBe(true);
    expect(onRoadBody([r], 0, ROAD.width / 2 + 1)).toBe(false);
  });

  it('ubin di samping blok tanpa jalan menjepret ke garis lorongnya', () => {
    const b = block(false);
    const laneZ = laneRoadTiles(b, () => 'x')[0].z;
    const fit = snapRoad([b], [], 'straight', 30, laneZ + 3);
    expect(fit.z).toBeCloseTo(laneZ);
    expect(fit.ry).toBeCloseTo(0);
  });
});
