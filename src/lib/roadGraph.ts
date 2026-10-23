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
  const lanes = new Map<string, number[]>();
  for (const blk of blocks) {
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
 * Titik berhenti truk untuk sebuah kontainer: di lajur layanan, sejajar bay-nya.
 *
 * Disambungkan ke jalan lorong DUA posisi slot sebelum dan sesudahnya, bukan
 * tepat di sampingnya. Dengan sambungan tegak lurus truk akan berbelok 90°
 * di tempat; dengan sambungan miring ia menepi seperti truk sungguhan.
 */
export function stopFor(
  g: RoadGraph,
  blk: YardBlock,
  bay: number,
  size: ContainerSize,
): { pt: Pt; links: number[] } | null {
  const ids = g.lanes.get(blk.id);
  if (!ids) return null;
  const length = blk.slots * PITCH.teu;
  const width = blk.rows * PITCH.row;
  const centre = bayOffsetX(blk, bay, size);
  const [x, z] = aroundBlock(blk, centre - length / 2, laneSide(blk) * (width / 2 + SERVICE_MID));
  // ids[0] adalah ujung awal, jadi posisi slot p ada di ids[p + 1].
  const p = Math.max(0, Math.min(blk.slots - 1, Math.round(centre / PITCH.teu - 0.5)));
  const links = [ids[Math.max(0, p - 1)], ids[Math.min(ids.length - 1, p + 3)]];
  return { pt: { x, z }, links: [...new Set(links)] };
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

/** Rute dari gate ke titik berhenti. null kalau keduanya tidak tersambung. */
export function routeToStop(g: RoadGraph, gate: GateNode, stop: { pt: Pt; links: number[] }): Pt[] | null {
  const { dist, prev } = dijkstra(g, [{ node: gate.node, cost: 0 }]);
  let end = -1;
  let best = Infinity;
  for (const l of stop.links) {
    const d = dist[l] + dist2(g.nodes[l], stop.pt);
    if (d < best) {
      best = d;
      end = l;
    }
  }
  if (end < 0 || !Number.isFinite(best)) return null;
  return [gate.outside, ...trace(prev, end).map((i) => g.nodes[i]), stop.pt];
}

/** Rute dari titik berhenti kembali ke gate keluar. */
export function routeFromStop(g: RoadGraph, stop: { pt: Pt; links: number[] }, gate: GateNode): Pt[] | null {
  const { dist, prev } = dijkstra(
    g,
    stop.links.map((l) => ({ node: l, cost: dist2(g.nodes[l], stop.pt) })),
  );
  if (!Number.isFinite(dist[gate.node])) return null;
  return [stop.pt, ...trace(prev, gate.node).map((i) => g.nodes[i]), gate.outside];
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
 * Menggeser lintasan ke KIRI arah jalan sejauh `d` — Indonesia berlalu lintas
 * di kiri, dan tanpa geseran ini dua truk yang berpapasan saling menembus di
 * garis tengah.
 *
 * Titik pertama dan terakhir boleh dibiarkan: titik berhenti di lajur layanan
 * sudah berada di tempatnya sendiri dan tidak boleh ikut tergeser.
 */
export function keepLeft(pts: Pt[], d: number, keepFirst: boolean, keepLast: boolean): Pt[] {
  const n = pts.length;
  if (n < 2) return pts;
  const left = (a: Pt, b: Pt): Pt => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // Kiri dari arah (dx, dz) dalam konvensi rotasi three: (dz, -dx).
    return { x: dz / l, z: -dx / l };
  };
  return pts.map((p, i) => {
    if ((i === 0 && keepFirst) || (i === n - 1 && keepLast)) return p;
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
