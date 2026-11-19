import { LANE, PITCH, ROAD, ROAD_ARMS } from './constants';
import type { LayoutEquipment, LayoutRoad } from './layout';
import { roadLen } from './roadSnap';
import type { ContainerSize, YardBlock } from './types';
import { aroundBlock, bayOffsetX, laneSide } from './yard';

/**
 * Jaringan jalan yang bisa dilalui truk, dibangun dari TATA LETAK — bukan
 * disimpan.
 *
 * Itu yang membuatnya dinamis. Setiap kali ubin jalan, blok, atau gate
 * ditambah, digeser, atau dihapus, graf ini dibangun ulang dari awal, dan truk
 * berikutnya langsung memakai jalan yang baru. Tidak ada node yang perlu
 * digambar tangan dan tidak ada yang bisa basi.
 *
 * Sumber node-nya:
 *   - ubin jalan     : titik tengah + ujung tiap lengannya, mengikuti sudut dan
 *                      panjang dinamisnya;
 *   - jalan lorong   : rantai node sepanjang garis tengahnya, satu per posisi
 *                      slot, supaya truk bisa berbelok ke bay mana pun;
 *   - gate           : ditempelkan ke node jalan terdekat di sepanjang sumbunya.
 *
 * Node yang jaraknya di bawah MERGE digabung. Itulah satu-satunya "sambungan":
 * ubin yang menempel ke ubin lain atau ke ujung lorong menghasilkan ujung lengan
 * di titik yang sama, dan penjepret jalan sudah memastikan titik itu memang
 * bertemu — termasuk potongan pendek penutup celah.
 */

export type Pt = { x: number; z: number };

export type GateKind = 'in' | 'out' | 'both';

export type GateNode = {
  id: string;
  kind: GateKind;
  node: number;
  x: number;
  z: number;
  /** Titik di luar lapangan pada sumbu gate — truk muncul dan menghilang di sini. */
  outside: Pt;
};

export type RoadGraph = {
  nodes: Pt[];
  adj: { to: number; w: number }[][];
  /**
   * Node jalan lorong tiap blok, berurutan sepanjang blok: [ujung awal,
   * posisi 0, posisi 1, …, ujung akhir].
   */
  lanes: Map<string, number[]>;
  gates: GateNode[];
};

/** Dua node sedekat ini dianggap satu titik. */
const MERGE = 1.5;

/** Garis tengah jalan lorong, dari tepi blok. */
const ROAD_MID = (LANE.road.from + LANE.road.to) / 2;

/** Garis tengah lajur layanan — tempat truk berhenti dilayani RTG. */
const SERVICE_MID = (LANE.service.from + LANE.service.to) / 2;

/** Sejauh apa gate mencari jalan di depan dan di belakangnya. */
const GATE_REACH = ROAD.tile * 1.7;

/** Jarak titik muncul truk dari gate, di sisi luar lapangan. */
const OUTSIDE = 40;

const ARM = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] } as const;

/** Konvensi Matrix4.makeRotationY, sama dengan roadSnap dan yard.ts. */
function toWorld(dx: number, dz: number, ry: number): [number, number] {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [dx * c + dz * s, -dx * s + dz * c];
}

class Builder {
  nodes: Pt[] = [];
  adj: { to: number; w: number }[][] = [];
  private grid = new Map<string, number[]>();

  private key(ix: number, iz: number) {
    return `${ix},${iz}`;
  }

  /** Node di titik ini — yang sudah ada kalau sedekat MERGE, kalau tidak yang baru. */
  node(x: number, z: number): number {
    const ix = Math.floor(x / MERGE);
    const iz = Math.floor(z / MERGE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const i of this.grid.get(this.key(ix + dx, iz + dz)) ?? []) {
          const p = this.nodes[i];
          if (Math.hypot(p.x - x, p.z - z) < MERGE) return i;
        }
      }
    }
    const i = this.nodes.push({ x, z }) - 1;
    this.adj.push([]);
    const k = this.key(ix, iz);
    const cell = this.grid.get(k);
    if (cell) cell.push(i);
    else this.grid.set(k, [i]);
    return i;
  }

  link(a: number, b: number) {
    if (a === b) return;
    if (this.adj[a].some((e) => e.to === b)) return;
    const w = Math.hypot(this.nodes[a].x - this.nodes[b].x, this.nodes[a].z - this.nodes[b].z);
    this.adj[a].push({ to: b, w });
    this.adj[b].push({ to: a, w });
  }
}

