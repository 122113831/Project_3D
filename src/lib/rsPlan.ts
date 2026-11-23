/**
 * Rencana kerja reach stacker (RS) — MURNI (tanpa three.js), supaya diuji.
 *
 * Satu pekerjaan = relokasi di BARIS TEPI sebuah blok, karena RS bekerja dari
 * samping blok dan hanya menjangkau tumpukan terdekat:
 *
 *   keluar dari lajur parkir → jalan ke sisi blok → menghadap tumpukan sumber
 *   → boom turun, twistlock mengunci, kontainer terangkat → mundur → jalan ke
 *   tumpukan tujuan → boom menaruh kontainer → mundur → kembali ke parkir,
 *   masuk lajur dengan mundur (moncong menghadap keluar lagi).
 *
 * Rencananya berupa daftar langkah: JALAN (titik-titik lintasan, maju/mundur)
 * atau BOOM (pose awal → akhir, dengan kejadian angkat/lepas). Penggambar
 * (RsWorks) yang menghaluskan lintasan dan menggerakkan model.
 */
import { BOX, PITCH, ROAD } from './constants';
import { isBlocked } from './slots';
import type { YardBlock, YardContainer } from './types';
import { containerPosition } from './yard';
import type { LayoutEquipment, LayoutRoad } from './layout';

/** Geometri boom — HARUS sama dengan RS di reachStacker.ts (diuji). */
export const RS_BOOM = {
  pivot: { x: -2.75, y: 4.35 },
  /** innerStart + pinAlong: dari pivot ke pin spreader saat ext = 0. */
  reach: 1.9 + 7.05,
  pinDrop: 0.62,
  hang: 2.25,
  /** Batas panjang tambahan boom dalam (tetap ±0,8 m bertumpuk di boom luar). */
  maxExt: 4.4,
  rest: { angle: 0.12, ext: 0 },
};

/** Jarak titik asal RS ke tengah tumpukan saat bekerja (meter). */
export const RS_WORK_DIST = 6.6;
/** Tier tertinggi yang dilayani RS (jangkauan boom di jarak kerja). */
export const RS_MAX_TIER = 4;

export type Pose = { angle: number; ext: number };
export type Pt = { x: number; z: number };

export type RsStep =
  | { kind: 'drive'; pts: Pt[]; reverse: boolean; pose: Pose }
  | { kind: 'boom'; from: Pose; to: Pose; dur: number; event?: 'grab' | 'release' };

export type RsUnit = { key: string; code: string; x: number; z: number; ry: number };

export type RsJobPlan = {
  blockId: string;
  container: YardContainer;
  to: YardContainer;
  steps: RsStep[];
};

/**
 * Pose boom supaya ALAS spreader berada `dx` meter di depan titik asal RS
 * pada ketinggian `bottom`. Spreader selalu datar, jadi pin-nya tepat `hang`
 * di atas alas. Bila boom dalam harus lebih pendek dari nol, ext = 0 dan
 * sudutnya hanya mengejar ketinggian (dx yang dihasilkan sedikit lebih jauh).
 */
export function rsReach(dx: number, bottom: number): Pose {
  const { pivot, reach, pinDrop, hang, maxExt } = RS_BOOM;
  const vx = dx - pivot.x;
  const vy = bottom + hang - pivot.y;
  const len = Math.hypot(vx, vy);
  let ext = Math.sqrt(Math.max(0, len * len - pinDrop * pinDrop)) - reach;
  if (ext < 0) {
    ext = 0;
    const angle = Math.asin(Math.max(-1, Math.min(1, vy / Math.hypot(reach, pinDrop)))) + Math.atan2(pinDrop, reach);
    return { angle, ext };
  }
  ext = Math.min(maxExt, ext);
  return { angle: Math.atan2(vy, vx) + Math.atan2(pinDrop, reach + ext), ext };
}

/** Alas spreader (dx di depan, ketinggian) untuk sebuah pose — kebalikan rsReach. */
export function rsSpreaderBottom(p: Pose): { dx: number; y: number } {
  const { pivot, reach, pinDrop, hang } = RS_BOOM;
  const L = reach + p.ext;
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  return { dx: pivot.x + L * c + pinDrop * s, y: pivot.y + L * s - pinDrop * c - hang };
}

