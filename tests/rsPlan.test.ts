import { describe, expect, it } from 'vitest';
import { RS } from '../src/lib/reachStacker';
import {
  headingOf,
  nearSide,
  pickRsMove,
  planRsFor,
  planRsJob,
  RS_BOOM,
  RS_WORK_DIST,
  rsReach,
  rsSpreaderBottom,
  rsUnits,
} from '../src/lib/rsPlan';
import type { YardBlock, YardContainer } from '../src/lib/types';

const ctr = (bay: number, row: number, tier: number, no = `TEST${bay}${row}${tier}`): YardContainer =>
  ({ no, size: 20, bay, row, tier }) as YardContainer;

const block = (containers: YardContainer[], over: Partial<YardBlock> = {}): YardBlock =>
  ({
    id: 'B',
    originX: 0,
    originZ: 60,
    slots: 20,
    slotStep: 2,
    rows: 6,
    tiers: 5,
    rot: 0,
    truckLane: 'B',
    slotStart: 'L',
    containers,
    ...over,
  }) as YardBlock;

describe('rsPlan: boom', () => {
  it('memakai geometri boom yang sama dengan model RS', () => {
    expect(RS_BOOM.pivot).toEqual(RS.pivot);
    expect(RS_BOOM.reach).toBeCloseTo(RS.innerStart + RS.pinAlong);
    expect(RS_BOOM.pinDrop).toBe(RS.pinDrop);
    expect(RS_BOOM.hang).toBe(RS.hang);
  });

  it('rsReach menaruh alas spreader tepat di sasaran untuk tier 1–4', () => {
    for (let tier = 1; tier <= 4; tier++) {
      const y = (tier - 1) * 2.62 + 2.59;
      const p = rsReach(RS_WORK_DIST, y);
      expect(p.ext).toBeGreaterThanOrEqual(0);
      expect(p.ext).toBeLessThanOrEqual(RS_BOOM.maxExt);
      const b = rsSpreaderBottom(p);
      expect(b.dx).toBeCloseTo(RS_WORK_DIST, 1);
      expect(b.y).toBeCloseTo(y, 1);
    }
  });
});

describe('rsPlan: pilihan relokasi', () => {
  it('hanya baris tepi, kontainer teratas, tujuan ≥ 3 bay, tier ≤ 4', () => {
    const b = block([ctr(2, 0, 1), ctr(2, 0, 2, 'TOP'), ctr(3, 1, 1, 'DALAM'), ctr(9, 0, 1), ctr(9, 0, 2), ctr(9, 0, 3), ctr(9, 0, 4)]);
    const m = pickRsMove(b, 1, () => 0)!;
    expect(m.c.no).toBe('TOP'); // tier 2 di bay 2; tumpukan bay 9 sudah tier 4
    expect(m.to.row).toBe(0);
    expect(Math.abs(m.to.bay - m.c.bay)).toBeGreaterThanOrEqual(3);
    expect(m.to.tier).toBeLessThanOrEqual(4);
  });

  it('sisi jauh memakai row terakhir', () => {
    const b = block([ctr(4, 5, 1, 'JAUH')]);
    expect(pickRsMove(b, -1, () => 0)?.c.no).toBe('JAUH');
    expect(pickRsMove(b, 1, () => 0)).toBeNull();
  });

  it('nearSide memilih sisi row 0 untuk titik di utara blok', () => {
    const b = block([]);
    expect(nearSide(b, { x: 50, z: 20 })).toBe(1);
    expect(nearSide(b, { x: 50, z: 120 })).toBe(-1);
  });
});

