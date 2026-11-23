import { PITCH, ROAD, ROAD_ARMS } from './constants';
import {
  blockSize,
  equipmentFootprint,
  type LayoutBlock,
  type LayoutEquipment,
  type LayoutRoad,
} from './layout';
import { roadLen } from './roadSnap';
import { RTG_KINDS, rtgCoversLane } from './equipment';

/**
 * Pemeriksaan tata letak: hal-hal yang membuat lapangan tidak bisa dipakai
 * truk atau tidak masuk akal secara fisik, dikumpulkan jadi daftar yang bisa
 * diklik.
 *
 * Murni geometri dan daftar — tanpa React, tanpa three — supaya tiap aturan
 * bisa diuji dengan angka. Bagian yang butuh graf jalan (blok tak terjangkau,
 * gate tak tersambung) datang dari diagnosis yang sudah dihitung Traffic.
 */

export type Obb = { cx: number; cz: number; sx: number; sz: number; ry: number };

export type Issue = {
  id: string;
  level: 'error' | 'warn';
  text: string;
  /** Titik untuk diterbangi kamera dan lebar daerah yang perlu terlihat. */
  x: number;
  z: number;
  span: number;
  /** Objek yang dipilih di editor saat baris ini diklik, supaya sorotannya terlihat. */
  target?: { type: 'block' | 'road' | 'equipment'; id: string };
};

export type GraphDiag = {
  gatesIn: number;
  gatesOut: number;
  unreachable: string[];
  gatesUnlinked: string[];
};

/** Kotak blok: pusatnya, karena blok berputar terhadap pusat (lihat aroundBlock). */
export function blockObb(b: LayoutBlock): Obb {
  const { length, width } = blockSize(b);
  return { cx: b.originX + length / 2, cz: b.originZ + width / 2, sx: length, sz: width, ry: b.rot ?? 0 };
}

/** Kotak UBIN jalan — sisi penuh; untuk klik dan pratinjau, bukan tabrakan. */
export const roadObb = (r: LayoutRoad): Obb => ({ cx: r.x, cz: r.z, sx: roadLen(r), sz: ROAD.tile, ry: r.ry });

/**
 * BADAN jalan sebuah ubin: aspal selebar ROAD.width di tiap lengannya, bukan
 * seluruh petak 24 x 24 m. Ubin yang berdiri 8 m dari tepi blok — jarak lazim
 * jalan di ujung blok — petaknya memang menyentuh blok, tapi aspalnya tidak;
 * menguji tabrakan dengan petak penuh melaporkan tabrakan yang tidak ada.
 */
export function roadBodyObbs(r: LayoutRoad): Obb[] {
  const c = Math.cos(r.ry);
  const s = Math.sin(r.ry);
  const at = (dx: number, dz: number) => ({ cx: r.x + dx * c + dz * s, cz: r.z - dx * s + dz * c });
  const w = ROAD.width;
  if (r.kind === 'straight') return [{ ...at(0, 0), sx: roadLen(r), sz: w, ry: r.ry }];
  const half = ROAD.tile / 2;
  const out: Obb[] = [{ ...at(0, 0), sx: w, sz: w, ry: r.ry }];
  for (const arm of ROAD_ARMS[r.kind]) {
    // Lengan: dari pusat ke tepi ubin, selebar aspal.
    const [ax, az] = arm === 'E' ? [1, 0] : arm === 'W' ? [-1, 0] : arm === 'N' ? [0, -1] : [0, 1];
    out.push({
      ...at((ax * half) / 2, (az * half) / 2),
      sx: ax !== 0 ? half : w,
      sz: az !== 0 ? half : w,
      ry: r.ry,
    });
  }
  return out;
}

/** Ubin jalan menimpa salah satu blok? Diuji dengan badan jalannya. */
export function roadHitsBlock(r: LayoutRoad, blocks: readonly LayoutBlock[]): LayoutBlock | null {
  const bodies = roadBodyObbs(r);
  for (const b of blocks) {
    const bo = blockObb(b);
    if (bodies.some((o) => obbIntersects(o, bo))) return b;
  }
  return null;
}

/**
 * Mendorong ubin keluar dari blok yang ditimpanya: dicoba keempat arah sumbu
 * blok, diambil geseran terpendek yang membebaskannya dari SEMUA blok. Hasil
 * null berarti tidak ada geseran sampai satu ubin yang menolong — ubinnya
 * memang di tengah blok.
 */
