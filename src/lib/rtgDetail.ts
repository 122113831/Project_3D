import * as THREE from 'three';
import type { ModelPart } from './containerModel';
import { BOX, PITCH, RTG, RTG_CLEARANCE } from './constants';
import { box, merge, rbox, rod } from './realisticContainer';

/**
 * RTG detail — portal kuning prosedural mengikuti gambar acuan (aset RTG lain
 * tidak diubah). Tanpa kontainer: spreader menggantung kosong.
 *
 * Koordinat lokal: X = arah jalan portal (sepanjang blok), Z = bentang
 * (melintang blok), Y = atas. Titik nol di sumbu portal, di tanah. Rel/roda di
 * z = ±railZ — dibangun ULANG per lebar blok (bukan diregangkan), jadi kaki,
 * roda, dan tangganya tidak gepeng di blok yang lebih lebar.
 *
 * Tiga kelompok terpisah supaya RtgWorks bisa menggerakkannya:
 *   - frame    : portal, girder, walkway, tangga, roda (diam)
 *   - trolley  : trolley + kabin operator (bergeser sepanjang Z)
 *   - spreader : spreader + kepala tali (bergeser Z dan naik-turun); alasnya
 *                di y = 0 lokal
 * plus `ropes`: tali hoist untuk posisi diam saja (RtgWorks menggambar
 * kabelnya sendiri yang ikut memanjang).
 */

export const RTG_DETAIL = {
  /** Kaki portal di x = ±legX. */
  legX: 4.6,
  /** Balok sill (bawah) — puncaknya. */
  sillTop: 2.9,
  /** Girder utama: bawah & atas. */
  girderBottom: 20.4,
  girderTop: 22.0,
  /** Alas trolley (di atas rel girder). */
  trolleyDeck: 22.15,
  /** Titik keluar tali di bawah trolley. */
  ropeTop: 21.9,
  /** Tinggi kepala spreader dari alasnya (titik ikat tali). */
  spreaderHead: 1.25,
  /** Alas spreader saat diam: sama dengan tinggi jelajah RtgWorks. */
  restUnder: RTG.height - 2.2,
  /** Tinggi total kira-kira (untuk kotak pilih editor). */
  height: 25,
} as const;

/** Jarak rel dari sumbu portal untuk blok selebar `width` (sama dengan aset RTG lain). */
export const rtgDetailRailZ = (width: number) => width / 2 + RTG_CLEARANCE;

/** railZ untuk blok terdekat pada sumbu Z (aturan yang sama dengan RTG lain). */
export function rtgDetailRailZAt(blocks: readonly { originZ: number; rows: number }[], z: number): number {
  let best: { originZ: number; rows: number } | null = null;
  let d = Infinity;
  for (const b of blocks) {
    const c = b.originZ + (b.rows * PITCH.row) / 2;
    if (Math.abs(c - z) < d) {
      d = Math.abs(c - z);
      best = b;
    }
  }
  return rtgDetailRailZ(best ? best.rows * PITCH.row : 6 * PITCH.row);
}

export type V3 = [number, number, number];

/** Balok persegi dari a ke b. */
export function beam(a: V3, b: V3, w: number, h = w): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.BoxGeometry(va.distanceTo(vb), h, w).toNonIndexed();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vb.clone().sub(va).normalize()));
  const m = va.add(vb).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Pipa bulat dari a ke b. */
export function tube(a: V3, b: V3, r: number, seg = 8): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg, 1).toNonIndexed();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  const m = va.add(vb).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Kolom kotak meruncing: alas wb×db, puncak wt×dt (x × z), dari y0 ke y1. */
export function taperedColumn(x: number, z: number, y0: number, y1: number, wb: number, db: number, wt: number, dt: number) {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0;
    p.setXYZ(i, p.getX(i) * (top ? wt : wb), top ? y1 : y0, p.getZ(i) * (top ? dt : db));
  }
  g.computeVertexNormals();
  g.translate(x, 0, z);
  return g;
}

/** Railing: tiang tiap `step` m dan dua rel (atas & tengah) dari a ke b, setinggi h. */
export function railing(out: THREE.BufferGeometry[], a: V3, b: V3, h = 1.1, step = 1.6) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const n = Math.max(1, Math.round(va.distanceTo(vb) / step));
  for (let i = 0; i <= n; i++) {
    const p = va.clone().lerp(vb, i / n);
    out.push(tube([p.x, p.y, p.z], [p.x, p.y + h, p.z], 0.025, 5));
  }
  out.push(tube([a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.03, 6));
  out.push(tube([a[0], a[1] + h * 0.5, a[2]], [b[0], b[1] + h * 0.5, b[2]], 0.022, 5));
}

