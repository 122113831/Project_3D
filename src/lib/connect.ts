import { ROAD, ROAD_ARMS, type RoadKind } from './constants';
import type { LayoutBlock, LayoutRoad } from './layout';
import { snapTile } from './roadSnap';
import { roadHitsBlock } from './validate';

/**
 * Sambung jalan otomatis: dua titik diklik, ubin dirangkai di antaranya.
 *
 * Jalurnya dicari di kisi ubin global (pusat petak di (k + ½)·24 m — kisi yang
 * sama dengan tempat ubin biasa dijepret) dengan A*: tiap langkah satu petak,
 * belok diberi biaya tambahan supaya jalurnya lurus dan rapi, petak yang
 * aspalnya akan menimpa blok tidak boleh dilewati, dan petak yang sudah berisi
 * jalan murah dilewati — jalan baru lebih suka bergabung ke jalan lama daripada
 * membuat jalur sejajar.
 *
 * Bentuk tiap ubin diturunkan dari tetangganya di jalur: dua arah berlawanan
 * jadi lurus, dua arah bersebelahan jadi belokan, tiga jadi pertigaan, empat
 * perempatan. Ubin lama yang dilalui DITINGKATKAN (lurus → pertigaan, dst.),
 * bukan ditimpa — lengan lamanya tetap ada.
 *
 * Murni, tanpa React: diuji di tests/connect.test.ts.
 */

type Arm = 'E' | 'W' | 'N' | 'S';
const DIRS: Record<Arm, [number, number]> = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
const OPP: Record<Arm, Arm> = { E: 'W', W: 'E', N: 'S', S: 'N' };
/** Rotasi 90° searah ry positif: E→N→W→S→E (konvensi toWorld di roadGraph). */
const ROT: Record<Arm, Arm> = { E: 'N', N: 'W', W: 'S', S: 'E' };

const rotateArms = (arms: readonly Arm[], quarter: number) =>
  arms.map((a) => {
    let r = a;
    for (let i = 0; i < quarter; i++) r = ROT[r];
    return r;
  });

/** Lengan sebuah ubin lama di arah dunia (kelipatan 90° saja). */
function armsOf(r: LayoutRoad): Arm[] {
  const q = ((Math.round(r.ry / (Math.PI / 2)) % 4) + 4) % 4;
  return rotateArms(ROAD_ARMS[r.kind] as Arm[], q);
}

/** Bentuk dan sudut untuk sekumpulan lengan dunia. */
export function shapeFor(arms: Set<Arm>): { kind: RoadKind; ry: number } {
  if (arms.size <= 1) {
    const a = [...arms][0] ?? 'E';
    return { kind: 'straight', ry: a === 'N' || a === 'S' ? Math.PI / 2 : 0 };
  }
  const kinds: RoadKind[] = ['straight', 'corner', 'tee', 'cross'];
  for (const kind of kinds) {
    if (ROAD_ARMS[kind].length !== arms.size) continue;
    for (let q = 0; q < 4; q++) {
      const got = rotateArms(ROAD_ARMS[kind] as Arm[], q);
      if (got.every((a) => arms.has(a))) return { kind, ry: (q * Math.PI) / 2 };
    }
  }
  // Dua lengan berlawanan sudah tertangkap 'straight'; sisanya tidak mungkin.
  return { kind: 'cross', ry: 0 };
}

const key = (i: number, j: number) => `${i},${j}`;
const T = ROAD.tile;
/** Indeks petak untuk koordinat dunia, di kisi snapTile. */
const cellOf = (v: number) => Math.round(snapTile(v) / T - 0.5);
const centre = (i: number) => (i + 0.5) * T;

export type ConnectResult =
  | { ok: true; roads: LayoutRoad[]; added: number; changed: number; cells: number }
  | { ok: false; reason: string };