const gateKind = (k: LayoutEquipment['kind']): GateKind | null =>
  k === 'gateIn' ? 'in' : k === 'gateOut' ? 'out' : k === 'gate' ? 'both' : null;

/**
 * Titik ada di atas BADAN aspal salah satu ubin (bukan sekadar di petaknya):
 * jalan lurus selebar ROAD.width sepanjang panjangnya; bentuk lain persegi
 * persimpangan di tengah plus lengan-lengannya.
 */
export function onRoadBody(roads: readonly LayoutRoad[], x: number, z: number): boolean {
  const hw = ROAD.width / 2 + 0.01;
  const half = ROAD.tile / 2 + 0.01;
  for (const r of roads) {
    // Balikan rotasi three (lihat toWorld): lokal = R(-ry) · (p - pusat).
    const c = Math.cos(r.ry);
    const s = Math.sin(r.ry);
    const dx = x - r.x;
    const dz = z - r.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (r.kind === 'straight') {
      if (Math.abs(lx) <= roadLen(r) / 2 + 0.01 && Math.abs(lz) <= hw) return true;
      continue;
    }
    if (Math.abs(lx) <= hw && Math.abs(lz) <= hw) return true;
    for (const arm of ROAD_ARMS[r.kind]) {
      const [ax, az] = ARM[arm];
      if (ax !== 0 && Math.sign(lx) === ax && Math.abs(lx) <= half && Math.abs(lz) <= hw) return true;
      if (az !== 0 && Math.sign(lz) === az && Math.abs(lz) <= half && Math.abs(lx) <= hw) return true;
    }
  }
  return false;
}