/** Tekstur garis miring kuning-hitam untuk bumper roda. */
let hazardTex: THREE.Texture | null = null;
export function hazardTexture() {
  if (hazardTex) return hazardTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c230';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1c1c1c';
  for (let i = -128; i < 256; i += 36) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 18, 0);
    g.lineTo(i + 18 + 128, 128);
    g.lineTo(i + 128, 128);
    g.closePath();
    g.fill();
  }
  hazardTex = new THREE.CanvasTexture(c);
  hazardTex.colorSpace = THREE.SRGBColorSpace;
  return hazardTex;
}

type Bucket = Record<'paint' | 'steel' | 'dark' | 'tire' | 'glass' | 'hazard' | 'genset', THREE.BufferGeometry[]>;
const bucket = (): Bucket => ({ paint: [], steel: [], dark: [], tire: [], glass: [], hazard: [], genset: [] });

/** Roda ban karet: ban hitam + velg abu, sumbu Z. */
function wheel(b: Bucket, x: number, z: number) {
  const r = 0.82;
  b.tire.push(rod(r, 0.62, x, r, z, 'z', 20));
  b.steel.push(rod(r * 0.52, 0.66, x, r, z, 'z', 14));
  b.dark.push(rod(r * 0.16, 0.7, x, r, z, 'z', 8));
}

