import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX } from './constants';
import { TARGET_LINEAR, type InstancedModel, type ModelPart } from './containerModel';
import { REAL_PAINT } from './realisticPaint';
import { BUILTIN_LOGO, FALLBACK_LIVERIES, SIDE_LAYOUT, liveryKey, type Livery } from './livery';
import { addZone, glyphTexture, MAP, MAX_ZONE_SLOTS, MAX_ZONES, SLOT_ASPECT, zoneUniforms, type CodeZone } from './containerCode';


/**
 * Kontainer GP realistis berlivery Maersk Line — duplikat BARU di samping
 * aset GLB lama (aset lama tidak diubah; pilih lewat "Kontainer realistis").
 *
 * Yang membuatnya halus dan mirip aslinya:
 *   - gelombang trapesium dinding/atap/pintu dengan tikungan DIBULATKAN
 *     (corner cutting) dan normal halus per titik profil, jadi pantulan
 *     cahayanya mengalir seperti pelat baja tekuk, bukan bidang patah;
 *   - penyok halus pada panel, supaya tidak tampak seperti cetakan sempurna;
 *   - rangka (rel, tiang, header, sill, casting) dari balok bersudut tumpul;
 *   - pintu seperti foto acuan: daun berpanel tekan horizontal, karet hitam
 *     keliling bukaan, 4 batang kunci dengan cam keeper, gagang, kotak segel,
 *     engsel blade; ventilasi di dinding samping; kantong forklift (20ft);
 *   - livery Maersk: badan abu-abu, logo bintang putih dalam kotak teal,
 *     MAERSK hitam lebar, kode MSKU dengan check digit ISO 6346 yang benar,
 *     kode ukuran-jenis, tabel berat, stiker bahaya, dan plat CSC.
 *
 * Dua varian, seperti aset GLB: `tint` (cat netral, warna line/status dari
 * instanceColor) dan `plain` (abu-abu Maersk aslinya).
 */

export { REAL_PAINT };

/** Livery bawaan kalau pemanggil tidak menyebut livery: Maersk (perilaku lama). */
const MAERSK = FALLBACK_LIVERIES.liveries.find((l) => l.code === 'MAERSK_GP')!;

/** Check digit ISO 6346 — kontainer asli selalu konsisten, jadi ini juga. */
export function isoCheckDigit(code10: string): number {
  const val = (ch: string) => {
    if (/\d/.test(ch)) return Number(ch);
    // A=10, lalu lompati kelipatan 11.
    let v = 10;
    for (let c = 65; c < ch.charCodeAt(0); c++) {
      v++;
      if (v % 11 === 0) v++;
    }
    return v;
  };
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += val(code10[i]) * 2 ** i;
  return (sum % 11) % 10;
}

export type ContainerStyle = 'real' | 'asset';

// --- profil gelombang -------------------------------------------------------

export type P = { s: number; off: number; ns: number; no: number };

/**
 * Profil gelombang trapesium sepanjang [a, b], tikungannya dibulatkan dengan
 * corner cutting, lengkap dengan normal 2D halus per titik.
 * off 0 = lembah, `depth` = puncak (paling luar).
 */
function corrugation(a: number, b: number, pitch: number, depth: number, rounds = 1): P[] {
  const n = Math.max(1, Math.round((b - a) / pitch));
  const p = (b - a) / n;
  let pts: [number, number][] = [[a, depth]];
  for (let i = 0; i < n; i++) {
    const s = a + i * p;
    pts.push([s + 0.3 * p, depth], [s + 0.47 * p, 0], [s + 0.83 * p, 0], [s + p, depth]);
  }
  // Corner cutting (Chaikin dengan potongan 0,22): flat tetap lebar, tikungan membulat.
  const cut = 0.22;
  for (let r = 0; r < rounds; r++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [s0, o0] = pts[i];
      const [s1, o1] = pts[i + 1];
      next.push([s0 + (s1 - s0) * cut, o0 + (o1 - o0) * cut], [s0 + (s1 - s0) * (1 - cut), o0 + (o1 - o0) * (1 - cut)]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return profileNormals(pts);
}

/** Normal 2D halus per titik profil [posisi, offset keluar]. */
export function profileNormals(pts: [number, number][]): P[] {
  return pts.map(([s, off], i) => {
    const [sa, oa] = pts[Math.max(0, i - 1)];
    const [sb, ob] = pts[Math.min(pts.length - 1, i + 1)];
    let ns = -(ob - oa);
    let no = sb - sa;
    const len = Math.hypot(ns, no) || 1;
    ns /= len;
    no /= len;
    return { s, off, ns, no };
  });
}

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

type SheetSpec = {
  pts: P[];
  t0: number;
  t1: number;
  /** Jumlah potongan sepanjang t (untuk penyok). */
  tSeg: number;
  at: (s: number, t: number, off: number) => Vec3;
  uv: (s: number, t: number) => Vec2;
  /** Arah s bertambah dan arah keluar, ruang kontainer. */
  sAxis: THREE.Vector3;
  outward: THREE.Vector3;
  /** Penyok halus (meter, ke dalam bernilai negatif). */
  dent?: (s: number, t: number) => number;
  /** Koordinat atlas marka; tanpa ini lembaran tidak bermarka. */
  decal?: (s: number, t: number) => Vec2;
};

/** Lembaran bergelombang dengan normal halus dari profil. */
export function sheet(o: SheetSpec): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const dUvs: number[] = [];
  const n3 = (p: P) => o.sAxis.clone().multiplyScalar(p.ns).addScaledVector(o.outward, p.no).normalize();
  const vert = (p: P, t: number) => {
    const d = o.dent ? o.dent(p.s, t) : 0;
    pos.push(...o.at(p.s, t, p.off + d));
    const n = n3(p);
    nor.push(n.x, n.y, n.z);
    uvs.push(...o.uv(p.s, t));
    dUvs.push(...(o.decal ? o.decal(p.s, t) : NO_DECAL));
  };
  // Urutan segitiga ditentukan sekali dari satu sel: semua sel sejajar.
  const a = new THREE.Vector3(...o.at(o.pts[0].s, o.t0, o.pts[0].off));
  const b = new THREE.Vector3(...o.at(o.pts[1].s, o.t0, o.pts[1].off));
  const c = new THREE.Vector3(...o.at(o.pts[1].s, o.t1, o.pts[1].off));
  const flip = b.clone().sub(a).cross(c.clone().sub(a)).dot(o.outward) < 0;
  for (let j = 0; j < o.tSeg; j++) {
    const ta = o.t0 + ((o.t1 - o.t0) * j) / o.tSeg;
    const tb = o.t0 + ((o.t1 - o.t0) * (j + 1)) / o.tSeg;
    for (let i = 0; i < o.pts.length - 1; i++) {
      const p0 = o.pts[i];
      const p1 = o.pts[i + 1];
      const quad: [P, number][] = flip
        ? [[p0, ta], [p1, tb], [p1, ta], [p0, ta], [p0, tb], [p1, tb]]
        : [[p0, ta], [p1, ta], [p1, tb], [p0, ta], [p1, tb], [p0, tb]];
      for (const [p, t] of quad) vert(p, t);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('decalUv', new THREE.Float32BufferAttribute(dUvs, 2));
  return g;
}

/**
 * Titik atlas yang dijamin kosong: pojok kiri atas area dinding samping, di
 * atas tiang sudut depan, tidak pernah digambari. (Pojok kanan bawah dipakai
 * reefer untuk muka mesinnya.) Bagian cat tanpa marka menunjuk ke sini.
 */
export const NO_DECAL: Vec2 = [0.002, 0.998];

/** Beri atribut decalUv kosong pada geometri cat yang belum punya. */
export function plainDecal(g: THREE.BufferGeometry) {
  if (!g.getAttribute('decalUv')) {
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      a[i * 2] = NO_DECAL[0];
      a[i * 2 + 1] = NO_DECAL[1];
    }
    g.setAttribute('decalUv', new THREE.BufferAttribute(a, 2));
  }
  return g;
}

/**
 * Balok bersudut tumpul (rangka): 6 muka + 12 strip tepi + 8 segitiga sudut =
 * 44 segitiga. Normal tiap vertex = arah dari "inti" balok (balok dikurangi
 * jari-jari), sama dengan titik singgung permukaan membulat, jadi strip
 * tepinya diarsir melengkung — tampak sama dengan RoundedBoxGeometry
 * (108 segitiga) yang dipakai sebelumnya. Rangka satu kontainer berisi
 * ±40 balok seperti ini: 4.300 → 1.800 segitiga.
 */
export function rbox(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.012) {
  const rr = Math.min(r, w / 2.2, h / 2.2, d / 2.2);
  const g = chamferBox(w, h, d, rr);
  g.translate(x, y, z);
  return g;
}

type V3 = [number, number, number];
function chamferBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const half: V3 = [w / 2, h / 2, d / 2];
  const core: V3 = [half[0] - r, half[1] - r, half[2] - r];
  const pos: number[] = [];
  const nor: number[] = [];
  const uvs: number[] = [];
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  const push = (p: V3) => {
    let nx = p[0] - clamp(p[0], core[0]);
    let ny = p[1] - clamp(p[1], core[1]);
    let nz = p[2] - clamp(p[2], core[2]);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    pos.push(p[0], p[1], p[2]);
    nor.push(nx, ny, nz);
    // Peta cat (belang halus) diproyeksikan seadanya: isinya derau lembut,
    // arah proyeksi tidak terlihat.
    uvs.push((p[0] + p[2]) / 6 + 0.5, (p[1] + p[2] * 0.3) / 2.6 + 0.5);
  };
  const tri = (p0: V3, p1: V3, p2: V3) => {
    // Hadap keluar: normal segitiga searah titik beratnya (balok di pusat).
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = p0[0] + p1[0] + p2[0], cy = p0[1] + p1[1] + p2[1], cz = p0[2] + p1[2] + p2[2];
    if (nx * cx + ny * cy + nz * cz < 0) [p1, p2] = [p2, p1];
    push(p0);
    push(p1);
    push(p2);
  };
  const quad = (p0: V3, p1: V3, p2: V3, p3: V3) => {
    tri(p0, p1, p2);
    tri(p0, p2, p3);
  };
  const at = (i: number, vi: number, j: number, vj: number, k: number, vk: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[i] = vi;
    p[j] = vj;
    p[k] = vk;
    return p;
  };
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const k = (i + 2) % 3;
    for (const s of [1, -1]) {
      // Muka: persegi yang menjorok r dari tepi, di koordinat s*half[i].
      quad(
        at(i, s * half[i], j, -core[j], k, -core[k]),
        at(i, s * half[i], j, core[j], k, -core[k]),
        at(i, s * half[i], j, core[j], k, core[k]),
        at(i, s * half[i], j, -core[j], k, core[k]),
      );
      // Strip tepi antara muka i (s) dan muka j (t), memanjang sepanjang k.
      for (const t of [1, -1]) {
        quad(
          at(i, s * half[i], j, t * core[j], k, -core[k]),
          at(i, s * half[i], j, t * core[j], k, core[k]),
          at(i, s * core[i], j, t * half[j], k, core[k]),
          at(i, s * core[i], j, t * half[j], k, -core[k]),
        );
      }
    }
  }
  // Sudut: segitiga penutup antara tiga ujung strip.
  for (const sx of [1, -1])
    for (const sy of [1, -1])
      for (const sz of [1, -1])
        tri(
          [sx * half[0], sy * core[1], sz * core[2]],
          [sx * core[0], sy * half[1], sz * core[2]],
          [sx * core[0], sy * core[1], sz * half[2]],
        );
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** Balok kecil biasa (perangkat keras yang tak perlu dibulatkan). */
export function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

export function rod(r: number, h: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1).toNonIndexed();
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/**
 * Gabungkan bagian-bagian lalu LAS vertex yang sama (posisi, normal, UV
 * identik) menjadi geometri BERINDEKS. Bagian-bagiannya dibangun tanpa indeks
 * (tiap segitiga vertexnya sendiri), jadi tanpa pengelasan satu kontainer
 * ~8.000 segitiga = ~24.000 vertex shader per instance; dengan 700 kontainer
 * detail itu ±17 juta vertex per frame dan kamera tersendat (terukur 90 ms
 * per frame, bukan karena piksel: di layar seperempat tetap 88 ms). Berindeks,
 * vertex yang dipakai beberapa segitiga dihitung sekali dan GPU memakai cache
 * vertex-nya — seperti aset GLB lama.
 */
export const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeVertices(mergeGeometries(parts, false)!);
  g.computeBoundingSphere();
  return g;
};

