import { PITCH, ROAD } from './constants';
import { blockSize, newId, type LayoutRoad, type YardLayout } from './layout';
import { MIN_LEN, roadLen } from './roadSnap';

/**
 * Menggeser yang terdampak saat sebuah blok membesar.
 *
 * Blok tumbuh dari sudut asalnya: menambah slot memanjangkan blok ke arah +X
 * lokal, menambah row melebarkannya ke arah +Z lokal. Apa pun yang tadinya
 * berdiri di sisi itu — jalan di ujung blok, alat, blok tetangga — kini
 * tertimpa, dan yang di belakangnya pun harus memberi tempat.
 *
 * Aturannya satu dan bisa ditebak: SEMUA objek yang pusatnya berada di luar
 * tepi lama blok pada arah pertumbuhan digeser sejauh pertumbuhannya. Yang
 * bergeser tetap saling tersambung seperti sebelumnya karena bergesernya
 * bersama-sama; satu-satunya yang terputus adalah jalan sejajar arah
 * pertumbuhan yang melintasi tepi lama — celah selebar pertumbuhan itu ditutup
 * dengan ubin lurus tambahan (panjangnya mengikuti celah, lihat roadSnap).
 *
 * Yang TIDAK dilakukan: menggeser diam-diam saat angka slot/row diubah.
 * Pergeseran mengubah posisi blok lain — yang tersimpan ke database — jadi ia
 * ditawarkan sebagai satu tombol dengan hitungan di labelnya, bukan efek
 * samping dari mengetik angka.
 */

export type ShiftPlan = {
  blockId: string;
  axis: 'x' | 'z';
  /** Jarak geser, meter. */
  delta: number;
  /** Arah geser di dunia, satuan. */
  dir: { x: number; z: number };
  roads: string[];
  equipment: string[];
  blocks: string[];
  fillers: LayoutRoad[];
};

const EPS = 0.01;

/** Kerangka lokal blok: titik asal di dunia dan rotasinya. */
function frame(layout: YardLayout, blockId: string) {
  const b = layout.blocks.find((v) => v.id === blockId);
  if (!b) return null;
  const { length, width } = blockSize(b);
  const rot = b.rot ?? 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const cx = b.originX + length / 2;
  const cz = b.originZ + width / 2;
  // Sudut asal (slot 0, row 0) setelah blok diputar terhadap pusatnya.
  const ox = cx + (-length / 2) * c + (-width / 2) * s;
  const oz = cz - (-length / 2) * s + (-width / 2) * c;
  const toLocal = (x: number, z: number) => {
    const dx = x - ox;
    const dz = z - oz;
    return { lx: dx * c - dz * s, lz: dx * s + dz * c };
  };
  const toWorld = (lx: number, lz: number) => ({ x: ox + lx * c + lz * s, z: oz - lx * s + lz * c });
  return { b, rot, c, s, toLocal, toWorld };
}

function norm(a: number) {
  const t = Math.PI;
  return ((((a + t / 2) % t) + t) % t) - t / 2;
}