export function buildRoadGraph(
  blocks: readonly YardBlock[],
  roads: readonly LayoutRoad[],
  equipment: readonly LayoutEquipment[],
  centre: Pt,
): RoadGraph {
  const b = new Builder();

  // --- ubin jalan ---------------------------------------------------------
  for (const r of roads) {
    const c = b.node(r.x, r.z);
    for (const arm of ROAD_ARMS[r.kind]) {
      const [ax, az] = ARM[arm];
      // Hanya lengan searah sumbu X ubin lurus yang ikut panjang dinamisnya.
      const half = ax !== 0 ? roadLen(r) / 2 : ROAD.tile / 2;
      const [wx, wz] = toWorld(ax, az, r.ry);
      b.link(c, b.node(r.x + wx * half, r.z + wz * half));
    }
  }

  // --- jalan lorong blok --------------------------------------------------
  //
  // `lanes` tetap satu entri per blok, sepanjang garis lorongnya: [ujung awal,
  // posisi 0 … n-1, ujung akhir]. Untuk blok TANPA jalan bawaan, posisi yang
  // tidak tertutup ubin jalan bernilai -1 — truk hanya bisa berhenti di bay
  // yang memang dilalui jalan buatan pengguna.
  const roadNodesEnd = b.nodes.length;
  const lanes = new Map<string, number[]>();
  for (const blk of blocks) {
    if (blk.ownRoad === false) {
      const length = blk.slots * PITCH.teu;
      const width = blk.rows * PITCH.row;
      const off = laneSide(blk) * (width / 2 + ROAD_MID);
      const along = [
        -length / 2,
        ...Array.from({ length: blk.slots }, (_, p) => (p + 0.5) * PITCH.teu - length / 2),
        length / 2,
      ];
      const ids = along.map((dx) => {
        const [x, z] = aroundBlock(blk, dx, off);
        return onRoadBody(roads, x, z) ? b.node(x, z) : -1;
      });
      for (let i = 1; i < ids.length; i++) {
        if (ids[i - 1] >= 0 && ids[i] >= 0) b.link(ids[i - 1], ids[i]);
      }
      // Rantai lorong diikat ke simpul ubin terdekat di garis yang sama, supaya
      // tersambung ke jaringan jalan.
      for (const id of ids) {
        if (id < 0) continue;
        const p = b.nodes[id];
        let near = -1;
        let best = ROAD.tile / 2 + 1;
        for (let i = 0; i < roadNodesEnd; i++) {
          const d = Math.hypot(b.nodes[i].x - p.x, b.nodes[i].z - p.z);
          if (d > 0.01 && d < best) {
            best = d;
            near = i;
          }
        }
        if (near >= 0) b.link(id, near);
      }
      lanes.set(blk.id, ids);
      continue;
    }
    const length = blk.slots * PITCH.teu;
    const width = blk.rows * PITCH.row;
    const off = laneSide(blk) * (width / 2 + ROAD_MID);
    const along = [
      -length / 2,
      ...Array.from({ length: blk.slots }, (_, p) => (p + 0.5) * PITCH.teu - length / 2),
      length / 2,
    ];
    const ids = along.map((dx) => {
      const [x, z] = aroundBlock(blk, dx, off);
      return b.node(x, z);
    });
    for (let i = 1; i < ids.length; i++) b.link(ids[i - 1], ids[i]);
    lanes.set(blk.id, ids);
  }

  // --- gate ---------------------------------------------------------------
  //
  // Diproses TERAKHIR: gate mencari node jalan yang sudah ada di depan dan di
  // belakangnya, jadi semua jalan harus sudah terbangun.
  const roadNodes = b.nodes.length;
  const gates: GateNode[] = [];
  for (const g of equipment) {
    const kind = gateKind(g.kind);
    if (!kind) continue;
    const [ux, uz] = toWorld(1, 0, g.ry);
    const n = b.node(g.x, g.z);

    for (const dir of [1, -1]) {
      let best = -1;
      let bestT = Infinity;
      for (let i = 0; i < roadNodes; i++) {
        if (i === n) continue;
        const rx = b.nodes[i].x - g.x;
        const rz = b.nodes[i].z - g.z;
        const t = (rx * ux + rz * uz) * dir;
        const lateral = Math.abs(rx * -uz + rz * ux);
        if (t > 0.5 && t < GATE_REACH && lateral < ROAD.width / 2 && t < bestT) {
          bestT = t;
          best = i;
        }
      }
      if (best >= 0) b.link(n, best);
    }

    // Sisi luar = arah sumbu yang menjauh dari pusat lapangan.
    const a = { x: g.x + ux * OUTSIDE, z: g.z + uz * OUTSIDE };
    const c = { x: g.x - ux * OUTSIDE, z: g.z - uz * OUTSIDE };
    const far = (p: Pt) => Math.hypot(p.x - centre.x, p.z - centre.z);
    gates.push({ id: g.id, kind, node: n, x: g.x, z: g.z, outside: far(a) > far(c) ? a : c });
  }

  return { nodes: b.nodes, adj: b.adj, lanes, gates };
}

/**
 * Panjang lurus di lajur layanan sebelum titik berhenti. Lebih panjang dari
 * truk (rig 15,4 m) plus ruang tikungan, supaya truk sudah lurus SEJAJAR blok
 * saat berhenti — bukan menukik miring dari jalan lorong lalu berhenti
 * melintang dan menjulur ke rel RTG.
 */
export const STOP_APPROACH = 20;
/** Jalan lorong tempat truk mulai menepi: sejauh ini (m) sebelum bay. */
const MERGE_BACK = STOP_APPROACH + 12;
/**
 * Tengah muatan chassis berada sejauh ini DI BELAKANG titik pose truk
 * (kepala traktor di depan, lihat createChassisLoadGeometry). Titik berhenti
 * digeser maju sebesar ini supaya tengah chassis — bukan kepala truk — tepat
 * di bay, dan kontainer yang diangkat RTG ada tepat di bawah spreadernya.
 */
export const LOAD_BEHIND = 4.8;