/** Jumlah segitiga satu geometri, berindeks atau tidak. */
export const triangleCount = (g: THREE.BufferGeometry) =>
  (g.getIndex()?.count ?? g.getAttribute('position').count) / 3;

// --- atlas marka ------------------------------------------------------------

/** Atlas marka: atas = dinding samping (panjang × tinggi), bawah-kiri = pintu. */
export type Atlas = { w: number; h: number; side: number; doorW: number; doorH: number };

function atlasFor(length: number): Atlas {
  // 40ft diberi kanvas lebih lebar supaya huruf kecilnya setajam 20ft.
  const w = length > 9 ? 3072 : 2048;
  const side = Math.round((w * BOX.height) / length);
  const doorH = 1024;
  const doorW = Math.round((doorH * BOX.width) / BOX.height);
  return { w, h: side + doorH, side, doorW, doorH };
}

export const sideUv = (A: Atlas) => (u01: number, t01: number): Vec2 => [u01, 1 - ((1 - t01) * A.side) / A.h];
export const doorUv = (A: Atlas) => (u01: number, t01: number): Vec2 => [
  (u01 * A.doorW) / A.w,
  1 - (A.side + (1 - t01) * A.doorH) / A.h,
];

export const NARROW = "'Arial Narrow', 'Roboto Condensed', Arial, sans-serif";

export const INK = '#1c1e20';
const TEAL = '#2ba3bf';

