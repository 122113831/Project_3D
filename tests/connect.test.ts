import { describe, expect, it } from 'vitest';
import { ROAD } from '@/lib/constants';
import { connectRoads, shapeFor } from '@/lib/connect';
import type { LayoutBlock, LayoutRoad } from '@/lib/layout';
import { buildRoadGraph } from '@/lib/roadGraph';

const T = ROAD.tile;
const c = (k: number) => (k + 0.5) * T;
let n = 0;
const id = () => `n${n++}`;

const block = (x: number, z: number, slots: number, rows: number): LayoutBlock => ({
  id: 'B',
  originX: x,
  originZ: z,
  slots,
  rows,
  tiers: 5,
  slotStep: 2,
  rot: 0,
  truckLane: 'L',
  slotStart: 'L',
  ownRoad: false,
});

describe('shapeFor', () => {
  it('memetakan lengan ke bentuk dan sudut', () => {
    expect(shapeFor(new Set(['E', 'W']))).toEqual({ kind: 'straight', ry: 0 });
    expect(shapeFor(new Set(['N', 'S'])).kind).toBe('straight');
    expect(shapeFor(new Set(['N', 'S'])).ry).toBeCloseTo(Math.PI / 2);
    expect(shapeFor(new Set(['E', 'S']))).toEqual({ kind: 'corner', ry: 0 });
    expect(shapeFor(new Set(['E', 'W', 'S']))).toEqual({ kind: 'tee', ry: 0 });
    expect(shapeFor(new Set(['E', 'W', 'N', 'S'])).kind).toBe('cross');
  });
});

describe('connectRoads', () => {
  it('jalur lurus dari titik ke titik: ubin lurus berderet', () => {
    const r = connectRoads([], [], { x: c(0), z: c(0) }, { x: c(4), z: c(0) }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toBe(5);
    expect(r.roads.every((x) => x.kind === 'straight' && x.ry === 0)).toBe(true);
  });

  it('berbelok membuat satu belokan, dan hasilnya tersambung di graf', () => {
    const r = connectRoads([], [], { x: c(0), z: c(0) }, { x: c(3), z: c(3) }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.roads.filter((x) => x.kind === 'corner')).toHaveLength(1);
    // Satu komponen: semua simpul ubin saling terjangkau.
    const g = buildRoadGraph([], r.roads, [], { x: 0, z: 0 });
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) {
      for (const e of g.adj[stack.pop()!]) {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          stack.push(e.to);
        }
      }
    }
    expect(seen.size).toBe(g.nodes.length);
  });

  it('memutari blok, tidak menembusnya', () => {
    // Blok melintang di tengah jalur lurus.
    const b = block(c(2) - 20, c(-2), 6, 30);
    const r = connectRoads([b], [], { x: c(0), z: c(0) }, { x: c(5), z: c(0) }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.cells).toBeGreaterThan(6);
    expect(r.roads.filter((x) => x.kind === 'corner').length).toBeGreaterThanOrEqual(2);
  });

  it('bergabung ke jalan lama dan meningkatkannya menjadi pertigaan', () => {
    const old: LayoutRoad[] = [0, 1, 2, 3, 4].map((k) => ({ id: `o${k}`, kind: 'straight', x: c(k), z: c(0), ry: 0 }));
    const r = connectRoads([], old, { x: c(2), z: c(3) }, { x: c(2), z: c(0) }, id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(1);
    const joint = r.roads.find((x) => x.id === 'o2')!;
    expect(joint.kind).toBe('tee');
    expect(r.roads.filter((x) => x.id.startsWith('o'))).toHaveLength(5);
  });

  it('menolak titik di atas blok', () => {
    const b = block(0, 0, 20, 10);
    const r = connectRoads([b], [], { x: 30, z: 10 }, { x: 300, z: 300 }, id);
    expect(r.ok).toBe(false);
  });
});