export function pushRoadClear(
  r: LayoutRoad,
  blocks: readonly LayoutBlock[],
): { x: number; z: number } | null {
  const hit = roadHitsBlock(r, blocks);
  if (!hit) return { x: r.x, z: r.z };
  const bo = blockObb(hit);
  const c = Math.cos(bo.ry);
  const s = Math.sin(bo.ry);
  const dirs = [
    [c, -s],
    [-c, s],
    [s, c],
    [-s, -c],
  ];
  let best: { x: number; z: number; d: number } | null = null;
  for (const [ux, uz] of dirs) {
    // Maju 0,5 m sekali langkah sampai bebas, paling jauh satu ubin.
    for (let d = 0.5; d <= ROAD.tile; d += 0.5) {
      const cand = { ...r, x: r.x + ux * d, z: r.z + uz * d };
      if (!roadHitsBlock(cand, blocks)) {
        if (!best || d < best.d) best = { x: cand.x, z: cand.z, d };
        break;
      }
    }
  }
  return best ? { x: Math.round(best.x * 100) / 100, z: Math.round(best.z * 100) / 100 } : null;
}

export function equipObb(e: LayoutEquipment): Obb {
  const f = equipmentFootprint(e);
  return { cx: e.x, cz: e.z, sx: f.x, sz: f.z, ry: e.ry };
}

/** Keempat sudut kotak di dunia, dengan konvensi rotasi yang sama dengan aroundBlock. */
function corners(o: Obb, shrink: number): [number, number][] {
  const c = Math.cos(o.ry);
  const s = Math.sin(o.ry);
  const hx = Math.max(0, o.sx / 2 - shrink);
  const hz = Math.max(0, o.sz / 2 - shrink);
  const out: [number, number][] = [];
  for (const [ax, az] of [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ]) {
    out.push([o.cx + ax * c + az * s, o.cz - ax * s + az * c]);
  }
  return out;
}

/**
 * Dua kotak berputar saling menimpa? Uji sumbu pemisah (SAT) dengan empat
 * sumbu — dua dari tiap kotak. `shrink` mengecilkan keduanya sedikit supaya
 * kotak yang cuma bersentuhan di tepi tidak dihitung menimpa.
 */
export function obbIntersects(a: Obb, b: Obb, shrink = 0.25): boolean {
  const pa = corners(a, shrink);
  const pb = corners(b, shrink);
  if (pa.every(([x]) => x === pa[0][0]) && pa.every(([, z]) => z === pa[0][1])) return false;
  const axes: [number, number][] = [];
  for (const o of [a, b]) {
    axes.push([Math.cos(o.ry), -Math.sin(o.ry)], [Math.sin(o.ry), Math.cos(o.ry)]);
  }
  for (const [ux, uz] of axes) {
    let aMin = Infinity;
    let aMax = -Infinity;
    let bMin = Infinity;
    let bMax = -Infinity;
    for (const [x, z] of pa) {
      const p = x * ux + z * uz;
      aMin = Math.min(aMin, p);
      aMax = Math.max(aMax, p);
    }
    for (const [x, z] of pb) {
      const p = x * ux + z * uz;
      bMin = Math.min(bMin, p);
      bMax = Math.max(bMax, p);
    }
    if (aMax < bMin || bMax < aMin) return false;
  }
  return true;
}

const GATE_KINDS = new Set(['gate', 'gateIn', 'gateOut']);
/** RTG memang berdiri mengangkangi blok; itu bukan tabrakan. */
const STRADDLES = new Set(['rtg', 'rtgAsset', 'rtgDetail', 'rtgDetail2']);