function buildFrame(railZ: number): Bucket {
  const D = RTG_DETAIL;
  const b = bucket();
  const L = D.legX;
  for (const sz of [1, -1]) {
    const z = sz * railZ;
    // Balok sill sepanjang X di atas roda, dan dudukan bogie.
    b.paint.push(rbox(2 * L + 2.6, 1.0, 1.0, 0, D.sillTop - 0.5, z, 0.03));
    for (const sx of [1, -1]) {
      const bx = sx * (L + 0.6);
      // Garpu bogie: dua pelat tegak + poros, dua roda berdampingan sepanjang X.
      b.paint.push(rbox(2.3, 0.9, 1.15, bx, 1.85, z, 0.03));
      b.paint.push(rod(0.28, 0.9, bx, 2.25, z, 'y', 12));
      for (const wx of [-0.62, 0.62]) {
        b.paint.push(box(0.12, 1.0, 1.0, bx + wx, 1.15, z + 0.42));
        b.paint.push(box(0.12, 1.0, 1.0, bx + wx, 1.15, z - 0.42));
        wheel(b, bx + wx, z);
      }
      // Bumper bergaris di ujung luar bogie.
      b.hazard.push(box(0.14, 0.95, 1.25, bx + sx * 1.32, 1.05, z));
      // Kolom kaki meruncing dari sill ke girder.
      b.paint.push(taperedColumn(sx * L, z, D.sillTop - 0.1, D.girderBottom + 0.1, 0.85, 0.9, 1.25, 1.05));
      // Knee brace: dari kaki ke bawah girder, ke arah tengah bentang.
      b.paint.push(tube([sx * L, 15.2, z - sz * 0.5], [sx * L, D.girderBottom - 0.05, z - sz * 4.6], 0.13, 10));
    }
    // Ikatan antar kaki satu sisi: pipa datar + diagonal.
    b.paint.push(tube([-L, 11.5, z], [L, 11.5, z], 0.14, 10));
    b.paint.push(tube([-L, 4.0, z], [L, 11.4, z], 0.12, 10));
    // Genset/ruang mesin abu-abu di bawah sill, di antara bogie.
    b.genset.push(rbox(3.2, 1.7, 1.35, 0, 1.25, z, 0.04));
    b.dark.push(box(0.6, 0.5, 0.02, 0.9, 1.4, z + sz * 0.69));
    // Balok kepala portal di atas kaki (menyambung kedua girder).
    b.paint.push(rbox(2 * L + 1.2, 1.3, 1.25, 0, D.girderBottom + 0.6, z, 0.03));
    // Lampu sorot di bawah kepala portal.
    for (const sx of [1, -1]) b.dark.push(box(0.5, 0.35, 0.3, sx * (L - 1.4), D.girderBottom - 0.15, z - sz * 0.8));
  }

  // Girder utama sepanjang Z, di atas kaki.
  const gLen = 2 * railZ + 2.4;
  for (const sx of [1, -1]) {
    const x = sx * L;
    b.paint.push(rbox(1.0, D.girderTop - D.girderBottom, gLen, x, (D.girderTop + D.girderBottom) / 2, 0, 0.03));
    // Rel trolley di sisi dalam puncak girder.
    b.steel.push(box(0.12, 0.12, gLen - 0.6, x - sx * 0.3, D.girderTop + 0.06, 0));
    // Walkway abu di sisi luar + railing + lampu sorot di muka girder.
    const wx = x + sx * 0.95;
    b.steel.push(box(0.95, 0.06, gLen, wx, D.girderTop - 0.02, 0));
    for (let zz = -gLen / 2 + 0.6; zz <= gLen / 2 - 0.6; zz += 1.4) b.steel.push(box(0.9, 0.18, 0.05, wx, D.girderTop - 0.12, zz));
    railing(b.steel, [wx + sx * 0.45, D.girderTop, -gLen / 2 + 0.2], [wx + sx * 0.45, D.girderTop, gLen / 2 - 0.2]);
    for (let zz = -gLen / 2 + 2; zz <= gLen / 2 - 2; zz += 4.2) b.dark.push(box(0.35, 0.3, 0.45, x + sx * 0.58, D.girderTop - 0.55, zz));
  }
  // Pagar ujung walkway & pipa pengikat bentang (bawah girder).
  for (const sz of [1, -1]) {
    railing(b.steel, [-L - 1.4, D.girderTop, sz * (gLen / 2 - 0.2)], [-L - 0.5, D.girderTop, sz * (gLen / 2 - 0.2)], 1.1, 0.9);
    railing(b.steel, [L + 0.5, D.girderTop, sz * (gLen / 2 - 0.2)], [L + 1.4, D.girderTop, sz * (gLen / 2 - 0.2)], 1.1, 0.9);
  }

  // ---- tangga zig-zag di muka luar sisi +Z, plus tangga kandang di bawah.
  const sz = 1;
  const zs = railZ + 1.05; // bidang tangga
  const flights: [number, number, number, number][] = [
    [-L + 0.4, D.sillTop + 0.6, L - 1.2, 8.6],
    [L - 1.2, 8.6, -L + 0.4, 14.4],
    [-L + 0.4, 14.4, L - 1.2, D.girderTop - 0.05],
  ];
  const landing = (x: number, y: number) => {
    b.steel.push(box(1.3, 0.08, 1.0, x, y, zs));
    railing(b.steel, [x - 0.6, y, zs + sz * 0.5], [x + 0.6, y, zs + sz * 0.5], 1.1, 0.6);
    // Penyangga bordes ke kaki.
    b.steel.push(beam([x, y - 0.05, zs - 0.45], [x, y - 0.05, railZ + 0.45], 0.12));
  };
  for (const [x0, y0, x1, y1] of flights) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    // Dua stringer.
    for (const off of [-0.42, 0.42]) b.steel.push(beam([x0, y0, zs + off], [x1, y1, zs + off], 0.06, 0.22));
    // Anak tangga tiap ±0,24 m naik.
    const n = Math.round(dy / 0.24);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      b.steel.push(box(0.26, 0.04, 0.84, x0 + dx * t, y0 + dy * t, zs));
    }
    // Pegangan di sisi luar.
    railing(b.steel, [x0, y0, zs + sz * 0.45], [x1, y1, zs + sz * 0.45], 1.0, 1.5);
    landing(x0, y0);
    landing(x1, y1);
  }
  // Tangga kandang dari tanah ke bordes pertama.
  const lx = -L + 0.4 - 0.95;
  for (const off of [-0.25, 0.25]) b.steel.push(tube([lx, 0.2, zs + off], [lx, D.sillTop + 0.6, zs + off], 0.025, 5));
  for (let y = 0.5; y < D.sillTop + 0.6; y += 0.3) b.steel.push(tube([lx, y, zs - 0.25], [lx, y, zs + 0.25], 0.018, 4));
  for (let y = 1.6; y < D.sillTop + 1.5; y += 0.55) {
    const hoop = new THREE.TorusGeometry(0.42, 0.018, 4, 14, Math.PI).toNonIndexed();
    hoop.rotateX(Math.PI / 2);
    hoop.rotateY(-Math.PI / 2);
    hoop.translate(lx, y, zs);
    b.steel.push(hoop);
  }
  return b;
}