/** Bintang tujuh Maersk, titik ke atas. */
function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, R: number) {
  const r = R * 0.34;
  g.beginPath();
  for (let i = 0; i < 14; i++) {
    const ang = -Math.PI / 2 + (i * Math.PI) / 7;
    const rad = i % 2 === 0 ? R : r;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Logo Maersk: kotak teal bersudut bulat, bingkai putih, bintang putih. (cx, cy) pusat. */
function drawLogo(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  g.save();
  const x = cx - size / 2;
  const y = cy - size / 2;
  roundRect(g, x, y, size, size, size * 0.12);
  g.fillStyle = '#ffffff';
  g.fill();
  const b = size * 0.035;
  roundRect(g, x + b, y + b, size - 2 * b, size - 2 * b, size * 0.1);
  g.fillStyle = TEAL;
  g.fill();
  starPath(g, cx, cy + size * 0.02, size * 0.4);
  g.fillStyle = '#ffffff';
  g.fill();
  g.restore();
}

/** Tabel berat di pintu: label kiri, dua kolom angka rata kanan. */
export function drawWeightTable(
  g: CanvasRenderingContext2D,
  rows: [string, string, string][],
  x0: number,
  xB: number,
  xC: number,
  y0: number,
  h: number,
  step: number,
) {
  g.font = `bold ${h}px ${NARROW}`;
  g.textBaseline = 'top';
  rows.forEach(([a, b, c], i) => {
    const y = y0 + i * step;
    g.textAlign = 'left';
    g.fillText(a, x0, y);
    g.textAlign = 'right';
    g.fillText(b, xB, y);
    g.fillText(c, xC, y);
  });
  g.textAlign = 'left';
}

/**
 * Kode pemilik + nomor seri + check digit dalam kotak — NOMOR ASLI tiap
 * kontainer. Hurufnya digambar shader per instance (lihat containerCode.ts);
 * di atlas hanya kotak check digit-nya dan zona tempat huruf akan muncul.
 */
export function drawCode(
  g: CanvasRenderingContext2D,
  zones: CodeZone[],
  x: number,
  y: number,
  h: number,
  alignRight: boolean,
) {
  const cw = MAP.ownerSerial.length * h * SLOT_ASPECT;
  const bw = h * 0.82;
  const gap = h * 0.3;
  const x0 = alignRight ? x - cw - gap - bw : x;
  addZone(zones, x0, y, h, MAP.ownerSerial);
  g.lineWidth = Math.max(2, h * 0.09);
  g.strokeRect(x0 + cw + gap, y - h * 0.06, bw, h * 1.08);
  addZone(zones, x0 + cw + gap + bw / 2, y, h, MAP.check, 'center');
  return { x0, x1: x0 + cw + gap + bw };
}

/** MAERSK: huruf tebal, diregangkan melebar seperti logotype aslinya. */
const BRAND_FONT = "900 PXpx 'Arial Black', 'Segoe UI Black', Arial, sans-serif";
const BRAND_STRETCH = 1.22;

export function brandWidth(g: CanvasRenderingContext2D, text: string, h: number, spacing: number) {
  g.font = BRAND_FONT.replace('PX', String(h));
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width * BRAND_STRETCH + spacing;
  return w - spacing;
}
export function drawBrand(
  g: CanvasRenderingContext2D,
  text: string,
  color: string,
  x: number,
  cy: number,
  h: number,
  spacing: number,
) {
  g.save();
  g.font = BRAND_FONT.replace('PX', String(h));
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    g.save();
    g.translate(cx, cy);
    g.scale(BRAND_STRETCH, 1);
    g.fillText(ch, 0, 0);
    g.restore();
    cx += g.measureText(ch).width * BRAND_STRETCH + spacing;
  }
  g.restore();
}

/** Logo dari berkas yang digambar menyusul setelah gambarnya termuat. */
/**
 * Logo berkas yang digambar menyusul setelah termuat: dimuatkan (contain) ke
 * kotak w×h berpusat di (cx, cy). `body` = cat badan, untuk memutuskan perlu
 * tidaknya papan latar.
 */
export type PendingLogo = {
  file: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  body: string;
  /** Potongan gambar yang dipakai, pecahan 0–1 [x, y, w, h] dari logo terpangkas. */
  crop?: [number, number, number, number];
};

/**
 * Logo + teks merek di dinding samping, diperkecil bila tidak muat di antara
 * kedua tiang sudut. Logo bawaan (bintang Maersk) digambar langsung; logo
 * berkas dicatat di `pending` untuk digambar setelah termuat.
 */
export function drawSideBrand(
  g: CanvasRenderingContext2D,
  liv: Livery,
  length: number,
  m: (v: number) => number,
  pending: PendingLogo[],
  zones?: CodeZone[],
) {
  const H = BOX.height;
  const is40 = length > 9;
  if (SIDE_LAYOUT[liv.code] === 'kline-center') {
    drawKLine(g, length, m, zones, liv.textColor, liv.bodyColor);
    return;
  }
  if (SIDE_LAYOUT[liv.code] === 'spil-stripe') {
    drawStripe(g, length, m, pending, {
      webColor: liv.textColor,
      lightBody: isLight(liv.bodyColor),
      letters: 'SPIL',
      letterColor: '#B5202A',
      letterFont: "700 PXpx 'Trebuchet MS', 'Segoe UI', Arial, sans-serif",
      web: 'www.spil.co.id',
    });
    return;
  }
  if (SIDE_LAYOUT[liv.code] === 'tanto-stripe') {
    drawStripe(g, length, m, pending, {
      webColor: liv.textColor,
      lightBody: isLight(liv.bodyColor),
      letters: 'TANTO',
      letterColor: '#1B3A80',
      letterFont: "900 PXpx 'Arial Black', Arial, 'Segoe UI', sans-serif",
      web: 'www.tantonet.com',
      // Bendera = bagian atas berkas logo (bagian bawahnya tulisan TANTO yang
      // di sini digambar sendiri supaya memenuhi tinggi pita).
      flag: liv.logoFile ? { file: liv.logoFile, crop: [0, 0, 1, 0.38], h: 0.5 } : undefined,
    });
    return;
  }
  if (SIDE_LAYOUT[liv.code] === 'ctp-stripe') {
    drawStripe(g, length, m, pending, {
      webColor: liv.textColor,
      lightBody: isLight(liv.bodyColor),
      letters: 'CTP',
      letterColor: '#1E2F6E',
      letterFont: "700 PXpx Georgia, 'Times New Roman', serif",
      emblem: { draw: drawCtpEmblem, h: 0.36 },
    });
    return;
  }
  if (SIDE_LAYOUT[liv.code] === 'seaco-top') {
    drawSeaco(g, length, m);
    return;
  }
  if (SIDE_LAYOUT[liv.code] === 'seaco-reefer') {
    drawSeaco(g, length, m, { color: '#E2141B', px: is40 ? 0.8 : 0.62, x: is40 ? 1.5 : 0.75, y: 0.4 });
    return;
  }
  if (SIDE_LAYOUT[liv.code] === 'meratus-top') {
    drawMeratusTop(g, length, m, liv.textColor);
    return;
  }
  // Berkas logo dari master didahulukan; bintang bawaan hanya cadangan
  // kalau livery Maersk belum diberi berkas.
  const builtin = liv.logoFile ? undefined : BUILTIN_LOGO[liv.code];
  const hasLogo = liv.logoPos !== 'NONE' && (!!builtin || !!liv.logoFile);
  const text = liv.brandText;
  const avail = m(length - 2 * 0.55);
  const cy = m(H * 0.5);

  // Logo berkas TANPA teks merek: biasanya logo lengkap yang sudah memuat
  // tulisannya sendiri (bintang + MAERSK, MERATUS + simbol) dan bentuknya
  // lebar. Diberi kotak selebar dinding, tingginya dari logo_scale — bukan
  // kotak persegi yang membuat logo lebar mengecil.
  if (hasLogo && !builtin && !text && liv.logoFile) {
    const h = m(H * (is40 ? liv.logoScale : liv.logoScale * 0.9));
    pending.push({ file: liv.logoFile, cx: m(length / 2), cy, w: avail * 0.8, h, body: liv.bodyColor });
    return;
  }

  let logo = hasLogo ? m(H * (is40 ? liv.logoScale : liv.logoScale * 0.9)) : 0;
  let textH = text ? m(H * (is40 ? 0.36 : 0.3)) : 0;
  let gap = hasLogo && text ? logo * (is40 ? 0.42 : 0.3) : 0;
  let spacing = textH * 0.16;
  const tw = () => (text ? brandWidth(g, text, textH, spacing) : 0);
  let total = logo + gap + tw();
  if (total > avail) {
    const k = avail / total;
    logo *= k;
    textH *= k;
    gap *= k;
    spacing *= k;
    total = logo + gap + tw();
  }
  const lx = m(length / 2) - total / 2;
  const logoFirst = liv.logoPos !== 'RIGHT';
  const logoCx = logoFirst ? lx + logo / 2 : lx + total - logo / 2;
  const textX = logoFirst ? lx + logo + gap : lx;
  if (hasLogo) {
    if (builtin === 'maersk-star') drawLogo(g, logoCx, cy, logo);
    else if (liv.logoFile) pending.push({ file: liv.logoFile, cx: logoCx, cy, w: logo, h: logo, body: liv.bodyColor });
  }
  if (text) drawBrand(g, text, liv.textColor, textX, cy + textH * 0.04, textH, spacing);
}

/** Lebar pita SPIL dan jaraknya dari tiang sudut kiri (meter). */
const SPIL_STRIPE = { w: 0.5, fromLeft: 0.62 };

/** Warna terang (luminansi relatif > 0,6), mis. badan reefer putih. */
function isLight(hex: string) {
  const v = hex.replace('#', '');
  return relLum(parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)) > 0.6;
}