export function validateLayout(input: {
  blocks: readonly LayoutBlock[];
  roads: readonly LayoutRoad[];
  equipment: readonly LayoutEquipment[];
  diag: GraphDiag | null;
}): Issue[] {
  const { blocks, roads, equipment, diag } = input;
  const out: Issue[] = [];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const bObb = new Map(blocks.map((b) => [b.id, blockObb(b)]));

  // Blok bertindihan.
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = bObb.get(blocks[i].id)!;
      const b = bObb.get(blocks[j].id)!;
      if (obbIntersects(a, b)) {
        out.push({
          id: `overlap:${blocks[i].id}:${blocks[j].id}`,
          level: 'error',
          text: `Blok ${blocks[i].id} dan ${blocks[j].id} bertindihan`,
          x: (a.cx + b.cx) / 2,
          z: (a.cz + b.cz) / 2,
          span: Math.max(a.sx, b.sx) * 1.2,
          target: { type: 'block', id: blocks[j].id },
        });
      }
    }
  }

  // Jalan tertimpa blok — diuji dengan BADAN jalannya, bukan petak ubinnya.
  for (const r of roads) {
    const bodies = roadBodyObbs(r);
    for (const b of blocks) {
      const bo = bObb.get(b.id)!;
      if (bodies.some((o) => obbIntersects(o, bo))) {
        out.push({
          id: `road-in-block:${r.id}`,
          level: 'error',
          text: `Ubin jalan tertimpa blok ${b.id}`,
          x: r.x,
          z: r.z,
          span: ROAD.tile * 3,
          target: { type: 'road', id: r.id },
        });
        break;
      }
    }
  }

  // Alat di dalam blok (selain RTG).
  for (const e of equipment) {
    if (STRADDLES.has(e.kind)) continue;
    const eo = equipObb(e);
    for (const b of blocks) {
      if (obbIntersects(eo, bObb.get(b.id)!)) {
        out.push({
          id: `equip-in-block:${e.id}`,
          level: 'warn',
          text: `${e.kind === 'lamp' ? 'Tiang lampu' : e.kind === 'warehouse' ? 'Gudang' : e.kind === 'parking' ? 'Parkir alat' : GATE_KINDS.has(e.kind) ? 'Gate' : 'Alat'} berdiri di dalam blok ${b.id}`,
          x: e.x,
          z: e.z,
          span: 40,
          target: { type: 'equipment', id: e.id },
        });
        break;
      }
    }
  }

  // RTG harus menaungi lajur truk bloknya: kalau tidak, truk yang berhenti
  // di lajur layanan berdiri di jalur kaki/roda portal dan tertabrak saat RTG
  // berjalan ke bay.
  for (const e of equipment) {
    if (!RTG_KINDS.has(e.kind)) continue;
    let near: LayoutBlock | null = null;
    let best = Infinity;
    for (const b of blocks) {
      const d = Math.abs(b.originZ + (b.rows * PITCH.row) / 2 - e.z);
      if (d < best) {
        best = d;
        near = b;
      }
    }
    if (!near || Math.abs(near.rot ?? 0) > 1e-3 || rtgCoversLane(near, e.z)) continue;
    out.push({
      id: `rtg-lane:${e.id}`,
      level: 'warn',
      text: `RTG blok ${near.id} tidak menaungi lajur truk — truk bisa tertabrak. Geser RTG (akan dijepret otomatis)`,
      x: e.x,
      z: e.z,
      span: 40,
      target: { type: 'equipment', id: e.id },
    });
  }

  // Gate dan keterjangkauan — dari graf jalan.
  const gates = equipment.filter((e) => GATE_KINDS.has(e.kind));
  if (blocks.length > 0) {
    const centre = blocks.reduce(
      (acc, b) => {
        const o = bObb.get(b.id)!;
        return { x: acc.x + o.cx / blocks.length, z: acc.z + o.cz / blocks.length };
      },
      { x: 0, z: 0 },
    );
    const span = Math.max(...blocks.map((b) => bObb.get(b.id)!.sx)) * 2;
    if (!gates.some((g) => g.kind !== 'gateOut')) {
      out.push({ id: 'no-gate-in', level: 'error', text: 'Belum ada gate masuk', ...centre, span });
    }
    if (!gates.some((g) => g.kind !== 'gateIn')) {
      out.push({ id: 'no-gate-out', level: 'error', text: 'Belum ada gate keluar', ...centre, span });
    }
  }
  if (diag) {
    for (const id of diag.gatesUnlinked) {
      const g = equipment.find((e) => e.id === id);
      if (g) {
        out.push({
          id: `gate-unlinked:${id}`,
          level: 'error',
          text: 'Gate tidak menempel pada jalan',
          x: g.x,
          z: g.z,
          span: ROAD.tile * 3,
          target: { type: 'equipment', id: g.id },
        });
      }
    }
    if (diag.gatesIn > 0) {
      for (const id of diag.unreachable) {
        const b = byId.get(id);
        const o = b ? bObb.get(id) : null;
        if (o) {
          out.push({
            id: `unreachable:${id}`,
            level: 'error',
            text: `Blok ${id} tidak tersambung jalan ke gate`,
            x: o.cx,
            z: o.cz,
            span: o.sx * 1.5,
            target: { type: 'block', id },
          });
        }
      }
    }
  }

  const rank = { error: 0, warn: 1 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.text.localeCompare(b.text));
}