/** Puncak kontainer di tier t (alas spreader saat menjepitnya). */
const topOfTier = (tier: number) => (tier - 1) * PITCH.tier + BOX.height;

type Side = 1 | -1;

/** Arah dunia "masuk ke blok" dari sisi row 0 (+1) atau sisi row terakhir (−1). */
function inward(block: Pick<YardBlock, 'rot'>, side: Side): Pt {
  const r = block.rot ?? 0;
  return { x: side * Math.sin(r), z: side * Math.cos(r) };
}
/** Arah dunia sepanjang blok (+bay). */
function along(block: Pick<YardBlock, 'rot'>): Pt {
  const r = block.rot ?? 0;
  return { x: Math.cos(r), z: -Math.sin(r) };
}
/** ry three.js supaya moncong RS (+X lokal) menghadap arah d. */
export const headingOf = (d: Pt) => Math.atan2(-d.z, d.x);

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, z: a.z + b.z * k });

/**
 * Relokasi yang bisa dikerjakan RS di baris tepi `side`: kontainer 20ft di
 * puncak tumpukannya (tier ≤ RS_MAX_TIER) → puncak tumpukan lain di baris
 * yang sama, sedikitnya 3 bay jauhnya (supaya RS sempat bermanuver).
 */
export function pickRsMove(
  b: Pick<YardBlock, 'slots' | 'rows' | 'tiers' | 'containers' | 'blocked'>,
  side: Side,
  rand: () => number = Math.random,
  /** Bay yang boleh dipakai (sumber dan tujuan), mis. yang cukup ruang di depannya. */
  bayOk: (bay: number) => boolean = () => true,
): { c: YardContainer; to: YardContainer } | null {
  const row = side === 1 ? 0 : b.rows - 1;
  const height = new Map<number, number>();
  const has40 = new Set<number>();
  for (const c of b.containers) {
    if (c.row !== row) continue;
    const span = c.size === 40 ? 2 : 1;
    for (let i = 0; i < span; i++) {
      height.set(c.bay + i, Math.max(height.get(c.bay + i) ?? 0, c.tier));
      if (c.size === 40) has40.add(c.bay + i);
    }
  }
  const maxTier = Math.min(b.tiers, RS_MAX_TIER);
  const sources = b.containers.filter(
    (c) =>
      c.row === row && c.size === 20 && !has40.has(c.bay) && height.get(c.bay) === c.tier && c.tier <= maxTier && bayOk(c.bay),
  );
  if (!sources.length) return null;
  const start = Math.floor(rand() * sources.length);
  for (let n = 0; n < sources.length; n++) {
    const c = sources[(start + n) % sources.length];
    const options: YardContainer[] = [];
    for (let bay = 0; bay < b.slots; bay++) {
      if (Math.abs(bay - c.bay) < 3 || has40.has(bay) || !bayOk(bay)) continue;
      const tier = (height.get(bay) ?? 0) + 1;
      if (tier > maxTier || isBlocked(b.blocked ?? [], bay, row, tier)) continue;
      options.push({ ...c, bay, row, tier });
    }
    if (options.length) {
      // Yang terdekat lebih dulu, seperti relokasi di lapangan.
      options.sort((p, q) => Math.abs(p.bay - c.bay) - Math.abs(q.bay - c.bay));
      return { c, to: options[0] };
    }
  }
  return null;
}