function plan(layout: YardLayout, blockId: string, axis: 'x' | 'z', base: number): ShiftPlan | null {
  const f = frame(layout, blockId);
  if (!f) return null;
  const now = axis === 'x' ? f.b.slots * PITCH.teu : f.b.rows * PITCH.row;
  const delta = now - base;
  if (delta <= EPS) return null;
  const along = (lx: number, lz: number) => (axis === 'x' ? lx : lz);
  const lateral = (lx: number, lz: number) => (axis === 'x' ? lz : lx);
  const beyond = (x: number, z: number) => {
    const l = f.toLocal(x, z);
    return along(l.lx, l.lz) > base - EPS;
  };
  const dir = axis === 'x' ? { x: f.c, z: -f.s } : { x: f.s, z: f.c };
  // Sudut ubin lurus yang lengannya searah sumbu pertumbuhan.
  const parallelRy = f.rot + (axis === 'x' ? 0 : Math.PI / 2);
  const isParallelStraight = (r: LayoutRoad) => r.kind === 'straight' && Math.abs(norm(r.ry - parallelRy)) < EPS;
  const half = (r: LayoutRoad) => (isParallelStraight(r) ? roadLen(r) / 2 : ROAD.tile / 2);

  const roads = layout.roads.filter((r) => beyond(r.x, r.z));
  const stay = layout.roads.filter((r) => !beyond(r.x, r.z));
  const equipment = layout.equipment.filter((e) => beyond(e.x, e.z));
  const blocks = layout.blocks.filter((o) => {
    if (o.id === blockId) return false;
    const { length, width } = blockSize(o);
    return beyond(o.originX + length / 2, o.originZ + width / 2);
  });

  // Celah yang ditinggalkan: pasangan (tetap N, bergeser T) yang tadinya
  // bersebelahan sepanjang sumbu dan sejajar secara lateral.
  const fillers: LayoutRoad[] = [];
  for (const t of roads) {
    const lt = f.toLocal(t.x, t.z);
    const aT = along(lt.lx, lt.lz) - half(t);
    for (const n of stay) {
      const ln = f.toLocal(n.x, n.z);
      if (Math.abs(lateral(ln.lx, ln.lz) - lateral(lt.lx, lt.lz)) > 1) continue;
      if (Math.abs(along(ln.lx, ln.lz) + half(n) - aT) > 1) continue;
      const ry = isParallelStraight(t) ? t.ry : isParallelStraight(n) ? n.ry : null;
      if (ry === null) continue;
      let at = aT;
      let left = delta;
      while (left > MIN_LEN) {
        const len = Math.min(ROAD.tile, left);
        const lat = lateral(lt.lx, lt.lz);
        const w = axis === 'x' ? f.toWorld(at + len / 2, lat) : f.toWorld(lat, at + len / 2);
        fillers.push({
          id: newId('road'),
          kind: 'straight',
          x: Math.round(w.x * 100) / 100,
          z: Math.round(w.z * 100) / 100,
          ry,
          ...(len < ROAD.tile - EPS ? { len: Math.round(len * 100) / 100 } : {}),
        });
        at += len;
        left -= len;
      }
    }
  }

  return {
    blockId,
    axis,
    delta,
    dir,
    roads: roads.map((r) => r.id),
    equipment: equipment.map((e) => e.id),
    blocks: blocks.map((b) => b.id),
    fillers,
  };
}

export function applyShift(layout: YardLayout, p: ShiftPlan): YardLayout {
  const dx = p.dir.x * p.delta;
  const dz = p.dir.z * p.delta;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const roadIds = new Set(p.roads);
  const eqIds = new Set(p.equipment);
  const blkIds = new Set(p.blocks);
  return {
    ...layout,
    roads: [
      ...layout.roads.map((r) => (roadIds.has(r.id) ? { ...r, x: r2(r.x + dx), z: r2(r.z + dz) } : r)),
      ...p.fillers,
    ],
    equipment: layout.equipment.map((e) => (eqIds.has(e.id) ? { ...e, x: r2(e.x + dx), z: r2(e.z + dz) } : e)),
    blocks: layout.blocks.map((b) =>
      blkIds.has(b.id) ? { ...b, originX: r2(b.originX + dx), originZ: r2(b.originZ + dz) } : b,
    ),
  };
}

/**
 * Rencana geser untuk pertumbuhan sebuah blok dari ukuran dasarnya (ukuran di
 * database). Sumbu X dulu, lalu Z dihitung ulang di atas hasilnya.
 */
export function planGrowth(
  layout: YardLayout,
  blockId: string,
  base: { slots: number; rows: number },
): { plans: ShiftPlan[]; layout: YardLayout } {
  const plans: ShiftPlan[] = [];
  let cur = layout;
  const px = plan(cur, blockId, 'x', base.slots * PITCH.teu);
  if (px) {
    plans.push(px);
    cur = applyShift(cur, px);
  }
  const pz = plan(cur, blockId, 'z', base.rows * PITCH.row);
  if (pz) {
    plans.push(pz);
    cur = applyShift(cur, pz);
  }
  return { plans, layout: cur };
}