/**
 * Satu cara masuk-keluar titik berhenti, menurut arah laju di lajur layanan
 * (dir +1 = searah sumbu panjang blok). Masuk: jalan lorong di `node` →
 * menepi ke `via` di lajur layanan → lurus ke `pt`. Keluar: lurus ke
 * `outVia` → kembali ke jalan lorong di `outNode`.
 */
export type StopEntry = { dir: 1 | -1; node: number; via: Pt | null; pt: Pt; outVia: Pt | null; outNode: number };
export type Stop = {
  /** Tengah bay di lajur layanan (= tengah chassis saat berhenti). */
  pt: Pt;
  /** Simpul jalan lorong yang dipakai untuk masuk (kompatibel lama). */
  links: number[];
  entries: StopEntry[];
};

/**
 * Titik berhenti truk untuk sebuah kontainer: di lajur layanan, di DALAM kaki
 * RTG, sejajar blok, tengah chassis tepat di bay-nya.
 *
 * Truk menepi dari jalan lorong beberapa slot sebelumnya, lalu melaju lurus
 * sepanjang lajur layanan sejauh STOP_APPROACH dan berhenti. Kedua arah laju
 * disediakan; rute memilih yang terdekat. Pada blok yang terlalu pendek untuk
 * menepi lurus, kembali ke sambungan miring lama.
 */
export function stopFor(
  g: RoadGraph,
  blk: YardBlock,
  bay: number,
  size: ContainerSize,
): Stop | null {
  const ids = g.lanes.get(blk.id);
  if (!ids) return null;
  const length = blk.slots * PITCH.teu;
  const width = blk.rows * PITCH.row;
  const centre = bayOffsetX(blk, bay, size);
  const serviceOff = laneSide(blk) * (width / 2 + SERVICE_MID);
  const lanePt = (along: number): Pt => {
    const [px, pz] = aroundBlock(blk, along - length / 2, serviceOff);
    return { x: px, z: pz };
  };
  const [x, z] = aroundBlock(blk, centre - length / 2, serviceOff);
  // ids[0] adalah ujung awal, jadi posisi slot p ada di ids[p + 1].
  const p = Math.max(0, Math.min(blk.slots - 1, Math.round(centre / PITCH.teu - 0.5)));
  // Simpul sah terdekat di kiri dan kanan bay. Pada blok dengan jalan bawaan
  // semuanya sah; pada blok tanpa jalan bawaan bagian yang tidak dilalui ubin
  // bernilai -1 dan dilewati — kalau tidak ada sama sekali, bay ini tak
  // terjangkau.
  const valid = (i: number) => i >= 0 && i < ids.length && ids[i] >= 0;
  let lo = Math.max(0, p - 1);
  while (lo >= 0 && !valid(lo)) lo--;
  let hi = Math.min(ids.length - 1, p + 3);
  while (hi < ids.length && !valid(hi)) hi++;
  // Terlalu jauh dari bay (lebih dari satu ubin) dianggap tidak dilayani.
  const reach = Math.ceil(ROAD.tile / PITCH.teu) + 3;
  const links = [lo, hi].filter((i) => valid(i) && Math.abs(i - (p + 1)) <= reach).map((i) => ids[i]);
  if (links.length === 0) return null;

  // Simpul jalan lorong (pita jalan dua arah di sisi lajur) dalam koordinat
  // blok: sepanjang sumbu panjang (0 = ujung awal) dan jarak ke sisi lajur.
  // Dicari di SELURUH graf, bukan hanya rantai lorong blok ini, supaya bay di
  // ujung blok bisa masuk/keluar lewat ubin jalan di luar ujungnya.
  const [bcx, bcz] = aroundBlock(blk, 0, 0);
  const rot = blk.rot ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const side = laneSide(blk);
  const roadLo = width / 2 + LANE.road.from - 2;
  const roadHi = width / 2 + LANE.road.to + 2;
  const roadNodes: { i: number; along: number }[] = [];
  g.nodes.forEach((n, i) => {
    const dx = n.x - bcx;
    const dz = n.z - bcz;
    // Kebalikan aroundBlock (konvensi rotasi three).
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    const lat = lz * side;
    if (lat >= roadLo && lat <= roadHi && g.adj[i]?.length) roadNodes.push({ i, along: lx + length / 2 });
  });
  // Simpul jalan di sisi `dir` dari `from` (minimal 4 m), terdekat ke `target`.
  const pickRoad = (from: number, target: number, dir: 1 | -1) => {
    let bestI = -1;
    let bestD = Infinity;
    for (const r of roadNodes) {
      if (dir * (r.along - from) < 4) continue;
      const d = Math.abs(r.along - target);
      if (d < bestD) {
        bestD = d;
        bestI = r.i;
      }
    }
    return bestI;
  };
  const entries: StopEntry[] = [];
  for (const dir of [1, -1] as const) {
    const pAlong = centre + dir * LOAD_BEHIND;
    const viaAlong = centre - dir * STOP_APPROACH;
    const outAlong = centre + dir * (LOAD_BEHIND + STOP_APPROACH);
    // Masuk: simpul di BELAKANG titik menepi; keluar: di DEPAN titik kembali.
    const inNode = pickRoad(viaAlong, viaAlong - dir * (MERGE_BACK - STOP_APPROACH), (-dir) as 1 | -1);
    const outNode = pickRoad(outAlong, outAlong + dir * (MERGE_BACK - STOP_APPROACH), dir);
    if (inNode < 0 || outNode < 0) continue;
    entries.push({ dir, node: inNode, via: lanePt(viaAlong), pt: lanePt(pAlong), outVia: lanePt(outAlong), outNode });
  }
  if (entries.length === 0) {
    // Blok terlalu pendek untuk menepi lurus: sambungan miring lama, chassis
    // tetap ditengahkan di bay (arah truk mengikuti sambungannya).
    for (const i of [lo, hi]) {
      if (!valid(i) || Math.abs(i - (p + 1)) > reach) continue;
      const dir: 1 | -1 = i < p + 1 ? 1 : -1;
      entries.push({ dir, node: ids[i], via: null, pt: { x, z }, outVia: null, outNode: ids[i] });
    }
  }
  return { pt: { x, z }, links: [...new Set(entries.map((e) => e.node))], entries };
}