/** Kotak blok (dunia, sejajar sumbu) yang diperlebar `pad` meter. */
function blockBox(b: YardBlock, pad: number) {
  const corners = [
    [0, 0],
    [b.slots * PITCH.teu, 0],
    [0, b.rows * PITCH.row],
    [b.slots * PITCH.teu, b.rows * PITCH.row],
  ].map(([u, v]) => {
    const cx = (b.slots * PITCH.teu) / 2;
    const cz = (b.rows * PITCH.row) / 2;
    const r = b.rot ?? 0;
    const dx = u - cx;
    const dz = v - cz;
    return { x: b.originX + cx + dx * Math.cos(r) + dz * Math.sin(r), z: b.originZ + cz - dx * Math.sin(r) + dz * Math.cos(r) };
  });
  return {
    x0: Math.min(...corners.map((c) => c.x)) - pad,
    x1: Math.max(...corners.map((c) => c.x)) + pad,
    z0: Math.min(...corners.map((c) => c.z)) - pad,
    z1: Math.max(...corners.map((c) => c.z)) + pad,
  };
}

type Box = { x0: number; x1: number; z0: number; z1: number; w: number };

/**
 * Ubin jalan sebagai kotak (sejajar sumbu; rotasi ubin kelipatan 90°). Lurus:
 * sepanjang lengannya × lebar badan jalan. Belokan/pertigaan/perempatan: dua
 * lengan bersilang — sedikit berlebih untuk belokan, tapi aman.
 */
function roadBoxes(roads: readonly LayoutRoad[], w: number): Box[] {
  const half = ROAD.width / 2;
  const out: Box[] = [];
  for (const r of roads) {
    const len = (r.len ?? ROAD.tile) / 2;
    const alongX = Math.abs(Math.cos(r.ry)) > 0.5;
    const arms = r.kind === 'straight' ? [alongX] : [true, false];
    for (const ax of arms) {
      const hx = ax ? len : half;
      const hz = ax ? half : len;
      out.push({ x0: r.x - hx, x1: r.x + hx, z0: r.z - hz, z1: r.z + hz, w });
    }
  }
  return out;
}

/**
 * Rintangan lintasan RS: blok (bobot besar — tidak mungkin ditembus) dan ubin
 * jalan (bobot kecil — boleh DILINTASI, tapi jangan DISUSURI). Tanpa jalan,
 * RS dari parkir di luar cincin jalan menyusuri jalan keliling di luar blok.
 */
function obstacles(blocks: readonly YardBlock[], roads: readonly LayoutRoad[], pad = 1.5): Box[] {
  return [...blocks.map((k) => ({ ...blockBox(k, pad), w: 5 })), ...roadBoxes(roads, 1)];
}

const inBox = (q: Box, x: number, z: number) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1;

/** Biaya lintasan a→b: meter yang menembus rintangan × bobotnya (sampel tiap 1 m). */
function blockedLength(obs: readonly Box[], a: Pt, b: Pt): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  let cost = 0;
  for (let k = 0; k <= len; k += 1) {
    const t = len ? k / len : 0;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    let w = 0;
    for (const q of obs) if (inBox(q, x, z)) w = Math.max(w, q.w);
    cost += w;
  }
  return cost;
}

/** Sudut L antara dua titik yang paling sedikit menembus rintangan. */
function lRoute(obs: readonly Box[], a: Pt, b: Pt): Pt[] {
  const c1 = { x: a.x, z: b.z };
  const c2 = { x: b.x, z: a.z };
  const cost = (c: Pt) => blockedLength(obs, a, c) + blockedLength(obs, c, b);
  return [cost(c1) <= cost(c2) ? c1 : c2];
}

/** Ruang yang dibutuhkan RS di depan baris tepi: jarak kerja + buritan + sela. */
export const RS_NEED_CLEAR = RS_WORK_DIST + 5.8 + 0.5;
const CLEAR_MAX = 40;

/**
 * Ruang bebas (m) dari tengah baris tepi ke rintangan pertama (blok lain atau
 * jalan), di depan satu bay, ke arah luar sisi `side`. Selebar RS (±2,5 m).
 */
function sideClearance(block: YardBlock, side: Side, bay: number, obs: readonly Box[]): number {
  const n = inward(block, side);
  const t = along(block);
  const row = side === 1 ? 0 : block.rows - 1;
  const [cx, , cz] = containerPosition(block, { size: 20, bay, row, tier: 1 });
  for (let d = PITCH.row / 2 + 0.2; d < CLEAR_MAX; d += 0.5) {
    for (const k of [-2.5, 0, 2.5]) {
      const x = cx - n.x * d + t.x * k;
      const z = cz - n.z * d + t.z * k;
      if (obs.some((q) => inBox(q, x, z))) return d;
    }
  }
  return CLEAR_MAX;
}

