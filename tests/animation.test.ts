import { describe, expect, it } from 'vitest';
import { makeRoute, nearestS, roundCorners } from '@/lib/roadGraph';
import { pickRelocation } from '@/lib/relocate';
import { skyAtHour, withWeather } from '@/lib/sky';
import type { YardContainer } from '@/lib/types';

const ctr = (no: string, bay: number, row: number, tier: number, size: 20 | 40 = 20): YardContainer => ({
  no,
  size,
  type: 'gp',
  status: 'full',
  line: 'X',
  block: 'A',
  bay,
  row,
  tier,
  weightKg: 0,
  vessel: '',
  inDate: '2026-01-01',
  filled: true,
  damaged: false,
  typeCode: 'GP',
  isoCode: '22G1',
  reefer: false,
  dangerous: false,
});

describe('roundCorners', () => {
  it('membulatkan sudut siku tanpa memindah titik awal dan akhir', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 50, z: 0 },
      { x: 50, z: 50 },
    ];
    const out = roundCorners(pts, 9, 6);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[2]);
    expect(out.length).toBe(9);
    // Titik sudut asli tidak lagi dilewati: kurva memotong di dalam siku.
    expect(out.some((p) => p.x === 50 && p.z === 0)).toBe(false);
    // Rute membulat sedikit lebih pendek dari jalur siku.
    expect(makeRoute(out).length).toBeLessThan(100);
    expect(makeRoute(out).length).toBeGreaterThan(95);
  });
  it('ruas lurus dibiarkan', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 20, z: 0 },
    ];
    expect(roundCorners(pts)).toEqual(pts);
  });
});

describe('nearestS', () => {
  it('jarak sepanjang rute ke titik terdekat', () => {
    const r = makeRoute([
      { x: 0, z: 0 },
      { x: 40, z: 0 },
      { x: 40, z: 30 },
    ]);
    expect(nearestS(r, { x: 20, z: 3 })).toBeCloseTo(20);
    expect(nearestS(r, { x: 45, z: 10 })).toBeCloseTo(50);
  });
});

describe('skyAtHour', () => {
  it('malam di tengah malam, siang di tengah hari, senja jingga sore hari', () => {
    expect(skyAtHour(0).night).toBe(true);
    expect(skyAtHour(12).night).toBe(false);
    expect(skyAtHour(12).elevation).toBeCloseTo(1);
    // Matahari pagi di timur (+X), sore di barat (-X).
    expect(skyAtHour(8).dir[0]).toBeGreaterThan(0);
    expect(skyAtHour(16).dir[0]).toBeLessThan(0);
    // Senja: kanal merah langit lebih tinggi dari biru.
    const c = skyAtHour(17.8).clear;
    expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThan(parseInt(c.slice(5, 7), 16));
  });
  it('awan meredupkan matahari', () => {
    const s = skyAtHour(12);
    expect(withWeather(s, 1).sunIntensity).toBeLessThan(s.sunIntensity * 0.5);
  });
});

describe('pickRelocation', () => {
  const block = { slots: 4, rows: 2, tiers: 3, blocked: [] };
  it('hanya mengangkat kontainer teratas dan menaruh di atas tumpukan yang muat', () => {
    const containers = [ctr('A1', 0, 0, 1), ctr('A2', 0, 0, 2), ctr('B1', 1, 0, 1)];
    const r = pickRelocation({ ...block, containers }, () => 0)!;
    expect(['A2', 'B1']).toContain(r.c.no);
    expect(r.c.no).not.toBe('A1');
    expect(r.to.tier).toBeLessThanOrEqual(3);
  });
  it('tidak menumpuk 20ft di atas 40ft dan menghormati kunci', () => {
    const containers = [ctr('S', 0, 0, 1), ctr('F', 1, 0, 1, 40)];
    const blocked = [
      { bay: 0, row: 1, tier: 1 },
      { bay: 3, row: 0, tier: 1 },
      { bay: 1, row: 1, tier: 1 },
      { bay: 2, row: 1, tier: 1 },
      { bay: 3, row: 1, tier: 1 },
    ];
    // Semua tujuan terkunci atau 40ft: tidak ada relokasi sah.
    expect(pickRelocation({ ...block, containers, blocked })).toBeNull();
  });
});