describe('rsPlan: rencana lengkap', () => {
  const b = block([ctr(4, 0, 1, 'SRC')]);
  const unit = { key: 'p:1', code: 'RS01', x: -40, z: 40, ry: 0 };
  const plan = planRsJob(unit, b, 1, { c: b.containers[0], to: ctr(9, 0, 1, 'SRC') }, [b]);

  it('mulai dan berakhir di lajur parkir, mengangkat sekali dan melepas sekali', () => {
    const drives = plan.steps.filter((s) => s.kind === 'drive');
    expect(drives[0].pts[0]).toEqual({ x: -40, z: 40 });
    expect(drives.at(-1)!.pts.at(-1)).toEqual({ x: -40, z: 40 });
    expect(drives.at(-1)!.reverse).toBe(true); // masuk lajur dengan mundur
    const events = plan.steps.flatMap((s) => (s.kind === 'boom' && s.event ? [s.event] : []));
    expect(events).toEqual(['grab', 'release']);
  });

  it('di titik kerja RS menghadap ke dalam blok, sejauh jarak kerja dari tumpukan', () => {
    // Langkah pendekatan = langkah jalan tepat sebelum boom pertama bergerak.
    const firstBoom = plan.steps.findIndex((st) => st.kind === 'boom');
    const approach = plan.steps[firstBoom - 1];
    if (approach.kind !== 'drive') throw new Error('sebelum boom harus jalan');
    const a1 = approach.pts.at(-1)!;
    const prev = approach.pts.at(-2)!;
    expect(headingOf({ x: a1.x - prev.x, z: a1.z - prev.z })).toBeCloseTo(-Math.PI / 2); // +Z = ke blok
    // Tengah tumpukan bay 4 row 0: z = 60 + 1,45.
    expect(61.45 - a1.z).toBeCloseTo(RS_WORK_DIST);
  });

  it('arah moncong tidak berbalik di sambungan antarlangkah jalan', () => {
    const drives = plan.steps.filter((s) => s.kind === 'drive');
    const dirAt = (d: (typeof drives)[number], end: boolean) => {
      const [p, q] = end ? [d.pts.at(-2)!, d.pts.at(-1)!] : [d.pts[0], d.pts[1]];
      const h = headingOf({ x: q.x - p.x, z: q.z - p.z });
      return d.reverse ? h + Math.PI : h;
    };
    for (let i = 1; i < drives.length; i++) {
      const a = dirAt(drives[i - 1], true);
      const c = dirAt(drives[i], false);
      const diff = Math.abs(Math.atan2(Math.sin(c - a), Math.cos(c - a)));
      expect(diff).toBeLessThan((100 * Math.PI) / 180);
    }
  });
});

describe('rsPlan: unit RS dari tata letak', () => {
  it('RS yang ditaruh sendiri, kode isian atau urut RS01…', () => {
    const units = rsUnits([
      { id: 'rs-a', kind: 'reachStacker', x: 1, z: 2, ry: 0, code: 'RS09' },
      { id: 'pk', kind: 'parking', x: 0, z: 0, ry: 0, parking: { bays: 3 } },
      { id: 'rs-b', kind: 'reachStacker', x: 5, z: 6, ry: 1 },
    ]);
    expect(units.map((u) => [u.key, u.code])).toEqual([
      ['rs-a', 'RS09'],
      ['rs-b', 'RS02'],
    ]);
  });
});