/** Jarak garis antre dari tengah baris: tengah lorong bebas, dalam batas manuver. */
const stageDist = (clear: number) => Math.min(RS_WORK_DIST + 10, Math.max(RS_WORK_DIST + 4, clear / 2));

/** Jarak tengah lajur → lorong saat keluar/masuk, dan jari-jari belok (m). */
const BAY_OUT = 11;
const TURN_R = 7;

const dot = (a: Pt, b: Pt) => a.x * b.x + a.z * b.z;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, z: a.z - b.z });

/** Ujung lajur yang menghadap titik p: +1 sisi moncong, −1 sisi buritan. */
const bayEnd = (bay: Pt, fwd: Pt, p: Pt): 1 | -1 => (dot(sub(p, bay), fwd) >= 0 ? 1 : -1);
/** Arah sepanjang lorong (±lat) dari `from` menuju `to`. */
const laneDir = (lat: Pt, from: Pt, to: Pt): Pt => (dot(sub(to, from), lat) >= 0 ? lat : { x: -lat.x, z: -lat.z });

/**
 * Keluar lajur lewat ujung yang lebih dekat ke tujuan: MAJU bila tujuan di
 * depan moncong, MUNDUR bila di belakang buritan. Keduanya berbelok di lorong
 * sehingga moncong berakhir menghadap sepanjang lorong ke arah tujuan — saat
 * mundur, buritannya yang diayun menjauhi arah itu, seperti pengemudi sungguhan.
 */
function leaveBay(bay: Pt, fwd: Pt, lat: Pt, target: Pt, pose: Pose): { step: RsStep; end: Pt; travel: Pt } {
  const e = bayEnd(bay, fwd, target);
  const dir = { x: fwd.x * e, z: fwd.z * e };
  const travel = laneDir(lat, bay, target);
  const swing = e === 1 ? 1 : -1; // maju: ke arah travel; mundur: buritan ke −travel
  const pts = [
    bay,
    add(bay, dir, BAY_OUT),
    add(add(bay, dir, BAY_OUT + TURN_R * 0.7), travel, swing * TURN_R * 0.7),
    add(add(bay, dir, BAY_OUT + TURN_R), travel, swing * TURN_R * 1.6),
  ];
  return { step: { kind: 'drive', reverse: e === -1, pose, pts }, end: pts[pts.length - 1], travel };
}

/**
 * Pulang ke lajur lewat ujung yang lebih dekat ke arah datang: dari depan
 * moncong RS melewati mulut lajur lalu MUNDUR masuk; dari belakang buritan RS
 * berbelok dan MAJU masuk. Keduanya berakhir di tengah lajur dengan arah
 * moncong semula.
 */
function enterBay(bay: Pt, fwd: Pt, lat: Pt, from: Pt, pose: Pose, obs: readonly Box[]): RsStep[] {
  const e = bayEnd(bay, fwd, from);
  const dir = { x: fwd.x * e, z: fwd.z * e };
  const travel = laneDir(lat, from, bay);
  if (e === 1) {
    // Lewati mulut lajur, lalu mundur dengan buritan berayun masuk.
    const pass = add(add(bay, dir, BAY_OUT + TURN_R), travel, TURN_R);
    const approach = add(pass, travel, -10);
    return [
      { kind: 'drive', reverse: false, pose, pts: [from, ...lRoute(obs, from, approach), approach, pass] },
      { kind: 'drive', reverse: true, pose, pts: [pass, add(bay, dir, BAY_OUT), bay] },
    ];
  }
  // Datang dari sisi buritan: belok dan maju masuk.
  const turnIn = add(add(bay, dir, BAY_OUT + TURN_R), travel, -TURN_R);
  const approach = add(turnIn, travel, -8);
  return [
    { kind: 'drive', reverse: false, pose, pts: [from, ...lRoute(obs, from, approach), approach, turnIn, add(bay, dir, BAY_OUT), bay] },
  ];
}