/** Dijkstra dari beberapa sumber sekaligus, masing-masing dengan biaya awalnya. */
function dijkstra(g: RoadGraph, sources: { node: number; cost: number }[]) {
  const n = g.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  for (const s of sources) if (s.cost < dist[s.node]) dist[s.node] = s.cost;

  // Grafnya ratusan node, bukan jutaan: pencarian linear tiap langkah lebih
  // sederhana daripada heap dan tetap jauh di bawah satu milidetik.
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    }
    if (u < 0) break;
    done[u] = 1;
    for (const e of g.adj[u]) {
      const d = dist[u] + e.w;
      if (d < dist[e.to]) {
        dist[e.to] = d;
        prev[e.to] = u;
      }
    }
  }
  return { dist, prev };
}

function trace(prev: Int32Array, end: number): number[] {
  const out: number[] = [];
  for (let u = end; u >= 0; u = prev[u]) out.push(u);
  return out.reverse();
}

const dist2 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

/** Titik-titik ekor rute masuk (menepi + lurus di lajur layanan). */
const entryTail = (e: StopEntry): Pt[] => (e.via ? [e.via, e.pt] : [e.pt]);

/**
 * Rute dari gate ke titik berhenti. null kalau keduanya tidak tersambung.
 * `picked` (opsional) diisi cara masuk yang dipilih — arahnya dipakai lagi
 * saat keluar, supaya truk melaju terus ke depan, tidak berbalik.
 */
