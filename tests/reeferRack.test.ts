import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PITCH } from '../src/lib/constants';
import { buildReeferRack, RACK } from '../src/lib/reeferRack';

const bounds = (g: THREE.BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe('rak listrik reefer', () => {
  const slots = 20;
  const rows = 6;
  const W = rows * PITCH.row;

  it('berdiri di sisi seberang lajur truk, di luar tapak blok', () => {
    for (const side of [1, -1] as const) {
      const r = buildReeferRack(slots, rows, 5, side);
      for (const g of [r.steel, r.rail, r.grating, r.socket]) {
        const b = bounds(g);
        if (side === 1) expect(b.max.z).toBeLessThanOrEqual(-W / 2 + 0.01);
        else expect(b.min.z).toBeGreaterThanOrEqual(W / 2 - 0.01);
      }
      // Kotak stopkontak menempel di sisi dalam rak, menghadap tumpukan.
      const s = bounds(r.socket);
      expect(Math.min(Math.abs(s.max.z), Math.abs(s.min.z))).toBeLessThan(W / 2 + RACK.gap + 0.3);
    }
  });

  it('satu stopkontak per bay per tier (+ pintu panel listrik)', () => {
    const tiers = 4;
    const r = buildReeferRack(slots, rows, tiers, 1);
    // Tiap kotak = BoxGeometry 24 vertex.
    expect(r.socket.getAttribute('position').count / 24).toBe(slots * tiers + 1);
  });

  it('platform sampai tier tertinggi: rak setinggi tumpukan', () => {
    const lo = bounds(buildReeferRack(slots, rows, 3, 1).steel).max.y;
    const hi = bounds(buildReeferRack(slots, rows, 6, 1).steel).max.y;
    expect(hi - lo).toBeCloseTo(3 * PITCH.tier, 1);
  });
});