type StripeOpts = {
  letters: string;
  letterColor: string;
  /** Font dengan placeholder PX untuk ukuran piksel. */
  letterFont: string;
  web?: string;
  /** Bendera/lambang di puncak pita, dari berkas logo (opsional dipotong). */
  flag?: { file: string; crop: [number, number, number, number]; h: number };
  /** Warna alamat web (warna tulisan livery). */
  webColor: string;
  /** Badan berwarna terang (reefer putih): pita putih diberi garis tepi. */
  lightBody: boolean;
  /** Lambang di puncak pita yang digambar di kode (tanpa berkas). */
  emblem?: { draw: (g: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void; h: number };
};

/**
 * Pita putih tegak setinggi dinding di ujung KIRI dinding samping (atlas
 * terbaca kiri→kanan di kedua sisi), berisi huruf bertumpuk — SPIL merah,
 * TANTO navy di bawah benderanya — dan alamat web putih di atas, di kanan
 * pita. Sesuai foto kontainer asli. y = meter dari atas.
 */
function drawStripe(
  g: CanvasRenderingContext2D,
  length: number,
  m: (v: number) => number,
  pending: PendingLogo[],
  o: StripeOpts,
) {
  const H = BOX.height;
  const x0 = m(SPIL_STRIPE.fromLeft);
  const x1 = x0 + m(SPIL_STRIPE.w);
  const top = m(0.16);
  const bot = m(H - 0.16);
  const STRIPE = '#F4F4F2';
  g.save();
  g.fillStyle = STRIPE;
  g.fillRect(x0, top, x1 - x0, bot - top);
  if (o.lightBody) {
    g.strokeStyle = '#C3C7CB';
    g.lineWidth = m(0.015);
    g.strokeRect(x0, top, x1 - x0, bot - top);
  }
  let lettersTop = top;
  if (o.flag) {
    const fh = m(o.flag.h);
    pending.push({
      file: o.flag.file,
      cx: (x0 + x1) / 2,
      cy: top + m(0.06) + fh / 2,
      w: (x1 - x0) * 0.86,
      h: fh,
      body: STRIPE,
      crop: o.flag.crop,
    });
    lettersTop = top + m(0.12) + fh;
  } else if (o.emblem) {
    const eh = m(o.emblem.h);
    o.emblem.draw(g, (x0 + x1) / 2, top + m(0.08) + eh / 2, eh);
    lettersTop = top + m(0.14) + eh;
  }
  // Huruf bertumpuk, tersebar merata sepanjang sisa pita.
  const letters = [...o.letters];
  const slot = (bot - lettersTop) / letters.length;
  const h = Math.min(slot * 0.78, (x1 - x0) * 1.05);
  g.fillStyle = o.letterColor;
  g.textAlign = 'center';
  g.font = o.letterFont.replace('PX', String(h));
  // Tengah huruf diukur dari bentuknya, bukan baseline 'middle' (yang membuat
  // L menempel ke rel bawah). Baseline diatur SEBELUM mengukur: ukuran
  // bergantung padanya, dan sisa 'top' dari gambar sebelumnya menggeser
  // huruf pertama.
  g.textBaseline = 'alphabetic';
  letters.forEach((ch, i) => {
    const t = g.measureText(ch);
    const mid = (t.actualBoundingBoxAscent - t.actualBoundingBoxDescent) / 2;
    g.fillText(ch, (x0 + x1) / 2, lettersTop + slot * (i + 0.5) + mid);
  });
  if (o.web) {
    g.fillStyle = o.webColor;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.font = `600 ${m(0.17)}px 'Segoe UI', Arial, sans-serif`;
    g.fillText(o.web, x1 + m(0.4), m(0.3));
  }
  g.restore();
}

/**
 * K LINE: seperti foto kontainer asli — “K” besar bertanda kutip dan LINE
 * putih bergaya serif di tengah, bendera putih kecil berlambang K merah di
 * kiri atas, kode ukuran (2 digit pertama kode ISO, per kontainer) di
 * kiri atas, dan www.kline.com di atas, di kiri nomor kontainer.
 */
function drawKLine(
  g: CanvasRenderingContext2D,
  length: number,
  m: (v: number) => number,
  zones: CodeZone[] | undefined,
  /** Warna tulisan & bendera: putih di GP merah, merah di reefer putih. */
  ink: string,
  /** Warna lambang K di bendera = warna badan (kebalikan bendera). */
  body: string,
) {
  const H = BOX.height;
  const is40 = length > 9;
  const SERIF = "Georgia, 'Times New Roman', 'Book Antiqua', serif";
  g.save();
  g.fillStyle = ink;
  g.textBaseline = 'alphabetic';

  // “K” LINE — huruf K lebih besar, alasnya sejajar dengan LINE.
  const kH = m(is40 ? 0.95 : 0.72);
  const lineH = kH * 0.66;
  const lineSp = lineH * 0.22;
  g.font = `700 ${kH}px ${SERIF}`;
  const kW = g.measureText('K').width;
  g.font = `700 ${lineH * 0.5}px ${SERIF}`;
  const qW = g.measureText('\u201C').width;
  g.font = `700 ${lineH}px ${SERIF}`;
  const lW = [...'LINE'].reduce((w, ch) => w + g.measureText(ch).width, 0) + lineSp * 3;
  const gap = kH * 0.32;
  const total = qW + kW + qW + gap + lW;
  // Sedikit ke kiri dari tengah, seperti di foto.
  let x = m(length * (is40 ? 0.46 : 0.48)) - total / 2;
  const base = m(H * 0.5) + kH * 0.36;
  g.font = `700 ${lineH * 0.5}px ${SERIF}`;
  g.fillText('\u201C', x, base - kH * 0.58);
  x += qW;
  g.font = `700 ${kH}px ${SERIF}`;
  g.fillText('K', x, base);
  x += kW;
  g.font = `700 ${lineH * 0.5}px ${SERIF}`;
  g.fillText('\u201D', x, base - kH * 0.58);
  x += qW + gap;
  g.font = `700 ${lineH}px ${SERIF}`;
  for (const ch of 'LINE') {
    g.fillText(ch, x, base);
    x += g.measureText(ch).width + lineSp;
  }

  // Bendera putih kecil, tepi berkibar, lambang K merah.
  const fx = m(is40 ? 1.25 : 0.95);
  const fy = m(0.42);
  const fw = m(0.42);
  const fh = m(0.27);
  g.beginPath();
  g.moveTo(fx, fy);
  g.quadraticCurveTo(fx + fw * 0.5, fy - fh * 0.12, fx + fw, fy + fh * 0.04);
  g.lineTo(fx + fw, fy + fh * 1.04);
  g.quadraticCurveTo(fx + fw * 0.5, fy + fh * 0.88, fx, fy + fh);
  g.closePath();
  g.fill();
  g.fillStyle = body;
  g.font = `700 ${fh * 0.62}px ${SERIF}`;
  g.textAlign = 'center';
  g.fillText('K', fx + fw * 0.5, fy + fh * 0.72);
  g.textAlign = 'left';
  g.fillStyle = ink;

  // Kode ukuran: dua digit pertama kode ISO kontainer ITU (45, 22, ...).
  if (zones) addZone(zones, m(0.38), m(0.4), m(0.2), [11, 12]);

  // Alamat web di atas, di kiri nomor kontainer.
  g.font = `600 ${m(0.13)}px 'Segoe UI', Arial, sans-serif`;
  g.textAlign = 'right';
  g.textBaseline = 'top';
  g.fillText('www.kline.com', m(length - (is40 ? 1.9 : 1.75)), m(0.3));
  g.restore();
}

/**
 * Lambang bulat CTP di puncak pita: cincin navy dengan sapuan biru di
 * dalamnya (versi sederhana dari foto; bentuk resminya belum ada berkasnya).
 */
function drawCtpEmblem(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const r = size / 2;
  g.save();
  g.strokeStyle = '#1E2F6E';
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.arc(cx, cy, r * 0.88, 0, Math.PI * 2);
  g.stroke();
  // Sapuan: bulan sabit biru, terbuka ke kanan.
  g.fillStyle = '#2E6FC2';
  g.beginPath();
  g.arc(cx, cy, r * 0.62, Math.PI * 0.25, Math.PI * 1.75);
  g.arc(cx + r * 0.22, cy, r * 0.42, Math.PI * 1.6, Math.PI * 0.4, true);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * SEACO: "seaco" kuning, huruf kecil tebal membulat, di kiri atas dinding —
 * seperti foto kontainer asli (nomornya di kanan atas tetap).
 */
/**
 * `o`: varian lain logo yang sama — reefer Seaco memakai "seaco" MERAH yang
 * lebih besar di badan putih (foto reefer Seaco). Ukuran & posisi dalam meter.
 */
function drawSeaco(
  g: CanvasRenderingContext2D,
  length: number,
  m: (v: number) => number,
  o?: { color: string; px: number; x: number; y: number },
) {
  const is40 = length > 9;
  g.save();
  g.fillStyle = o?.color ?? '#F2C200';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  // Tinggi huruf kecil (x-height) ±0,2 m di 20ft, sedikit lebih besar di 40ft.
  const px = m(o?.px ?? (is40 ? 0.52 : 0.46));
  g.font = `800 ${px}px 'Arial Rounded MT Bold', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
  g.fillText('seaco', m(o?.x ?? (is40 ? 0.75 : 0.55)), m(o?.y ?? 0.42) + px * 0.72);
  g.restore();
}

/**
 * MERATUS: tulisan putih tebal melebar di pita atas dinding, agak ke kiri,
 * diikuti simbol roda (cincin balok kecil) — seperti foto kontainer asli.
 */
function drawMeratusTop(g: CanvasRenderingContext2D, length: number, m: (v: number) => number, color: string) {
  const is40 = length > 9;
  const h = m(is40 ? 0.3 : 0.26);
  const spacing = h * 0.05;
  const tw = brandWidth(g, 'MERATUS', h, spacing);
  const r = h * 0.48;
  const gap = h * 0.22;
  const total = tw + gap + 2 * r;
  const cx = m(length * (is40 ? 0.3 : 0.38));
  const x = cx - total / 2;
  const cy = m(0.5);
  drawBrand(g, 'MERATUS', color, x, cy + h * 0.04, h, spacing);
  // Simbol roda: 8 balok kecil mengelilingi pusat, bergantian maju-mundur.
  const sx = x + tw + gap + r;
  const sy = cy - h * 0.12;
  g.save();
  g.fillStyle = color;
  for (let i = 0; i < 8; i++) {
    g.save();
    g.translate(sx, sy);
    g.rotate((i * Math.PI) / 4);
    const out = i % 2 === 0 ? r * 0.62 : r * 0.5;
    g.fillRect(-r * 0.17, -out - r * 0.2, r * 0.34, r * 0.4);
    g.restore();
  }
  g.restore();
}

function drawMarkings(
  length: number,
  A: Atlas,
  liv: Livery,
): { canvas: HTMLCanvasElement; zones: CodeZone[]; pending: PendingLogo[] } {
  const zones: CodeZone[] = [];
  const pending: PendingLogo[] = [];
  const cv = document.createElement('canvas');
  cv.width = A.w;
  cv.height = A.h;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, A.w, A.h);
  const INK = liv.textColor;
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.textBaseline = 'top';

  const is40 = length > 9;
  const H = BOX.height;

  // ---- dinding samping (meter → px). Kiri kanvas = ujung depan, kanan = pintu.
  const k = A.w / length;
  const m = (v: number) => v * k;

  // Kode pemilik kecil di kanan atas, dekat ujung pintu.
  const codeH = m(0.11);
  const right = m(length - 0.4);
  drawCode(g, zones, right, m(0.28), codeH, true);
  addZone(zones, right, m(0.28) + codeH * 1.4, codeH, MAP.iso, 'right');

  // Logo + teks merek dari livery (Maersk: bintang teal + MAERSK hitam).
  // Diperkecil otomatis bila tidak muat: kontainer 20ft hanya 6 m.
  drawSideBrand(g, liv, length, m, pending, zones);

  // Marka kecil kiri bawah.
  g.fillStyle = INK;
  g.font = `bold ${m(0.05)}px ${NARROW}`;
  // Digeser ke kanan pita bila ada tata letak khusus (pita SPIL di kiri).
  const acepX = SIDE_LAYOUT[liv.code]?.endsWith('stripe') ? m(SPIL_STRIPE.fromLeft + SPIL_STRIPE.w + 0.3) : m(0.4);
  g.fillText(`ACEP DK-ML-${is40 ? '40' : '20'}-2209`, acepX, m(H - 0.42));

  // ---- muka pintu (kiri kanvas = +Z, dilihat dari belakang)
  const W = BOX.width;
  const dx = (zFromLeft: number) => (zFromLeft / W) * A.doorW;
  const dy = (mFromTop: number) => A.side + (mFromTop / H) * A.doorH;
  const ds = (v: number) => (v / H) * A.doorH;

  // Daun kanan, atas: kode pemilik & ukuran-jenis.
  g.fillStyle = INK;
  g.strokeStyle = INK;
  const dc = drawCode(g, zones, dx(1.36), dy(0.4), ds(0.11), false);
  addZone(zones, dc.x0 + ds(0.42), dy(0.56), ds(0.11), MAP.iso);

  // Daun kanan, di bawah pita atas: tabel berat.
  const rows: [string, string, string][] = is40
    ? [
        ['GROSS WT', '67.200', '30.480'],
        ['PAYLOAD', '58.930', '26.730'],
        ['TARE WT', '8.270', '3.750'],
        ['CUBE', '2.390', '67.7'],
      ]
    : [
        ['GROSS WT', '67.200', '30.480'],
        ['PAYLOAD', '62.280', '28.250'],
        ['TARE WT', '4.920', '2.230'],
        ['CUBE', '1.172', '33.2'],
      ];
  drawWeightTable(g, rows, dx(1.4), dx(1.86), dx(2.16), dy(1.12), ds(0.052), ds(0.07));

  // Daun kanan, bawah: stiker oranye (wajik) dan segitiga kuning.
  const dcx = dx(1.62);
  const dcy = dy(1.86);
  const dr = ds(0.12);
  g.beginPath();
  g.moveTo(dcx, dcy - dr);
  g.lineTo(dcx + dr, dcy);
  g.lineTo(dcx, dcy + dr);
  g.lineTo(dcx - dr, dcy);
  g.closePath();
  g.fillStyle = '#e8891c';
  g.fill();
  g.fillStyle = '#6b3a08';
  for (let i = 0; i < 3; i++) g.fillRect(dcx - dr * 0.45, dcy - dr * 0.2 + i * dr * 0.18, dr * 0.9, dr * 0.07);
  const tcx = dx(2.02);
  const tcy = dy(2.02);
  const tr = ds(0.11);
  g.beginPath();
  g.moveTo(tcx, tcy - tr);
  g.lineTo(tcx + tr * 1.05, tcy + tr * 0.75);
  g.lineTo(tcx - tr * 1.05, tcy + tr * 0.75);
  g.closePath();
  g.fillStyle = INK;
  g.fill();
  g.beginPath();
  g.moveTo(tcx, tcy - tr * 0.72);
  g.lineTo(tcx + tr * 0.8, tcy + tr * 0.6);
  g.lineTo(tcx - tr * 0.8, tcy + tr * 0.6);
  g.closePath();
  g.fillStyle = '#f2c21b';
  g.fill();

  // Daun kiri, bawah: plat CSC (logam abu-abu bergaris).
  const px = dx(0.32);
  const py = dy(1.72);
  g.fillStyle = '#b9bcbe';
  g.fillRect(px, py, ds(0.22), ds(0.28));
  g.strokeStyle = '#55595c';
  g.lineWidth = Math.max(1, ds(0.006));
  g.strokeRect(px, py, ds(0.22), ds(0.28));
  g.fillStyle = '#4a4e51';
  for (let i = 0; i < 9; i++) g.fillRect(px + ds(0.02), py + ds(0.03 + i * 0.027), ds(i % 3 === 0 ? 0.18 : 0.13), ds(0.007));

  return { canvas: cv, zones, pending };
}

// --- peta cat ---------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

let paintMapCache: { tex: THREE.Texture; normal: THREE.Texture; mean: number } | null = null;

/**
 * Peta cat: belang lembut berskala besar (cat yang memudar tidak rata), debu
 * tipis di dasar, sedikit karat di tepi bawah. Plus normal map halus
 * ("kulit jeruk" cat industri) supaya sorotannya tidak rata seperti plastik.
 */
export function paintMaps() {
  if (paintMapCache) return paintMapCache;
  const N = 512;
  const r = rng(11);

  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgb(240,240,239)';
  g.fillRect(0, 0, N, N);
  for (let i = 0; i < 26; i++) {
    const x = r() * N;
    const y = r() * N;
    const rad = N * (0.1 + r() * 0.25);
    const v = 222 + r() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, N, N);
  }
  for (let i = 0; i < 24; i++) {
    const x = r() * N;
    const len = N * (0.1 + r() * 0.4);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(110,110,104,0.08)');
    grad.addColorStop(1, 'rgba(110,110,104,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 2 + r() * 5, len);
  }
  for (let i = 0; i < 60; i++) {
    const y = N * (1 - Math.pow(r(), 3) * 0.6);
    g.fillStyle = `rgba(${125 + r() * 35},${82 + r() * 18},${58 + r() * 12},${0.15 + r() * 0.25})`;
    g.beginPath();
    g.ellipse(r() * N, y, 0.8 + r() * 2.5, 0.8 + r() * 2, 0, 0, Math.PI * 2);
    g.fill();
  }
  const base = g.createLinearGradient(0, N * 0.88, 0, N);
  base.addColorStop(0, 'rgba(105,98,86,0)');
  base.addColorStop(1, 'rgba(105,98,86,0.22)');
  g.fillStyle = base;
  g.fillRect(0, N * 0.88, N, N * 0.12);

  const d = g.getImageData(0, 0, N, N).data;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  let sum = 0;
  for (let i = 0; i < d.length; i += 16) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
  const mean = sum / (d.length / 16);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // 4 (bukan 8/16): di GPU terintegrasi tiap tingkat anisotropi menambah
  // sampel per piksel, dan di kejauhan bedanya tidak terlihat.
  tex.anisotropy = 4;

  // Bump: derau halus.
  const B = 256;
  const bc = document.createElement('canvas');
  bc.width = bc.height = B;
  const bg = bc.getContext('2d')!;
  const img = bg.createImageData(B, B);
  for (let i = 0; i < B * B; i++) {
    const v = 118 + r() * 20;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  bg.putImageData(img, 0, 0);
  bg.filter = 'blur(1px)';
  bg.drawImage(bc, 0, 0);
  // Tinggi → normal map ruang-tangen (Sobel, tepi membungkus karena
  // teksturnya diulang). Hasilnya sama dengan bump map tetapi shader cukup
  // satu sampel tekstur, bukan tiga.
  const hd = bg.getImageData(0, 0, B, B).data;
  const hAt = (x: number, y: number) => hd[(((y + B) % B) * B + ((x + B) % B)) * 4] / 255;
  const nc = document.createElement('canvas');
  nc.width = nc.height = B;
  const ng = nc.getContext('2d')!;
  const nimg = ng.createImageData(B, B);
  const GAIN = 6;
  for (let y = 0; y < B; y++) {
    for (let x = 0; x < B; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * GAIN;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * GAIN;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * B + x) * 4;
      nimg.data[o] = Math.round((-dx / len) * 127.5 + 127.5);
      nimg.data[o + 1] = Math.round((dy / len) * 127.5 + 127.5);
      nimg.data[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      nimg.data[o + 3] = 255;
    }
  }
  ng.putImageData(nimg, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.repeat.set(6, 3);

  paintMapCache = { tex, normal, mean };
  return paintMapCache;
}

// --- geometri ---------------------------------------------------------------


/** Ukuran rangka ISO yang dipakai bersama GP dan reefer realistis. */
export const FRAME = { CAST: { x: 0.178, y: 0.118, z: 0.162 }, RAIL_B: 0.16, RAIL_T: 0.1, POST: 0.16 } as const;

/**
 * Tingkat detail geometri.
 * - 'yard': dipakai InstancedMesh lapangan — ratusan kontainer, kebanyakan
 *   puluhan meter dari kamera. Tikungan gelombang tidak dibulatkan, tanpa
 *   penyok, batang bersegmen lebih sedikit, tanpa normal map. Di jarak itu
 *   tiap segitiga lebih kecil dari satu piksel, dan GPU membayar per segitiga
 *   (bukan per piksel): separuh segitiga = hampir separuh waktu frame.
 * - 'inspect': jendela detail, satu kontainer memenuhi layar — semua detail.
 */
export type Quality = 'yard' | 'inspect';

export type DoorOpts = {
  /** Pita panel tekan horizontal (GP); reefer berpintu rata. */
  ribs: boolean;
  /** Tinggi gagang batang kunci (m, dari tengah kontainer). */
  handleY: number;
  /** Tinggi kotak segel. */
  sealY: number;
  /** Detail penuh (segmen batang); default ya. */
  hi?: boolean;
};

/**
 * Ujung pintu (+X): daun pintu bermarka (atlas area pintu), karet hitam
 * keliling bukaan, 4 batang kunci dengan cam keeper, gagang, kotak segel,
 * engsel blade, header & sill.
 */
export function addDoorEnd(
  paint: THREE.BufferGeometry[],
  dark: THREE.BufferGeometry[],
  L: number,
  dUv: (u01: number, t01: number) => Vec2,
  o: DoorOpts,
) {
  const H = BOX.height;
  const W = BOX.width;
  const hx = L / 2;
  const hy = H / 2;
  const hz = W / 2;
  const { POST } = FRAME;
  const X = new THREE.Vector3(1, 0, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  // ---- ujung pintu (+X) — mengikuti foto acuan: daun berpanel tekan
  // horizontal, karet hitam keliling bukaan, 4 batang kunci, engsel blade.
  const hi = o.hi ?? true;
  const doorX = hx - 0.075; // muka luar daun
  const dy0 = -hy + 0.17;
  const dy1 = hy - 0.21;
  const dMid = (dy0 + dy1) / 2;
  const gz = hz - POST; // tepi bukaan
  // Karet pintu: keliling bukaan dan di antara kedua daun.
  for (const ez of [1, -1]) dark.push(box(0.03, dy1 - dy0 + 0.05, 0.04, doorX - 0.022, dMid, ez * (gz - 0.02)));
  dark.push(box(0.03, 0.04, 2 * gz, doorX - 0.022, dy1 + 0.005, 0));
  dark.push(box(0.03, 0.04, 2 * gz, doorX - 0.022, dy0 - 0.005, 0));
  dark.push(box(0.03, dy1 - dy0, 0.04, doorX - 0.016, dMid, 0));
  const span = dy1 - dy0;
  const yAt = (fromBottom: number) => dy0 + span * fromBottom;
  for (const leaf of [1, -1]) {
    const a = leaf > 0 ? 0.022 : -gz + 0.042;
    const b = leaf > 0 ? gz - 0.042 : -0.022;
    const zc = (a + b) / 2;
    const zw = b - a;
    // Pelat daun.
    paint.push(rbox(0.02, span - 0.03, zw, doorX - 0.014, dMid, zc, 0.006));
    // Muka pelat bermarka, 4 mm di depan balok pelat.
    const u = (sz: number) => (hz - sz) / W; // kanan = -Z
    const flat: P[] = [
      { s: a, off: 0, ns: 0, no: 1 },
      { s: b, off: 0, ns: 0, no: 1 },
    ];
    paint.push(
      sheet({
        pts: flat,
        t0: dy0 + 0.02,
        t1: dy1 - 0.02,
        tSeg: 1,
        at: (sz, t, off) => [doorX + off, t, sz],
        uv: (sz, t) => [u(sz), (t + hy) / H],
        decal: (sz, t) => dUv(u(sz), (t + hy) / H),
        sAxis: Z,
        outward: X,
      }),
    );
    // Bingkai panel tekan dan dua pita horizontal (atas & bawah tengah).
    const rib = (y: number, h: number) => paint.push(box(0.012, h, zw - 0.07, doorX + 0.004, y, zc));
    rib(dy1 - 0.06, 0.035);
    rib(dy0 + 0.06, 0.035);
    if (o.ribs) for (const f of [0.6, 0.67, 0.36, 0.43]) rib(yAt(f), 0.03);
    for (const ez of [a + 0.035, b - 0.035]) paint.push(box(0.012, span - 0.1, 0.035, doorX + 0.004, dMid, ez));
    // Engsel blade di tepi luar, lima per daun.
    for (const f of [0.06, 0.28, 0.5, 0.72, 0.94]) {
      const y = yAt(f);
      const zh = leaf * (gz - 0.005);
      paint.push(box(0.026, 0.075, 0.15, doorX + 0.006, y, zh - leaf * 0.07));
      paint.push(rod(0.02, 0.11, doorX + 0.014, y, zh + leaf * 0.012, 'y', hi ? 8 : 5));
    }
    // Dua batang kunci per daun.
    for (const zr of [0.24, 0.74]) {
      const z = leaf * zr;
      const rx = doorX + 0.034;
      paint.push(rod(0.022, H - 0.2, rx, 0, z, 'y', hi ? 12 : 7));
      // Cam keeper atas & bawah (dibaut ke header/sill) dan cam di ujung batang.
      paint.push(box(0.05, 0.085, 0.085, rx - 0.006, hy - 0.115, z));
      paint.push(box(0.05, 0.085, 0.085, rx - 0.006, -hy + 0.105, z));
      dark.push(rod(0.012, 0.09, rx + 0.022, hy - 0.115, z, 'z', hi ? 6 : 4));
      dark.push(rod(0.012, 0.09, rx + 0.022, -hy + 0.105, z, 'z', hi ? 6 : 4));
      // Pemandu batang.
      for (const gy of [0.72, 0.2, -0.55, -0.92]) paint.push(box(0.04, 0.06, 0.07, rx - 0.012, gy, z));
      // Gagang horizontal di bawah tengah, ke arah yang sama untuk satu daun.
      const dir = -leaf;
      const hy0 = o.handleY;
      paint.push(box(0.035, 0.07, 0.06, rx + 0.012, hy0, z));
      paint.push(rod(0.014, 0.3, rx + 0.032, hy0, z + dir * 0.15, 'z', hi ? 8 : 5));
      paint.push(box(0.03, 0.06, 0.04, rx + 0.02, hy0, z + dir * 0.3));
    }
  }
  // Kotak segel di tepi daun kanan (dilihat dari belakang = -Z), setinggi gagang.
  paint.push(rbox(0.05, 0.13, 0.09, doorX + 0.03, o.sealY, -0.06, 0.01));
  // Header & sill.
  paint.push(rbox(0.13, 0.2, W - 2 * POST, hx - 0.065, hy - 0.1, 0));
  paint.push(rbox(0.13, 0.17, W - 2 * POST, hx - 0.065, -hy + 0.085, 0));

}

/** Rel samping, kantong forklift (20ft, opsional), tiang sudut, corner casting. */
export function addFrame(
  paint: THREE.BufferGeometry[],
  dark: THREE.BufferGeometry[],
  L: number,
  forklift: boolean,
) {
  const H = BOX.height;
  const hx = L / 2;
  const hy = H / 2;
  const hz = BOX.width / 2;
  const { CAST, RAIL_B, RAIL_T, POST } = FRAME;
  // ---- rel samping + kantong forklift
  for (const side of [1, -1]) {
    paint.push(rbox(L - 2 * CAST.x + 0.02, RAIL_B, 0.11, 0, -hy + RAIL_B / 2, side * (hz - 0.065), 0.014));
    paint.push(rbox(L - 2 * CAST.x + 0.02, RAIL_T, RAIL_T, 0, hy - RAIL_T / 2, side * (hz - 0.06), 0.016));
    if (forklift && L < 9) {
      for (const fx of [-1.025, 1.025]) {
        paint.push(box(0.42, 0.13, 0.02, fx, -hy + 0.075, side * (hz - 0.004)));
        dark.push(box(0.35, 0.09, 0.004, fx, -hy + 0.072, side * (hz + 0.007)));
      }
    }
  }

  // ---- tiang sudut & corner casting
  for (const ex of [1, -1]) {
    for (const ez of [1, -1]) {
      const px = ex * (hx - POST / 2 - 0.004);
      const pz = ez * (hz - POST / 2 - 0.004);
      paint.push(rbox(POST, H - 2 * CAST.y + 0.01, POST, px, 0, pz, 0.018));
      for (const ey of [1, -1]) {
        const cx = ex * (hx - CAST.x / 2);
        const cy = ey * (hy - CAST.y / 2);
        const cz = ez * (hz - CAST.z / 2);
        paint.push(rbox(CAST.x, CAST.y, CAST.z, cx, cy, cz, 0.012));
        // Lubang lonjong (dibuat sebagai cekungan gelap).
        dark.push(box(0.1, 0.05, 0.006, cx, cy, ez * (hz + 0.0015)));
        dark.push(box(0.006, 0.05, 0.07, ex * (hx + 0.0015), cy, cz));
        dark.push(box(0.11, 0.006, 0.06, cx, ey * (hy + 0.0015), cz));
      }
    }
  }

}

type Geo = { paint: THREE.BufferGeometry; dark: THREE.BufferGeometry; atlas: Atlas };

const geoCache = new Map<string, Geo>();

function buildGeometry(L: number, q: Quality = 'yard'): Geo {
  const cached = geoCache.get(`${L}|${q}`);
  if (cached) return cached;
  const hi = q === 'inspect';
  const rounds = hi ? 1 : 0;
  const tSeg = hi ? 2 : 1;
  const H = BOX.height;
  const W = BOX.width;
  const hx = L / 2;
  const hy = H / 2;
  const hz = W / 2;
  const A = atlasFor(L);
  const sUv = sideUv(A);
  const dUv = doorUv(A);
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  const paint: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  const { CAST, RAIL_B, RAIL_T, POST } = FRAME;
  const PITCH = 0.278;
  const DEPTH = 0.036;

  // Penyok halus: gelombang panjang + sedikit acak per panel, nol di tepi.
  const dentFor = (span: number, seed: number, amp: number) => (s: number, t: number) => {
    const u = s / span;
    return (
      -amp *
      Math.sin(Math.PI * Math.min(1, Math.max(0, t))) *
      (0.6 * Math.sin(u * 7.1 + seed) + 0.4 * Math.sin(u * 17.3 + seed * 2.3))
    );
  };

  // ---- dinding samping
  const wy0 = -hy + RAIL_B;
  const wy1 = hy - RAIL_T;
  const sidePts = corrugation(-hx + POST, hx - POST, PITCH, DEPTH, rounds);
  for (const side of [1, -1]) {
    const zIn = side * (hz - 0.02 - DEPTH);
    const dent = dentFor(L, side > 0 ? 1.3 : 4.1, 0.006);
    const dentT = (s: number, t: number) => dent(s, (t - wy0) / (wy1 - wy0));
    const at = (lift: number) => (s: number, t: number, off: number): Vec3 => [s, t, zIn + side * (off + lift)];
    const u = (s: number) => (side > 0 ? (s + hx) / L : (hx - s) / L);
    const out = new THREE.Vector3(0, 0, side);
    const base = { pts: sidePts, t0: wy0, t1: wy1, tSeg, sAxis: X, outward: out, dent: hi ? dentT : undefined };
    // Marka dicampur LANGSUNG ke cat dinding di shader (lihat paintMaterial),
    // bukan lapisan kedua di depannya. Lapisan terpisah + alphaTest dulu pecah
    // di lereng gelombang: garis putih dan takik pada tulisan MAERSK.
    paint.push(
      sheet({
        ...base,
        at: at(0),
        uv: (s, t) => [u(s), (t + hy) / H],
        decal: (s, t) => sUv(u(s), (t + hy) / H),
      }),
    );

    // Ventilasi: dua di tiap sisi, dekat rel atas di kedua ujung.
    for (const vx of [-hx + 0.55, hx - 0.55]) {
      const vz = side * (hz - 0.005);
      paint.push(box(0.2, 0.09, 0.03, vx, hy - 0.2, vz));
      for (let k = 0; k < 3; k++) dark.push(box(0.16, 0.012, 0.004, vx, hy - 0.225 + k * 0.025, vz + side * 0.015));
    }
  }

  // ---- atap
  const roofPts = corrugation(-hx + CAST.x, hx - CAST.x, PITCH * 1.5, 0.022, rounds);
  paint.push(
    sheet({
      pts: roofPts,
      t0: -hz + RAIL_T,
      t1: hz - RAIL_T,
      tSeg,
      at: (s, t, off) => [s, hy - 0.04 + off, t],
      uv: (s, t) => [(s + hx) / L, (t + hz) / W],
      sAxis: X,
      outward: Y,
      dent: hi ? (s, t) => dentFor(L, 2.2, 0.008)(s, (t + hz) / W) : undefined,
    }),
  );

  // ---- dinding depan (ujung -X)
  const fy0 = -hy + 0.18;
  const fy1 = hy - 0.16;
  paint.push(
    sheet({
      pts: corrugation(-hz + POST, hz - POST, PITCH, DEPTH, rounds),
      t0: fy0,
      t1: fy1,
      tSeg,
      at: (s, t, off) => [-hx + 0.02 + DEPTH - off, t, s],
      uv: (s, t) => [(s + hz) / W, (t + hy) / H],
      sAxis: Z,
      outward: new THREE.Vector3(-1, 0, 0),
    }),
  );
  paint.push(rbox(0.11, 0.18, W - 2 * POST, -hx + 0.06, -hy + 0.09, 0));
  paint.push(rbox(0.11, 0.16, W - 2 * POST, -hx + 0.06, hy - 0.08, 0));

  addDoorEnd(paint, dark, L, dUv, { ribs: true, handleY: -0.18, sealY: -0.12, hi });
  addFrame(paint, dark, L, true);

  // Kotak dalam gelap: menutup celah; di ujung pintu berhenti di belakang daun.
  dark.push(box(L - 0.18, H - 0.12, W - 0.16, -0.02, 0, 0));

  const out: Geo = { paint: merge(paint.map(plainDecal)), dark: merge(dark), atlas: A };
  geoCache.set(`${L}|${q}`, out);
  return out;
}

// --- material ---------------------------------------------------------------

/**
 * Atlas marka satu livery × panjang. `uniform` adalah objek uniform yang
 * DIPAKAI BERSAMA semua material atlas ini (termasuk salinan di jendela
 * detail): menukar teksturnya cukup dengan mengganti `uniform.value`.
 */
export type Marks = { uniform: { value: THREE.Texture }; zones: CodeZone[]; atlas: Atlas };

/** Tekstur atlas marka dari kanvas. */
export function makeMarksTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Premultiplied: tepi huruf yang difilter bercampur ke cat, bukan ke hitam
  // (tanpa ini bingkai putih logo dikelilingi lingkaran gelap tipis).
  tex.premultiplyAlpha = true;
  tex.anisotropy = 4;
  return tex;
}

/** Atlas marka siap pakai: tekstur + uniform bersama + logo berkas menyusul. */
export function makeMarks(canvas: HTMLCanvasElement, zones: CodeZone[], atlas: Atlas, pending: PendingLogo[]): Marks {
  const marks: Marks = { uniform: { value: makeMarksTexture(canvas) }, zones, atlas };
  loadPendingLogos(canvas, marks, pending);
  return marks;
}

/**
 * Dipanggil saat logo berkas selesai digambar ke atlas. Lapangan memakai
 * frameloop "demand", jadi YardContainers mendaftarkan invalidate() di sini
 * supaya logonya langsung tampak.
 */
export const marksListeners = new Set<() => void>();

/** Gambar logo berkas (public/liveries/) ke atlas setelah termuat. */
/** Luminansi relatif (WCAG) dari komponen sRGB 0–255. */
const relLum = (r: number, gr: number, b: number) => {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
};

/**
 * Logo tanpa transparansi (JPG, atau PNG berlatar putih/abu seperti CMA CGM,
 * COSCO, RCL, Wan Hai) akan tampil sebagai kotak di badan kontainer. Latarnya
 * dihapus: piksel yang mirip warna sudut gambar DAN tersambung ke tepi dibuat
 * transparan (flood fill dari tepi). Warna yang sama di dalam logo yang
 * tertutup garis — isi oval RCL — tetap utuh.
 *
 * Mengembalikan true bila ada yang diubah. Gambar yang sudah transparan tidak
 * disentuh.
 */
function knockOutBackground(d: Uint8ClampedArray, w: number, h: number): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return false;
  // Warna latar = rata-rata empat sudut.
  let br = 0, bg = 0, bb = 0;
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
    const i = (y * w + x) * 4;
    br += d[i] / 4;
    bg += d[i + 1] / 4;
    bb += d[i + 2] / 4;
  }
  const near = (i: number) => Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) < 70;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (seen[p]) return;
    seen[p] = 1;
    if (near(p * 4)) stack.push(p);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  let changed = false;
  while (stack.length) {
    const p = stack.pop()!;
    d[p * 4 + 3] = 0;
    changed = true;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // Daerah latar yang TERTUTUP tapi kecil = lubang huruf (a, o, d, g pada
  // "Hapag-Lloyd") — ikut dihapus supaya cat badan terlihat di dalamnya.
  // Daerah tertutup yang besar (isi oval RCL) tetap utuh: itu bagian logo.
  const maxHole = w * h * 0.004;
  const comp: number[] = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (seen[p0] || !near(p0 * 4)) continue;
    comp.length = 0;
    seen[p0] = 1;
    const st = [p0];
    while (st.length) {
      const p = st.pop()!;
      comp.push(p);
      const x = p % w;
      const y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !seen[q] && near(q * 4)) {
          seen[q] = 1;
          st.push(q);
        }
      }
    }
    if (comp.length <= maxHole) {
      for (const p of comp) d[p * 4 + 3] = 0;
      changed = true;
    }
  }
  return changed;
}

/**
 * Pangkas pinggiran transparan logo dan ukur warna rata-ratanya.
 * Banyak berkas logo punya ruang kosong lebar (Maersk.png 960×960 dengan logo
 * hanya di pita tengah) — tanpa dipangkas, logonya tergambar kecil.
 */
function analyzeLogo(img: HTMLImageElement) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const imgData = g.getImageData(0, 0, c.width, c.height);
  const d = imgData.data;
  if (knockOutBackground(d, c.width, c.height)) g.putImageData(imgData, 0, 0);
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  let sr = 0, sg = 0, sb = 0, n = 0;
  // Sampel luminansi piksel logo (tiap ke-7), untuk menilai kontras per piksel.
  const lums: number[] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i + 3] < 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      sr += d[i];
      sg += d[i + 1];
      sb += d[i + 2];
      if (n % 7 === 0) lums.push(relLum(d[i], d[i + 1], d[i + 2]));
      n++;
    }
  }
  if (x1 < 0) return { canvas: c, sx: 0, sy: 0, sw: c.width, sh: c.height, lum: 0, lums };
  return { canvas: c, sx: x0, sy: y0, sw: x1 - x0 + 1, sh: y1 - y0 + 1, lum: relLum(sr / n, sg / n, sb / n), lums };
}

export function loadPendingLogos(canvas: HTMLCanvasElement, marks: Marks, pending: PendingLogo[]) {
  const g = canvas.getContext('2d')!;
  for (const p of pending) {
    const img = new Image();
    img.onload = () => {
      const a = analyzeLogo(img);
      const c = p.crop ?? [0, 0, 1, 1];
      const src = { sx: a.sx + a.sw * c[0], sy: a.sy + a.sh * c[1], sw: a.sw * c[2], sh: a.sh * c[3] };
      const k = Math.min(p.w / src.sw, p.h / src.sh);
      const w = src.sw * k;
      const h = src.sh * k;
      // Papan latar kalau logo nyaris sewarna dengan cat (logo ONE magenta di
      // badan magenta, MERATUS biru tua di badan biru). Dinilai per piksel:
      // papan dipasang bila kurang dari separuh piksel logo berkontras >= 2
      // terhadap cat. Rata-rata warna saja menyesatkan — logo merah + biru
      // (PIL, RCL) rata-ratanya mirip abu-abu padahal tiap warnanya terbaca.
      const hex = p.body.replace('#', '');
      const bodyLum = relLum(parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16));
      const ratio = (l: number) => (Math.max(l, bodyLum) + 0.05) / (Math.min(l, bodyLum) + 0.05);
      // Piksel sangat terang (isian putih di dalam logo, mis. oval RCL) tidak
      // dinilai: ia isian, bukan bagian yang harus terbaca.
      const ink = a.lums.filter((l) => l < 0.8);
      const pool = ink.length ? ink : a.lums;
      const readable = pool.length ? pool.filter((l) => ratio(l) >= 2).length / pool.length : 1;
      if (readable < 0.5) {
        const pad = h * 0.18;
        roundRect(g, p.cx - w / 2 - pad, p.cy - h / 2 - pad, w + 2 * pad, h + 2 * pad, pad * 0.8);
        g.fillStyle = a.lum < 0.35 ? '#f4f5f6' : '#1c1e20';
        g.fill();
      }
      g.drawImage(a.canvas, src.sx, src.sy, src.sw, src.sh, p.cx - w / 2, p.cy - h / 2, w, h);
      // Tekstur BARU, bukan needsUpdate pada yang lama: di GPU tertentu
      // (terukur di ANGLE/D3D11) unggah ulang atlas 20ft yang sudah terpasang
      // tidak terbawa, sehingga logo tidak pernah tampak. Tekstur baru selalu
      // diunggah utuh, dan semua material atlas ini memakai uniform yang sama.
      const old = marks.uniform.value;
      marks.uniform.value = makeMarksTexture(canvas);
      old.dispose();
      marksListeners.forEach((fn) => fn());
    };
    img.onerror = () => console.warn('[livery] logo tidak ditemukan:', p.file);
    img.src = `/liveries/${encodeURIComponent(p.file)}`;
  }
}

const marksTexCache = new Map<string, Marks>();

function marksTexture(L: number, A: Atlas, liv: Livery): Marks {
  const key = `${L}|${liveryKey(liv)}`;
  const hit = marksTexCache.get(key);
  if (hit) return hit;
  const { canvas, zones, pending } = drawMarkings(L, A, liv);
  const out = makeMarks(canvas, zones, A, pending);
  marksTexCache.set(key, out);
  return out;
}

/**
 * Menyuntikkan atlas marka ke shader cat: warna cat (sudah × instanceColor)
 * ditimpa marka sesuai alpha-nya, dengan filter tekstur biasa — tepi huruf
 * halus, tanpa alphaTest, tanpa lapisan kedua yang bisa z-fighting.
 *
 * Marka hanya sedikit ikut instanceColor: tetap terbaca di atas cat line apa
 * pun, tapi ikut kuning saat disorot dan redup saat tersaring.
 */
export function withMarkings(mat: THREE.Material, marks: Marks, inkColor: string = INK) {
  const z = zoneUniforms(marks.zones, marks.atlas.w, marks.atlas.h, marks.atlas.side);
  // Zona nomor DIBAKAR sebagai konstanta GLSL, bukan array uniform. Array
  // uniform yang diindeks dinamis (zoneMap[int(...)]) membuat driver GPU
  // terintegrasi menyalin seluruh array ke register tiap fragment, walau
  // cabangnya dilewati — terukur ±20 ms/frame untuk 700 kontainer. Zona
  // tetap per material (livery × panjang), jadi konstanta sudah cukup;
  // harganya satu program shader per atlas, bukan satu untuk semua.
  const f = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : v.toFixed(6));
  const nZ = z.count;
  const nM = Math.max(1, marks.zones.reduce((n, zz) => n + zz.map.length, 0));
  const glslZones =
    nZ === 0
      ? ''
      : `const vec4 ZR[${nZ}] = vec4[${nZ}](${z.rect.slice(0, nZ).map((r) => `vec4(${f(r.x)},${f(r.y)},${f(r.z)},${f(r.w)})`).join(',')});
        const vec2 ZI[${nZ}] = vec2[${nZ}](${z.info.slice(0, nZ).map((r) => `vec2(${f(r.x)},${f(r.y)})`).join(',')});
        const float ZM[${nM}] = float[${nM}](${z.map.slice(0, nM).map(f).join(',')});
        const vec4 ZB0 = vec4(${[z.bounds[0].x, z.bounds[0].y, z.bounds[0].z, z.bounds[0].w].map(f).join(',')});
        const vec4 ZB1 = vec4(${[z.bounds[1].x, z.bounds[1].y, z.bounds[1].z, z.bounds[1].w].map(f).join(',')});`;
  const zoneKey = glslZones.replace(/\s+/g, '');
  // Warna nomor kontainer = warna tulisan livery (putih di Meratus biru).
  const ink = new THREE.Color(inkColor);
  // Penanda untuk YardContainers / InspectView: geometri mesh ini perlu
  // atribut nomor kontainer (containerCode.withCodes).
  mat.userData.containerCode = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.decalMap = marks.uniform;
    shader.uniforms.glyphMap = { value: glyphTexture(NARROW) };
    shader.uniforms.codeInk = { value: ink };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec2 decalUv;
        varying vec2 vDecalUv;
        attribute vec4 aCode0;
        attribute vec4 aCode1;
        flat varying vec4 vCode0;
        flat varying vec4 vCode1;`,
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDecalUv = decalUv;\nvCode0 = aCode0;\nvCode1 = aCode1;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D decalMap;
        uniform sampler2D glyphMap;
        ${glslZones}
        uniform vec3 codeInk;
        bool inRect(vec2 p, vec4 r) { return p.x >= r.x && p.x <= r.z && p.y >= r.y && p.y <= r.w; }
        varying vec2 vDecalUv;
        flat varying vec4 vCode0;
        flat varying vec4 vCode1;
        int codeChar(int k) {
          float v = k < 12 ? vCode0[k / 3] : vCode1.x;
          int iv = int(v + 0.5);
          int p = k - (k / 3) * 3;
          int d = p == 0 ? 1 : (p == 1 ? 37 : 1369);
          int c = iv / d;
          return c - (c / 37) * 37;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 tintK = vec3(1.0);
          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            float lit = max(vColor.r, max(vColor.g, vColor.b));
            tintK = mix(vec3(1.0), vColor.rgb / max(lit, 1e-3), 0.25) * clamp(lit * 1.6, 0.2, 1.0);
          #endif
          vec4 dc = texture2D(decalMap, vDecalUv);
          diffuseColor.rgb = diffuseColor.rgb * (1.0 - dc.a) + dc.rgb * tintK;
          // Nomor kontainer asli, per instance. Loop zonanya mahal di GPU
          // terintegrasi (indeks uniform dinamis per piksel, dikalikan
          // overshading segitiga mikro — terukur 30 ms/frame untuk 700
          // kontainer), jadi hanya dijalankan di dalam dua kotak pembatas
          // tempat nomor berada; piksel badan lainnya lewat dengan 2 uji.
          #if ${nZ > 0 ? 1 : 0}
          if (vCode1.w > 1.5 && (inRect(vDecalUv, ZB0) || inRect(vDecalUv, ZB1))) {
            for (int i = 0; i < ${nZ}; i++) {
              vec4 r = ZR[i];
              if (vDecalUv.x >= r.x && vDecalUv.x <= r.z && vDecalUv.y >= r.y && vDecalUv.y <= r.w) {
                float fx = (vDecalUv.x - r.x) / (r.z - r.x) * ZI[i].x;
                int slot = min(int(fx), int(ZI[i].x) - 1);
                float src = ZM[int(ZI[i].y) + slot];
                if (src >= 0.0) {
                  int ch = codeChar(int(src));
                  if (ch < 36) {
                    vec2 guv = vec2((float(ch) + fract(fx)) / 37.0, (vDecalUv.y - r.y) / (r.w - r.y));
                    float a = texture2D(glyphMap, guv).a;
                    diffuseColor.rgb = mix(diffuseColor.rgb, codeInk * tintK, a);
                  }
                }
              }
            }
          }
          #endif
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'real-ctr-paint-v4|' + zoneKey;
}

type Variant = 'tint' | 'plain';
const modelCache = new Map<string, InstancedModel>();

/**
 * Model instanced kontainer realistis, berbentuk sama dengan hasil olahan aset
 * GLB (parts20 + parts40), jadi YardContainers bisa menukarnya langsung.
 */
export function realisticContainerModel(variant: Variant, liv: Livery = MAERSK, quality: Quality = 'yard'): InstancedModel {
  const cacheKey = `${variant}|${quality}|${liveryKey(liv)}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;
  const { tex, normal, mean } = paintMaps();
  const level = TARGET_LINEAR / mean;
  const paintColor = new THREE.Color();
  // Cat badan dari livery saat pewarnaan mati; abu netral saat diwarnai.
  if (variant === 'plain') paintColor.set(liv.bodyColor).multiplyScalar(level);
  else paintColor.setRGB(level, level, level, THREE.LinearSRGBColorSpace);

  const dark = new THREE.MeshPhongMaterial({
    color: new THREE.Color('#25282b'),
    shininess: 10,
    specular: new THREE.Color('#15181b'),
  });

  const partsFor = (L: number): ModelPart[] => {
    const geo = buildGeometry(L, quality);
    // Cat industri semi-gloss: sorotan lebar dan lembut. Satu material per
    // panjang karena atlas markanya berbeda.
    const paint = new THREE.MeshPhongMaterial({
      color: paintColor,
      map: tex,
      // Normal map (1 sampel), bukan bump map (3 sampel + turunan): kulit
      // jeruk yang sama, sepertiga biaya teksturnya.
      // Kulit jeruk hanya terlihat dari dekat; di lapangan sampel teksturnya
      // terbuang (lihat Quality).
      normalMap: quality === 'inspect' ? normal : null,
      normalScale: new THREE.Vector2(0.6, 0.6),
      shininess: 26,
      specular: new THREE.Color('#3a4048'),
    });
    withMarkings(paint, marksTexture(L, geo.atlas, liv), liv.textColor);
    return [
      { name: `gp-${liv.code}-${L}-paint`, geometry: geo.paint, material: paint },
      { name: `gp-${liv.code}-${L}-dark`, geometry: geo.dark, material: dark },
    ];
  };

  const model: InstancedModel = { parts20: partsFor(BOX.len20), parts40: partsFor(BOX.len40) };
  modelCache.set(cacheKey, model);
  return model;
}

/** Jumlah segitiga per kontainer (untuk README / uji). */
export function realisticTriangles(L: number = BOX.len20, quality: Quality = 'yard'): number {
  const g = buildGeometry(L, quality);
  return triangleCount(g.paint) + triangleCount(g.dark);
}