export function routeToStop(g: RoadGraph, gate: GateNode, stop: Stop, picked?: { entry?: StopEntry }): Pt[] | null {
  const { dist, prev } = dijkstra(g, [{ node: gate.node, cost: 0 }]);
  let pick: StopEntry | null = null;
  let best = Infinity;
  for (const e of stop.entries) {
    const tail = entryTail(e);
    let d = dist[e.node] + dist2(g.nodes[e.node], tail[0]);
    for (let i = 1; i < tail.length; i++) d += dist2(tail[i - 1], tail[i]);
    if (d < best) {
      best = d;
      pick = e;
    }
  }
  if (!pick || !Number.isFinite(best)) return null;
  if (picked) picked.entry = pick;
  return [gate.outside, ...trace(prev, pick.node).map((i) => g.nodes[i]), ...entryTail(pick)];
}

/**
 * Rute dari titik berhenti kembali ke gate keluar: lurus ke depan di lajur
 * layanan dulu (arah `entry`), baru kembali ke jalan lorong.
 */
export function routeFromStop(g: RoadGraph, stop: Stop, gate: GateNode, entry?: StopEntry | null): Pt[] | null {
  const opts = entry ? [entry] : stop.entries;
  const { dist, prev } = dijkstra(
    g,
    opts.map((e) => ({
      node: e.outNode,
      cost: e.outVia ? dist2(e.pt, e.outVia) + dist2(e.outVia, g.nodes[e.outNode]) : dist2(e.pt, g.nodes[e.outNode]),
    })),
  );
  if (!Number.isFinite(dist[gate.node])) return null;
  const nodes = trace(prev, gate.node);
  const used = opts.find((e) => e.outNode === nodes[0]) ?? opts[0];
  return [used.pt, ...(used.outVia ? [used.outVia] : []), ...nodes.map((i) => g.nodes[i]), gate.outside];
}

/**
 * Blok yang jalan lorongnya tidak bisa dicapai dari gate mana pun.
 *
 * Ditampilkan di HUD sebagai pemeriksa tata letak: truk tidak akan pernah
 * muncul untuk kontainer di blok seperti ini, dan tanpa daftar ini alasannya
 * tidak terlihat di mana pun.
 */
export function unreachableBlocks(g: RoadGraph): string[] {
  if (g.gates.length === 0) return [...g.lanes.keys()];
  const { dist } = dijkstra(g, g.gates.map((gt) => ({ node: gt.node, cost: 0 })));
  return [...g.lanes.entries()]
    .filter(([, ids]) => !ids.some((i) => Number.isFinite(dist[i])))
    .map(([id]) => id);
}

// --- rute sebagai lintasan yang bisa disampel ------------------------------

export type Route = { pts: Pt[]; cum: number[]; length: number };

export function makeRoute(raw: Pt[]): Route {
  const pts: Pt[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || dist2(last, p) > 0.05) pts.push(p);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist2(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] ?? 0 };
}