function buildTrolley(): Bucket {
  const D = RTG_DETAIL;
  const b = bucket();
  const L = D.legX;
  const y0 = D.trolleyDeck;
  // Rangka trolley: dua balok melintang (X) di atas kedua girder, dua balok
  // samping, pelat dek, dan overhang di sisi +X yang membawa kabin.
  for (const zz of [-1.45, 1.45]) b.paint.push(rbox(2 * L + 1.4, 0.55, 0.5, 0, y0 + 0.28, zz, 0.02));
  for (const sx of [1, -1]) b.paint.push(rbox(0.5, 0.55, 3.4, sx * (L - 0.1), y0 + 0.28, 0, 0.02));
  b.paint.push(box(2 * L - 1.0, 0.08, 2.6, 0, y0 + 0.5, 0));
  // Roda trolley di rel girder.
  for (const sx of [1, -1]) for (const zz of [-1.2, 1.2]) b.dark.push(rod(0.22, 0.16, sx * (L - 0.3), y0 + 0.05, zz, 'x', 10));
  // Mesin: dua drum hoist bergalur, motor, dan gearbox (seperti gambar).
  for (const sx of [1, -1]) {
    const x = sx * 2.1;
    b.dark.push(rod(0.42, 1.7, x, y0 + 1.0, 0.55, 'x', 18));
    for (let k = -3; k <= 3; k++) b.steel.push(rod(0.43, 0.04, x + k * 0.22, y0 + 1.0, 0.55, 'x', 18));
    b.dark.push(rbox(0.9, 0.85, 0.8, x + sx * 1.35, y0 + 0.95, 0.55, 0.06));
    b.dark.push(rod(0.3, 0.7, sx * 0.55, y0 + 0.9, 0.55, 'x', 14));
    b.dark.push(rbox(0.8, 0.7, 0.9, x, y0 + 0.85, -0.85, 0.06));
    b.steel.push(rod(0.18, 0.5, x - sx * 0.6, y0 + 0.85, -0.85, 'x', 12));
  }
  // Kabin operator menggantung di luar girder +X, di bawah trolley.
  const cx = L + 1.55;
  b.paint.push(rbox(1.1, 0.5, 3.0, L + 0.9, y0 + 0.25, 0, 0.02));
  for (const zz of [-0.8, 0.8]) b.paint.push(box(0.16, D.girderTop - 19.8, 0.16, cx, (D.girderTop + 19.8) / 2 + 0.4, zz));
  b.paint.push(rbox(2.0, 2.3, 2.1, cx, 18.6, 0, 0.12));
  // Kaca: muka depan, samping, dan lantai pandang (gelap mengilap).
  b.glass.push(box(0.04, 1.3, 1.7, cx - 1.01, 18.85, 0));
  b.glass.push(box(1.5, 1.2, 0.04, cx + 0.1, 18.85, 1.06));
  b.glass.push(box(1.5, 1.2, 0.04, cx + 0.1, 18.85, -1.06));
  b.glass.push(box(1.4, 0.04, 1.5, cx - 0.1, 17.44, 0));
  b.dark.push(box(0.6, 0.35, 0.6, cx + 0.4, 20.0, 0));
  return b;
}

function buildSpreader(): Bucket {
  const b = bucket();
  const len = BOX.len20; // spreader teleskopik, posisi 20ft
  const w = BOX.width;
  // Dua balok samping, balok ujung, balok tengah teleskopik.
  for (const zz of [-1, 1]) b.paint.push(rbox(len - 0.1, 0.34, 0.26, 0, 0.32, zz * (w / 2 - 0.2), 0.02));
  for (const xx of [-1, 1]) b.paint.push(rbox(0.32, 0.36, w, xx * (len / 2 - 0.18), 0.32, 0, 0.02));
  b.paint.push(rbox(len - 0.6, 0.3, 0.5, 0, 0.42, 0, 0.02));
  // Kepala tengah: rangka penerima tali + roda puli.
  b.paint.push(rbox(2.2, 0.45, 2.0, 0, 0.75, 0, 0.03));
  for (const xx of [-0.65, 0.65]) for (const zz of [-0.6, 0.6]) b.dark.push(rod(0.18, 0.12, xx, 1.08, zz, 'z', 12));
  // Sangkar bulat di atas kepala (lihat gambar).
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.steel.push(tube([Math.cos(a) * 0.45, 0.98, Math.sin(a) * 0.45], [Math.cos(a) * 0.3, 1.75, Math.sin(a) * 0.3], 0.018, 4));
  }
  for (const [y, r] of [[1.25, 0.41], [1.75, 0.3]] as const) {
    const t = new THREE.TorusGeometry(r, 0.02, 4, 16).toNonIndexed();
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    b.steel.push(t);
  }
  // Twistlock & flipper pemandu di empat sudut.
  for (const xx of [-1, 1]) {
    for (const zz of [-1, 1]) {
      const x = xx * (len / 2 - 0.15);
      const z = zz * (w / 2 - 0.15);
      b.dark.push(rbox(0.32, 0.28, 0.32, x, 0.14, z, 0.03));
      b.dark.push(rod(0.07, 0.14, x, -0.05, z, 'y', 8));
      b.paint.push(box(0.05, 0.55, 0.45, x + xx * 0.2, 0.05, z));
    }
  }
  return b;
}