describe('rsPlan: keluar/masuk lajur maju atau mundur menurut letak tujuan', () => {
  // Blok di z 60–77,4; RS diparkir di z = 30, x = 25 (sejajar bay 4).
  const b = block([ctr(4, 0, 1, 'SRC')]);
  const move = { c: b.containers[0], to: ctr(9, 0, 1, 'SRC') };
  const drives = (ry: number) =>
    planRsJob({ key: 'rs', code: 'RS01', x: 25, z: 30, ry }, b, 1, move, [b]).steps.filter((s) => s.kind === 'drive');
  /** Arah moncong di ujung sebuah langkah jalan (dibalik saat mundur). */
  const endHeading = (d: ReturnType<typeof drives>[number]) => {
    const [p, q] = [d.pts.at(-2)!, d.pts.at(-1)!];
    const h = headingOf({ x: q.x - p.x, z: q.z - p.z });
    return d.reverse ? h + Math.PI : h;
  };
  const angDiff = (a: number, c: number) => Math.abs(Math.atan2(Math.sin(c - a), Math.cos(c - a)));

  it('moncong menghadap jalan ke blok → keluar MAJU, pulang masuk lajur MUNDUR', () => {
    const d = drives(-Math.PI / 2); // moncong ke +Z, ke arah blok
    expect(d[0].reverse).toBe(false);
    expect(d.at(-1)!.reverse).toBe(true);
  });

  it('buritan menghadap jalan ke blok → keluar MUNDUR, pulang masuk lajur MAJU', () => {
    const d = drives(Math.PI / 2); // moncong ke −Z, blok di belakang
    expect(d[0].reverse).toBe(true);
    expect(d.at(-1)!.reverse).toBe(false);
  });

  it('kedua kasus berakhir tepat di lajur dengan arah moncong semula', () => {
    for (const ry of [-Math.PI / 2, Math.PI / 2]) {
      const last = drives(ry).at(-1)!;
      expect(last.pts.at(-1)).toEqual({ x: 25, z: 30 });
      expect(angDiff(endHeading(last), ry)).toBeLessThan(0.05);
    }
  });

  it('keluar mundur: moncong sudah menghadap sepanjang lorong sebelum mulai maju', () => {
    const d = drives(Math.PI / 2);
    // Lorong di belakang RS sejajar sumbu X (tegak lurus moncong ±Z).
    const h = endHeading(d[0]);
    expect(Math.min(angDiff(h, 0), angDiff(h, Math.PI))).toBeLessThan((35 * Math.PI) / 180);
  });

  it('arah moncong tidak berbalik di sambungan antarlangkah, di kedua kasus', () => {
    for (const ry of [-Math.PI / 2, Math.PI / 2]) {
      const d = drives(ry);
      for (let i = 1; i < d.length; i++) {
        const a = endHeading(d[i - 1]);
        const [p, q] = [d[i].pts[0], d[i].pts[1]];
        let c = headingOf({ x: q.x - p.x, z: q.z - p.z });
        if (d[i].reverse) c += Math.PI;
        expect(angDiff(a, c)).toBeLessThan((100 * Math.PI) / 180);
      }
    }
  });
});

describe('rsPlan: RS lewat dalam lapangan, bukan jalan keliling (bug parkir di luar cincin jalan)', () => {
  // Meniru blok D tata letak DEPOT: blok z 160,5–177,9, jalan keliling z = 193
  // (lebar 14 m → 186–200) hanya 8 m dari tepi selatan; lorong lebar di utara
  // sampai blok C (tepi z 129,9). Parkir RS di tenggara, di luar jalan x = 156.
  const D = block([ctr(1, 0, 1, 'UTARA'), ctr(1, 5, 1, 'SELATAN')], { id: 'D', originX: -4.5, originZ: 160.5, slots: 24, rows: 6 });
  const C = block([], { id: 'C', originX: -7.5, originZ: 115.4, slots: 16, rows: 5 });
  const roads = [
    ...[3, 27, 51, 75, 99, 123, 139].map((x, i) => ({ id: `s${i}`, kind: 'straight' as const, x, z: 193, ry: 0 })),
    { id: 'v1', kind: 'straight' as const, x: 156, z: 169, ry: -Math.PI / 2 },
    { id: 'k1', kind: 'tee' as const, x: 156, z: 193, ry: 0 },
  ];
  const unit = { key: 'rs', code: 'RS01', x: 174.5, z: 180, ry: 0 };
  const onRoad = (p: { x: number; z: number }) =>
    p.z > 186 && p.z < 200 && p.x < 149; // pita jalan z = 193 di sepanjang blok

  it('memilih sisi blok yang menghadap lorong dalam (utara), bukan sisi jalan keliling', () => {
    const plan = planRsFor(unit, D, [C, D], roads, () => 0)!;
    expect(plan).not.toBeNull();
    expect(plan.container.row).toBe(0); // row 0 = sisi utara
  });

  it('tidak ada titik lintasan yang menyusuri jalan keliling di sepanjang blok', () => {
    const plan = planRsFor(unit, D, [C, D], roads, () => 0)!;
    const pts = plan.steps.flatMap((s) => (s.kind === 'drive' ? s.pts : []));
    expect(pts.filter(onRoad)).toEqual([]);
  });

  it('garis antre di lorong tidak menabrak blok tetangga', () => {
    const plan = planRsFor(unit, D, [C, D], roads, () => 0)!;
    const pts = plan.steps.flatMap((s) => (s.kind === 'drive' ? s.pts : []));
    // Blok C: z 115,4–129,9, x −7,5–94,9.
    expect(pts.filter((p) => p.x > -7.5 && p.x < 94.9 && p.z > 115.4 && p.z < 129.9)).toEqual([]);
  });
});