function pointAt(r: Route, s: number): Pt {
  if (r.pts.length === 1 || s <= 0) return r.pts[0];
  if (s >= r.length) return r.pts[r.pts.length - 1];
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const a = r.pts[i - 1];
  const b = r.pts[i];
  const t = (s - r.cum[i - 1]) / Math.max(1e-6, r.cum[i] - r.cum[i - 1]);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Posisi dan sudut hadap di jarak `s` sepanjang rute.
 *
 * Sudutnya diambil dari titik sedikit di depan dan di belakang, bukan dari
 * ruas tempat truk berada. Dengan ruas, truk berputar seketika di setiap
 * sudut; dengan selisih ±LOOK ia membelok sepanjang beberapa meter.
 */
const LOOK = 3;
export function sampleRoute(r: Route, s: number): { x: number; z: number; ry: number } {
  const p = pointAt(r, s);
  const a = pointAt(r, s - LOOK);
  const b = pointAt(r, s + LOOK);
  // Truk menghadap +X lokal; ry ini membawa +X ke arah (dx, dz).
  const ry = Math.atan2(-(b.z - a.z), b.x - a.x);
  return { x: p.x, z: p.z, ry };
}

/**
 * Membulatkan setiap tikungan menjadi busur: sudut patah di simpul graf
 * diganti kurva Bézier kuadrat sepanjang `radius` meter di kedua sisinya.
 *
 * Tanpa ini truk berbelok di satu titik — hidungnya berputar di tempat seperti
 * forklift. Panjang potongan dibatasi 45% ruas terpendek supaya dua tikungan
 * yang berdekatan tidak saling menimpa. Titik pertama dan terakhir tidak
 * pernah bergeser: titik berhenti di lajur layanan harus tetap di tempatnya.
 */
export function roundCorners(pts: Pt[], radius = 9, steps = 6): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const p = pts[i];
    const b = pts[i + 1];
    const l1 = Math.hypot(p.x - a.x, p.z - a.z);
    const l2 = Math.hypot(b.x - p.x, b.z - p.z);
    if (l1 < 0.01 || l2 < 0.01) {
      out.push(p);
      continue;
    }
    const u1 = { x: (p.x - a.x) / l1, z: (p.z - a.z) / l1 };
    const u2 = { x: (b.x - p.x) / l2, z: (b.z - p.z) / l2 };
    // Hampir lurus (< ~10°): tidak perlu dibulatkan.
    if (u1.x * u2.x + u1.z * u2.z > 0.985) {
      out.push(p);
      continue;
    }
    const d = Math.min(radius, l1 * 0.45, l2 * 0.45);
    const p0 = { x: p.x - u1.x * d, z: p.z - u1.z * d };
    const p2 = { x: p.x + u2.x * d, z: p.z + u2.z * d };
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const w0 = (1 - t) * (1 - t);
      const w1 = 2 * (1 - t) * t;
      const w2 = t * t;
      out.push({ x: w0 * p0.x + w1 * p.x + w2 * p2.x, z: w0 * p0.z + w1 * p.z + w2 * p2.z });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Jarak sepanjang rute ke titik rute yang paling dekat dengan `pt`. */
export function nearestS(r: Route, pt: Pt): number {
  let best = Infinity;
  let bestS = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1];
    const b = r.pts[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / len2)) : 0;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(pt.x - px, pt.z - pz);
    if (d < best) {
      best = d;
      bestS = r.cum[i - 1] + Math.sqrt(len2) * t;
    }
  }
  return bestS;
}

/**
 * Menggeser lintasan ke KIRI arah jalan sejauh `d` — Indonesia berlalu lintas
 * di kiri, dan tanpa geseran ini dua truk yang berpapasan saling menembus di
 * garis tengah.
 *
 * Titik pertama dan terakhir boleh dibiarkan: titik berhenti di lajur layanan
 * sudah berada di tempatnya sendiri dan tidak boleh ikut tergeser.
 */
export function keepLeft(pts: Pt[], d: number, keepFirst: boolean | number, keepLast: boolean | number): Pt[] {
  const n = pts.length;
  if (n < 2) return pts;
  // Jumlah titik di awal/akhir yang tidak digeser (true = 1). Titik di lajur
  // layanan sudah berada di lajurnya sendiri — menggesernya ke kiri bisa
  // menaruh truk di dalam blok atau di rel RTG.
  const head = keepFirst === true ? 1 : keepFirst === false ? 0 : keepFirst;
  const tail = keepLast === true ? 1 : keepLast === false ? 0 : keepLast;
  const left = (a: Pt, b: Pt): Pt => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // Kiri dari arah (dx, dz) dalam konvensi rotasi three: (dz, -dx).
    return { x: dz / l, z: -dx / l };
  };
  return pts.map((p, i) => {
    if (i < head || i >= n - tail) return p;
    const a = i > 0 ? left(pts[i - 1], p) : null;
    const b = i < n - 1 ? left(p, pts[i + 1]) : null;
    let nx = (a?.x ?? 0) + (b?.x ?? 0);
    let nz = (a?.z ?? 0) + (b?.z ?? 0);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    // Di tikungan geseran diperpanjang supaya kedua ruasnya tetap sejarak d,
    // dibatasi supaya tikungan tajam tidak melempar titiknya jauh.
    const cos = a && b ? Math.max(0.5, nx * a.x + nz * a.z) : 1;
    return { x: p.x + (nx * d) / cos, z: p.z + (nz * d) / cos };
  });
}