/** Tali hoist posisi diam: 8 tali dari trolley ke kepala spreader. */
function buildRopes(): THREE.BufferGeometry[] {
  const D = RTG_DETAIL;
  const out: THREE.BufferGeometry[] = [];
  const head = D.restUnder + D.spreaderHead;
  for (const xx of [-0.75, -0.55, 0.55, 0.75]) {
    for (const zz of [-0.6, 0.6]) {
      out.push(tube([xx * 2.4, D.ropeTop, zz * 1.1], [xx, head, zz], 0.022, 5));
    }
  }
  return out;
}

// --- material ------------------------------------------------------------------

let mats: Record<keyof Bucket | 'rope', THREE.Material> | null = null;
function materials() {
  if (mats) return mats;
  mats = {
    paint: new THREE.MeshPhongMaterial({ color: '#E8BF55', shininess: 28, specular: new THREE.Color('#5a4a20') }),
    steel: new THREE.MeshPhongMaterial({ color: '#C7CACD', shininess: 40, specular: new THREE.Color('#888c90') }),
    dark: new THREE.MeshPhongMaterial({ color: '#45403B', shininess: 22, specular: new THREE.Color('#2a2826') }),
    tire: new THREE.MeshPhongMaterial({ color: '#1B1C1D', shininess: 6 }),
    glass: new THREE.MeshPhongMaterial({ color: '#2B3A44', shininess: 90, specular: new THREE.Color('#9fb3c2') }),
    hazard: new THREE.MeshPhongMaterial({ map: hazardTexture(), shininess: 18 }),
    genset: new THREE.MeshPhongMaterial({ color: '#D9DBDC', shininess: 24 }),
    rope: new THREE.MeshPhongMaterial({ color: '#2E3134', shininess: 30 }),
  };
  return mats;
}

function toParts(name: string, b: Bucket): ModelPart[] {
  const m = materials();
  return (Object.keys(b) as (keyof Bucket)[])
    .filter((k) => b[k].length)
    .map((k) => ({ name: `rtgd-${name}-${k}`, geometry: merge(b[k]), material: m[k] }) as ModelPart);
}

export type RtgDetailModel = {
  frame: ModelPart[];
  trolley: ModelPart[];
  spreader: ModelPart[];
  ropes: ModelPart[];
};

const frameCache = new Map<string, ModelPart[]>();
let moving: Omit<RtgDetailModel, 'frame'> | null = null;

/** Model untuk rel di ±railZ. Rangka di-cache per lebar (dibulatkan 0,1 m). */
export function rtgDetailModel(railZ: number): RtgDetailModel {
  const key = railZ.toFixed(1);
  let frame = frameCache.get(key);
  if (!frame) {
    frame = toParts(`frame-${key}`, buildFrame(Number(key)));
    frameCache.set(key, frame);
  }
  if (!moving) {
    moving = {
      trolley: toParts('trolley', buildTrolley()),
      spreader: toParts('spreader', buildSpreader()),
      ropes: [{ name: 'rtgd-ropes', geometry: merge(buildRopes()), material: materials().rope } as ModelPart],
    };
  }
  return { frame, ...moving };
}

/** Jumlah segitiga satu RTG (README / uji). */
export function rtgDetailTriangles(railZ = rtgDetailRailZ(6 * PITCH.row)): number {
  const m = rtgDetailModel(railZ);
  return [...m.frame, ...m.trolley, ...m.spreader, ...m.ropes].reduce(
    (n, p) => n + (p.geometry.getIndex()?.count ?? p.geometry.getAttribute('position').count) / 3,
    0,
  );
}