/**
 * Rencana lengkap satu RS untuk satu relokasi. `side` = sisi blok yang
 * didekati (dipilih pemanggil: yang lebih dekat ke parkir RS).
 */
export function planRsJob(
  unit: RsUnit,
  block: YardBlock,
  side: Side,
  move: { c: YardContainer; to: YardContainer },
  blocks: readonly YardBlock[],
  roads: readonly LayoutRoad[] = [],
): RsJobPlan {
  const obs = obstacles(blocks, roads);
  const others = obstacles(blocks.filter((b) => b.id !== block.id), roads, 0.5);
  const n = inward(block, side);
  const t0 = along(block);
  const [sx, , sz] = containerPosition(block, move.c);
  const [tx, , tz] = containerPosition(block, move.to);
  const src = { x: sx, z: sz };
  const dst = { x: tx, z: tz };
  // Titik kerja (asal RS) di depan tumpukan, dan titik antre di lorong.
  const A1 = add(src, n, -RS_WORK_DIST);
  const A2 = add(dst, n, -RS_WORK_DIST);
  // Garis antre di TENGAH lorong yang benar-benar bebas di depan tiap bay —
  // bukan jarak tetap, yang bisa jatuh di atas jalan keliling.
  const stage1 = stageDist(sideClearance(block, side, move.c.bay, others)) - RS_WORK_DIST;
  const stage2 = stageDist(sideClearance(block, side, move.to.bay, others)) - RS_WORK_DIST;
  const S1 = add(A1, n, -stage1);
  const S2 = add(A2, n, -stage2);
  // Arah menyusur blok dari sumber ke tujuan.
  const dir = (tx - sx) * t0.x + (tz - sz) * t0.z >= 0 ? 1 : -1;
  const t = { x: t0.x * dir, z: t0.z * dir };

  const fwd = { x: Math.cos(unit.ry), z: -Math.sin(unit.ry) };
  const lat = { x: -fwd.z, z: fwd.x };
  const bay = { x: unit.x, z: unit.z };

  const rest = RS_BOOM.rest;
  const grabPose = rsReach(RS_WORK_DIST, topOfTier(move.c.tier));
  const liftPose = rsReach(RS_WORK_DIST, topOfTier(move.c.tier) + 0.8);
  // Membawa: kontainer rendah di depan RS (alas ±0,8 m dari tanah).
  const carryPose = rsReach(5.5, BOX.height + 0.8);
  const raisePose = rsReach(RS_WORK_DIST, topOfTier(move.to.tier) + 0.8);
  const placePose = rsReach(RS_WORK_DIST, topOfTier(move.to.tier));

  // Berangkat: keluar lajur (maju/mundur menurut letak blok), menyusuri
  // lorong, lalu menghadap tumpukan sumber.
  const out = leaveBay(bay, fwd, lat, S1, rest);
  const lane = add(out.end, out.travel, 4);
  const steps: RsStep[] = [
    out.step,
    { kind: 'drive', reverse: false, pose: rest, pts: [out.end, lane, ...lRoute(obs, lane, S1), S1, add(A1, n, -4), A1] },
    { kind: 'boom', from: rest, to: grabPose, dur: 2.6 },
    { kind: 'boom', from: grabPose, to: grabPose, dur: 0.6, event: 'grab' },
    { kind: 'boom', from: grabPose, to: liftPose, dur: 1.2 },
    // Mundur lurus dulu (kontainer masih tinggi, menjauhi tumpukan), baru turun.
    { kind: 'drive', reverse: true, pose: liftPose, pts: [A1, add(A1, n, -5)] },
    { kind: 'boom', from: liftPose, to: carryPose, dur: 1.8 },
    // Mundur sambil berbelok ke arah tujuan, lalu maju menyusur blok.
    { kind: 'drive', reverse: true, pose: carryPose, pts: [add(A1, n, -5), add(add(S1, t, -6), n, 1)] },
    { kind: 'drive', reverse: false, pose: carryPose, pts: [add(add(S1, t, -6), n, 1), add(S1, t, 2), add(S2, t, -4), S2, add(A2, n, -5)] },
    { kind: 'boom', from: carryPose, to: raisePose, dur: 2.2 },
    { kind: 'drive', reverse: false, pose: raisePose, pts: [add(A2, n, -5), A2] },
    { kind: 'boom', from: raisePose, to: placePose, dur: 1.4 },
    { kind: 'boom', from: placePose, to: placePose, dur: 0.6, event: 'release' },
    { kind: 'boom', from: placePose, to: rest, dur: 2.2 },
  ];

  // Pulang: mundur menjauhi blok dengan buritan ke arah −t (moncong berakhir
  // menghadap +t, searah lintasan maju berikutnya), lalu masuk lajur lewat
  // ujung yang lebih dekat — mundur atau maju (enterBay).
  const back = add(add(A2, n, -stage2 + 1), t, -6);
  const from = add(back, t, 6);
  steps.push(
    { kind: 'drive', reverse: true, pose: rest, pts: [A2, add(A2, n, -5), back] },
    { kind: 'drive', reverse: false, pose: rest, pts: [back, from] },
    ...enterBay(bay, fwd, lat, from, rest, obs),
  );
  return { blockId: block.id, container: move.c, to: move.to, steps };
}