export function connectRoads(
  blocks: readonly LayoutBlock[],
  roads: readonly LayoutRoad[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  makeId: () => string,
  maxCells = 6000,
): ConnectResult {
  // Ubin lama yang duduk TEPAT di kisi (pusat di tengah petak, sudut kelipatan
  // 90°) bisa ditingkatkan; ubin di luar kisi (penutup celah, jalan di garis
  // lorong) dihormati sebagai penghalang lunak — tidak dilewati.
  const onGrid = new Map<string, LayoutRoad>();
  const offGrid: LayoutRoad[] = [];
  for (const r of roads) {
    const i = cellOf(r.x);
    const j = cellOf(r.z);
    const aligned = Math.abs(centre(i) - r.x) < 0.5 && Math.abs(centre(j) - r.z) < 0.5;
    const square = Math.abs(Math.round(r.ry / (Math.PI / 2)) * (Math.PI / 2) - r.ry) < 0.01;
    if (aligned && square && !(r.kind === 'straight' && r.len)) onGrid.set(key(i, j), r);
    else offGrid.push(r);
  }

  const blockedCache = new Map<string, boolean>();
  const blocked = (i: number, j: number) => {
    const k = key(i, j);
    let v = blockedCache.get(k);
    if (v === undefined) {
      // Diuji sebagai perempatan — bentuk terluas — supaya ubin apa pun yang
      // akhirnya ditaruh di petak itu tidak menimpa blok.
      const probe: LayoutRoad = { id: '_', kind: 'cross', x: centre(i), z: centre(j), ry: 0 };
      v =
        !onGrid.has(k) &&
        (roadHitsBlock(probe, blocks) !== null ||
          offGrid.some((r) => Math.abs(r.x - centre(i)) < T * 0.6 && Math.abs(r.z - centre(j)) < T * 0.6));
      blockedCache.set(k, v);
    }
    return v;
  };

  const si = cellOf(from.x);
  const sj = cellOf(from.z);
  const ei = cellOf(to.x);
  const ej = cellOf(to.z);
  if (si === ei && sj === ej) return { ok: false, reason: 'Start and end points are in the same cell.' };
  if (blocked(si, sj)) return { ok: false, reason: 'Start point is inside a block — click on empty asphalt or on a road.' };
  if (blocked(ei, ej)) return { ok: false, reason: 'End point is inside a block — click on empty asphalt or on a road.' };

  // --- A* ------------------------------------------------------------------
  type Node = { i: number; j: number; g: number; f: number; dir: Arm | null; prev: string | null };
  const open = new Map<string, Node>();
  const closed = new Map<string, Node>();
  const h = (i: number, j: number) => Math.abs(i - ei) + Math.abs(j - ej);
  open.set(key(si, sj), { i: si, j: sj, g: 0, f: h(si, sj), dir: null, prev: null });
  let found: Node | null = null;
  while (open.size) {
    let cur: Node | null = null;
    for (const n of open.values()) if (!cur || n.f < cur.f) cur = n;
    const ck = key(cur!.i, cur!.j);
    open.delete(ck);
    closed.set(ck, cur!);
    if (cur!.i === ei && cur!.j === ej) {
      found = cur!;
      break;
    }
    if (closed.size > maxCells) break;
    for (const arm of Object.keys(DIRS) as Arm[]) {
      const [di, dj] = DIRS[arm];
      const ni = cur!.i + di;
      const nj = cur!.j + dj;
      const nk = key(ni, nj);
      if (closed.has(nk) || blocked(ni, nj)) continue;
      // Biaya: satu petak; petak berisi jalan lebih murah; belok lebih mahal.
      const step = onGrid.has(nk) ? 0.35 : 1;
      const turn = cur!.dir && cur!.dir !== arm ? 0.6 : 0;
      const g = cur!.g + step + turn;
      const prevBest = open.get(nk);
      if (prevBest && prevBest.g <= g) continue;
      open.set(nk, { i: ni, j: nj, g, f: g + h(ni, nj), dir: arm, prev: ck });
    }
  }
  if (!found) return { ok: false, reason: 'No route between the two points that avoids every block.' };

  // --- jalur → lengan tiap petak --------------------------------------------
  const path: Node[] = [];
  for (let n: Node | undefined = found; n; n = n.prev ? closed.get(n.prev) : undefined) path.unshift(n);
  const arms = new Map<string, Set<Arm>>();
  const add = (i: number, j: number, a: Arm) => {
    const k = key(i, j);
    let s = arms.get(k);
    if (!s) arms.set(k, (s = new Set()));
    s.add(a);
  };
  for (let n = 1; n < path.length; n++) {
    const a = path[n - 1];
    const b = path[n];
    const dir = b.dir!;
    add(a.i, a.j, dir);
    add(b.i, b.j, OPP[dir]);
  }
  // Ujung jalur yang bukan jalan lama diteruskan lurus — ubin buntu tetap ubin
  // lurus yang mengarah ke titik yang diklik, siap disambung berikutnya.
  for (const n of [path[0], path[path.length - 1]]) {
    const k = key(n.i, n.j);
    const s = arms.get(k)!;
    if (!onGrid.has(k) && s.size === 1) s.add(OPP[[...s][0]]);
  }

  const out = roads.map((r) => r);
  const index = new Map(out.map((r, n) => [r.id, n]));
  let added = 0;
  let changed = 0;
  for (const [k, s] of arms) {
    const [i, j] = k.split(',').map(Number);
    const old = onGrid.get(k);
    if (old) {
      const merged = new Set<Arm>([...armsOf(old), ...s]);
      const shape = shapeFor(merged);
      if (shape.kind !== old.kind || Math.abs(shape.ry - old.ry) > 0.01) {
        out[index.get(old.id)!] = { ...old, kind: shape.kind, ry: shape.ry };
        changed++;
      }
      continue;
    }
    const shape = shapeFor(s);
    out.push({ id: makeId(), kind: shape.kind, x: centre(i), z: centre(j), ry: shape.ry });
    added++;
  }
  return { ok: true, roads: out, added, changed, cells: path.length };
}
