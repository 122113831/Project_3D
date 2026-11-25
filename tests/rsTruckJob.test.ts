import { describe, expect, it } from 'vitest';
import { BOX, PITCH } from '../src/lib/constants';
import {
  parseEquipCode,
  pickMobileUnit,
  planRsTruckJob,
  RS_TRUCK_DECK,
  RS_WORK_DIST,
  rsSpreaderBottom,
  wantsMobile,
  type RsStep,
  type RsUnit,
} from '../src/lib/rsPlan';
import type { YardBlock, YardContainer } from '../src/lib/types';
import { aroundBlock, containerPosition } from '../src/lib/yard';

const unit = (key: string, code: string): RsUnit => ({ key, code, x: 175, z: 175, ry: Math.PI });

describe('kode alat dari PRODUCTION_OPERATOR_NEW', () => {
  it('RS1, rs01, "RS 001" dibaca sama', () => {
    expect(parseEquipCode('RS1')).toEqual({ prefix: 'RS', no: 1 });
    expect(parseEquipCode('rs01')).toEqual({ prefix: 'RS', no: 1 });
    expect(parseEquipCode('RS 001')).toEqual({ prefix: 'RS', no: 1 });
    expect(parseEquipCode('')).toBeNull();
  });

  it('RS, SL, FL = alat bergerak; RTG, truk, dan kosong tetap RTG', () => {
    expect(wantsMobile('RS02')).toBe(true);
    expect(wantsMobile('SL03')).toBe(true);
    expect(wantsMobile('FL01')).toBe(true);
    expect(wantsMobile('RTG01')).toBe(false);
    expect(wantsMobile('HT01')).toBe(false);
    expect(wantsMobile(null)).toBe(false);
  });
});

describe('memilih alat yang bekerja', () => {
  const rs1 = unit('a', 'RS01');
  const rs2 = unit('b', 'RS02');
  const sl1 = unit('c', 'SL01');

  it('kode cocok → alat itu yang jalan', () => {
    expect(pickMobileUnit('RS2', [rs1, rs2], [])).toBe(rs2);
    expect(pickMobileUnit('RS01', [rs1, rs2], [])).toBe(rs1);
  });

  it('alat yang disebut data sedang sibuk → ditunggu, tidak diganti alat lain', () => {
    expect(pickMobileUnit('RS02', [rs1, rs2], ['b'])).toBe('wait');
  });

  it('hanya ada RS01 tapi data menyebut RS02 → RS01 yang jalan', () => {
    expect(pickMobileUnit('RS02', [rs1], [])).toBe(rs1);
  });

  it('kode tidak ada → alat sejenis dulu, baru alat lain', () => {
    expect(pickMobileUnit('SL04', [rs1, sl1], [])).toBe(sl1);
    expect(pickMobileUnit('SL04', [rs1], [])).toBe(rs1);
    expect(pickMobileUnit('RS09', [rs1, rs2], ['a'])).toBe(rs2);
  });

  it('tidak ada alat bergerak di tata letak → null (RTG yang melayani)', () => {
    expect(pickMobileUnit('RS01', [], [])).toBeNull();
  });
});

describe('rencana RS untuk truk gate', () => {
  const blk = {
    id: 'B',
    originX: -7.5,
    originZ: 64.5,
    slots: 20,
    slotStep: 2,
    rows: 6,
    tiers: 7,
    rot: 0,
    truckLane: 'L',
    slotStart: 'L',
    containers: [],
  } as unknown as YardBlock;
  const width = blk.rows * PITCH.row;
  // Truk di lajur layanan sisi +z (truckLane L), di bay 5.
  const c = { no: 'TEST0000001', size: 20, bay: 5, row: 0, tier: 2 } as YardContainer;
  const [cx] = containerPosition(blk, c);
  const [, tz] = aroundBlock(blk, 0, width / 2 + 3);
  const truck = { x: cx, z: tz };
  const lastDrive = (steps: RsStep[], i: number) => {
    const s = steps.slice(0, i).reverse().find((x) => x.kind === 'drive');
    return s && s.kind === 'drive' ? s.pts[s.pts.length - 1] : null;
  };

  for (const flow of ['R', 'D'] as const) {
    it(`${flow}: mengunci di ${flow === 'R' ? 'dek truk' : 'tumpukan'}, melepas di ${flow === 'R' ? 'tumpukan' : 'dek truk'}`, () => {
      const plan = planRsTruckJob(unit('a', 'RS01'), blk, flow, c, truck, [blk]);
      const gi = plan.steps.findIndex((s) => s.kind === 'boom' && s.event === 'grab');
      const ri = plan.steps.findIndex((s) => s.kind === 'boom' && s.event === 'release');
      expect(gi).toBeGreaterThan(0);
      expect(ri).toBeGreaterThan(gi);
      const atTruck = (p: { x: number; z: number } | null) => !!p && Math.abs(p.z - (truck.z + RS_WORK_DIST)) < 0.01;
      const [, , sz] = containerPosition(blk, c);
      const atStack = (p: { x: number; z: number } | null) => !!p && p.z < sz - RS_WORK_DIST + 0.01;
      const g = lastDrive(plan.steps, gi);
      const r = lastDrive(plan.steps, ri);
      expect(flow === 'R' ? atTruck(g) : atStack(g)).toBe(true);
      expect(flow === 'R' ? atStack(r) : atTruck(r)).toBe(true);
      // Alas spreader saat mengunci/melepas di dek truk = puncak kontainer di dek.
      const deckStep = plan.steps[flow === 'R' ? gi : ri];
      if (deckStep.kind === 'boom') {
        expect(rsSpreaderBottom(deckStep.from).y).toBeCloseTo(RS_TRUCK_DECK + BOX.height, 1);
        expect(rsSpreaderBottom(deckStep.from).dx).toBeCloseTo(RS_WORK_DIST, 1);
      }
    });
  }

  it('tidak menembus blok: semua titik lintasan di luar tapak blok', () => {
    const plan = planRsTruckJob(unit('a', 'RS01'), blk, 'R', c, truck, [blk]);
    const [bx, bz] = aroundBlock(blk, 0, 0);
    const halfL = (blk.slots * PITCH.teu) / 2;
    for (const s of plan.steps) {
      if (s.kind !== 'drive') continue;
      for (const p of s.pts) {
        const inside = Math.abs(p.x - bx) < halfL && Math.abs(p.z - bz) < width / 2;
        expect(inside).toBe(false);
      }
    }
  });
});