/** Sisi blok yang lebih dekat ke sebuah titik: +1 sisi row 0, −1 sisi row terakhir. */
export function nearSide(block: YardBlock, p: Pt): Side {
  const [x0, , z0] = containerPosition(block, { size: 20, bay: 0, row: 0, tier: 1 });
  const [x1, , z1] = containerPosition(block, { size: 20, bay: 0, row: block.rows - 1, tier: 1 });
  return Math.hypot(p.x - x0, p.z - z0) <= Math.hypot(p.x - x1, p.z - z1) ? 1 : -1;
}

/**
 * Semua RS di tata letak beserta pose diamnya (tempatnya kembali setelah
 * bekerja). Kunci = id alat, sama dengan yang dipakai Equipment untuk
 * menyembunyikan RS yang sedang bekerja. Kode kosong = urut RS01, RS02, …
 */
export function rsUnits(equipment: readonly LayoutEquipment[]): RsUnit[] {
  const out: RsUnit[] = [];
  let n = 0;
  for (const it of equipment) {
    if (it.kind !== 'reachStacker') continue;
    n++;
    out.push({ key: it.id, code: it.code?.trim() || `RS${String(n).padStart(2, '0')}`, x: it.x, z: it.z, ry: it.ry });
  }
  return out;
}

/**
 * Rencana satu RS untuk satu blok, atau null bila blok itu tidak punya
 * relokasi yang bisa dijangkau RS. Memilih sisi blok, kontainer, dan lintasan.
 */
export function planRsFor(
  unit: RsUnit,
  block: YardBlock,
  blocks: readonly YardBlock[],
  roads: readonly LayoutRoad[],
  rand: () => number = Math.random,
): RsJobPlan | null {
  // Sisi yang cukup ruang di depannya lebih dulu — sisi terdekat ke parkir
  // dulu, lalu sisi seberang. Baru bila keduanya sempit, sisi yang paling lega.
  const others = obstacles(blocks.filter((b) => b.id !== block.id), roads, 0.5);
  const near = nearSide(block, unit);
  const sides: Side[] = [near, near === 1 ? -1 : 1];
  for (const side of sides) {
    const move = pickRsMove(block, side, rand, (bay) => sideClearance(block, side, bay, others) >= RS_NEED_CLEAR);
    if (move) return planRsJob(unit, block, side, move, blocks, roads);
  }
  const roomy = (side: Side) => sideClearance(block, side, Math.floor(block.slots / 2), others);
  const best = roomy(sides[0]) >= roomy(sides[1]) ? sides[0] : sides[1];
  const move = pickRsMove(block, best, rand);
  return move ? planRsJob(unit, block, best, move, blocks, roads) : null;
}
