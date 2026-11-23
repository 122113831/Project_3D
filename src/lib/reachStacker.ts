import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOX } from './constants';
import { hazardTexture } from './rtgDetail';

/**
 * Reach stacker (RS) prosedural — mengikuti gambar acuan: sasis kuning dengan
 * gardan depan roda ganda, roda belakang tunggal di bawah spatbor bobot
 * penyeimbang, kabin berkaca di tengah, menara pivot di belakang, boom
 * teleskopik (luar kuning, dalam hitam) yang diangkat dua silinder hitam,
 * dan spreader abu tua dengan kepala rotator, lengan teleskopik, balok ujung
 * bergaris kuning-hitam, dan twistlock.
 *
 * Koordinat lokal: +X = arah maju (ke spreader), Y atas, Z kiri. Titik nol
 * di tengah antara gardan, di tanah. Spreader MELINTANG (panjangnya pada Z),
 * seperti RS sungguhan — kontainer dibawa tegak lurus terhadap alat.
 *
 * Bagian yang bergerak dipisah dalam grup supaya bisa dianimasikan nanti:
 * boom (sudut), boom dalam (panjang), spreader (selalu datar di ujung boom),
 * dan silinder angkat (direntang ulang tiap pose). Pakai `setPose`.
 *
 * Dibuat sebagai THREE.Group biasa (bukan instanced): satu RS ±7–9 ribu
 * segitiga, dan jumlah RS di depo hanya beberapa unit.
 */

export const RS = {
  /** Pivot boom (di puncak menara belakang). */
  pivot: { x: -2.75, y: 4.35 },
  /** Panjang boom luar & boom dalam (meter). */
  outerLen: 7.2,
  innerLen: 7.4,
  /** Pangkal boom dalam di dalam boom luar (dari pivot). Saat ext = 0 boom
   * dalam sudah menonjol innerStart + innerLen − outerLen dari ujung luar. */
  innerStart: 1.9,
  /** Pin gantung spreader: jarak dari pangkal boom dalam & turunnya. */
  pinAlong: 7.05,
  pinDrop: 0.62,
  /** Sudut & panjang tambahan boom saat diam (bepergian). */
  rest: { angle: 0.12, ext: 0 },
  /** Jarak dari ujung boom ke ALAS twistlock spreader. */
  hang: 2.25,
  /** Ukuran tapak (kotak pilih editor), termasuk spreader 20ft. */
  footprint: { x: 15, z: 6.4, y: 9 },
} as const;

type Key = 'yellow' | 'black' | 'grey' | 'deck' | 'tire' | 'rim' | 'glass' | 'hazard' | 'chrome' | 'lamp' | 'red' | 'label';
type Bucket = Record<Key, THREE.BufferGeometry[]>;
const bucket = (): Bucket => ({
  yellow: [], black: [], grey: [], deck: [], tire: [], rim: [], glass: [], hazard: [], chrome: [], lamp: [], red: [], label: [],
});

// --- primitif kecil -------------------------------------------------------------

function box(out: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  out.push(g);
  return g;
}
/** Silinder dengan sumbu `axis`. */
function cyl(out: THREE.BufferGeometry[], r: number, len: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, len, seg).toNonIndexed();
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  out.push(g);
}
/** Prisma dari profil sisi (titik x,y) yang diekstrusi sepanjang Z (tebal d). */
function prism(out: THREE.BufferGeometry[], pts: [number, number][], d: number, z: number) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }).toNonIndexed();
  g.translate(0, 0, z - d / 2);
  out.push(g);
}
/** Pipa dari a ke b. */
function tube(out: THREE.BufferGeometry[], a: [number, number, number], b: [number, number, number], r: number, seg = 6) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg).toNonIndexed();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  const m = va.add(vb).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  out.push(g);
}
/** Pagar: tiang & dua rel dari a ke b, tinggi h. */
function railing(out: THREE.BufferGeometry[], a: [number, number, number], b: [number, number, number], h = 0.95, step = 0.8) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const n = Math.max(1, Math.round(va.distanceTo(vb) / step));
  for (let i = 0; i <= n; i++) {
    const p = va.clone().lerp(vb, i / n);
    tube(out, [p.x, p.y, p.z], [p.x, p.y + h, p.z], 0.02, 5);
  }
  tube(out, [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.025);
  tube(out, [a[0], a[1] + h / 2, a[2]], [b[0], b[1] + h / 2, b[2]], 0.02);
}
/** Roda: ban, velg, tutup tromol. Sumbu Z. */
function wheel(b: Bucket, x: number, z: number, r: number, w: number) {
  const tire = new THREE.CylinderGeometry(r, r, w, 22).toNonIndexed();
  tire.rotateX(Math.PI / 2);
  tire.translate(x, r, z);
  b.tire.push(tire);
  cyl(b.rim, r * 0.55, w + 0.04, x, r, z, 'z', 16);
  cyl(b.black, r * 0.2, w + 0.08, x, r, z, 'z', 10);
}

// --- bagian diam ----------------------------------------------------------------

function buildBody(): Bucket {
  const b = bucket();
  // Gardan depan roda ganda (x = +1.9) dan roda belakang tunggal (x = -3.75).
  for (const sz of [1, -1]) {
    wheel(b, 1.9, sz * 1.62, 0.92, 0.62);
    wheel(b, 1.9, sz * 0.98, 0.92, 0.6);
    wheel(b, -3.75, sz * 1.42, 0.86, 0.66);
  }
  cyl(b.grey, 0.22, 3.0, 1.9, 0.92, 0, 'z', 12); // gardan depan

  // Sasis: balok utama, rumah gardan depan + spatbor, dek.
  box(b.yellow, 6.9, 0.7, 1.9, -1.0, 1.25, 0);
  box(b.yellow, 1.6, 0.9, 3.0, 1.9, 1.55, 0);
  for (const sz of [1, -1]) {
    // Spatbor/peti depan di atas roda ganda: kotak bersudut.
    prism(b.yellow, [[1.0, 1.95], [2.85, 1.95], [2.95, 2.3], [0.9, 2.3]], 1.3, sz * 1.3);
    box(b.yellow, 0.25, 0.55, 1.3, 2.85, 1.7, sz * 1.3);
    // Tiang pengunci depan (lihat gambar) & lampu sorot depan.
    box(b.yellow, 0.35, 0.8, 0.25, 2.6, 2.7, sz * 0.75);
    box(b.lamp, 0.15, 0.12, 0.25, 2.8, 3.15, sz * 0.75);
  }
  box(b.black, 0.6, 0.35, 1.6, 2.75, 1.0, 0); // bumper depan

  // Dek kiri-kanan berpelat garis + pagar, tangga naik di sisi kiri.
  for (const sz of [1, -1]) {
    box(b.deck, 3.6, 0.08, 0.9, -0.9, 1.64, sz * 1.42);
    box(b.yellow, 3.6, 0.25, 0.08, -0.9, 1.5, sz * 1.88);
    railing(b.chrome, [-2.6, 1.68, sz * 1.85], [0.6, 1.68, sz * 1.85], 0.95, 0.8);
  }
  for (let i = 0; i < 3; i++) box(b.deck, 0.5, 0.05, 0.55, -0.2 + i * 0.0, 0.55 + i * 0.36, 1.95 + i * 0.0);
  // Peti alat & tangki di dek kiri (tulisan merah kecil = stiker peringatan).
  box(b.yellow, 1.0, 0.65, 0.6, -2.1, 2.0, 1.4);
  box(b.red, 0.45, 0.08, 0.01, -2.1, 2.1, 1.71);
  box(b.black, 0.25, 0.35, 0.25, -1.3, 1.85, -1.5);

  // Kabin: tiang, atap, kaca besar di tiga sisi, kursi & tuas di dalam.
  const cx = -0.35;
  const cz = 0.55;
  const y0 = 1.7;
  const ch = 2.05;
  for (const dx of [-0.75, 0.75]) for (const dz of [-0.62, 0.62]) box(b.black, 0.08, ch, 0.08, cx + dx, y0 + ch / 2, cz + dz);
  box(b.black, 1.65, 0.12, 1.35, cx, y0 + ch, cz);
  box(b.black, 1.6, 0.35, 1.3, cx, y0 + 0.18, cz);
  box(b.glass, 0.04, ch - 0.45, 1.2, cx + 0.77, y0 + 0.35 + (ch - 0.45) / 2, cz);
  box(b.glass, 1.45, ch - 0.45, 0.04, cx, y0 + 0.35 + (ch - 0.45) / 2, cz + 0.64);
  box(b.glass, 1.45, ch - 0.45, 0.04, cx, y0 + 0.35 + (ch - 0.45) / 2, cz - 0.64);
  box(b.glass, 0.04, 0.9, 1.2, cx - 0.77, y0 + ch - 0.6, cz);
  box(b.grey, 0.45, 0.55, 0.5, cx - 0.2, y0 + 0.75, cz);
  box(b.grey, 0.12, 0.35, 0.3, cx + 0.35, y0 + 0.8, cz);
  // Pelindung atap (kisi) di atas kabin.
  for (let i = -3; i <= 3; i++) box(b.black, 1.55, 0.04, 0.05, cx, y0 + ch + 0.1, cz + i * 0.18);

  // Menara pivot belakang: dua kolom kuning miring + dudukan pin boom.
  const px = RS.pivot.x;
  const py = RS.pivot.y;
  for (const sz of [1, -1]) {
    prism(b.yellow, [[px - 0.75, 1.55], [px + 0.95, 1.55], [px + 0.45, py - 0.1], [px - 0.35, py + 0.35]], 0.32, sz * 0.62);
    cyl(b.grey, 0.22, 0.4, px, py, sz * 0.62, 'z', 14);
  }
  // Pipa knalpot naik di belakang menara kanan.
  tube(b.chrome, [px - 0.45, 2.4, -1.05], [px - 0.45, 4.8, -1.05], 0.07, 10);
  tube(b.chrome, [px - 0.45, 4.8, -1.05], [px - 0.2, 5.05, -1.05], 0.07, 10);

  // Bobot penyeimbang belakang + spatbor roda belakang + lampu belakang.
  prism(b.yellow, [[-4.9, 1.0], [-2.8, 1.0], [-2.8, 2.55], [-3.3, 2.75], [-4.75, 2.75], [-4.95, 2.35]], 3.6, 0);
  for (const sz of [1, -1]) {
    prism(b.yellow, [[-4.6, 1.85], [-2.9, 1.85], [-3.0, 2.3], [-4.5, 2.3]], 0.8, sz * 1.42);
    box(b.red, 0.02, 0.12, 0.35, -4.96, 2.15, sz * 1.25);
    // Lubang pengait (titik hitam di bobot).
    for (const dy of [1.45, 1.75]) cyl(b.black, 0.06, 0.02, -4.96, dy, sz * 1.5, 'x', 8);
  }
  cyl(b.yellow, 0.07, 0.15, -3.9, 2.85, 1.2, 'y', 8); // mata angkat
  cyl(b.yellow, 0.07, 0.15, -3.9, 2.85, -1.2, 'y', 8);
  cyl(b.lamp, 0.09, 0.14, -2.95, 2.85, 0, 'y', 10); // lampu suar oranye
  return b;
}

// --- boom ----------------------------------------------------------------------

/** Boom luar: grup berpusat di pivot, memanjang +X. */
function buildBoomOuter(): Bucket {
  const b = bucket();
  const L = RS.outerLen;
  // Profil sedikit meruncing: tinggi 1,15 m di pangkal, 0,85 m di ujung.
  prism(b.yellow, [[-0.35, -0.55], [L, -0.42], [L, 0.43], [-0.35, 0.6]], 0.9, 0);
  // Pelat pin & dudukan silinder di bawah, kerah di ujung.
  cyl(b.grey, 0.2, 1.0, 0, 0, 0, 'z', 14);
  box(b.yellow, 0.5, 0.25, 0.95, 3.4, -0.55, 0);
  box(b.yellow, 0.35, 1.05, 1.05, L - 0.15, 0, 0);
  for (const sz of [1, -1]) cyl(b.grey, 0.09, 0.08, L - 0.15, 0.25, sz * 0.55, 'z', 10);
  // Papan kode alat di kedua sisi boom (tekstur kanvas, lihat label()).
  for (const sz of [1, -1]) {
    const g = new THREE.PlaneGeometry(2.4, 0.5).toNonIndexed();
    if (sz < 0) g.rotateY(Math.PI);
    g.translate(2.6, 0.05, sz * 0.452);
    b.label.push(g);
  }
  // Lampu kerja di sisi boom.
  box(b.lamp, 0.2, 0.12, 0.12, 4.6, 0.55, 0.3);
  return b;
}

/** Boom dalam (hitam), meluncur keluar dari ujung boom luar. */
function buildBoomInner(): Bucket {
  const b = bucket();
  const L = RS.innerLen;
  const x0 = RS.innerStart;
  const px = x0 + RS.pinAlong;
  box(b.black, L, 0.62, 0.62, x0 + L / 2, 0, 0);
  // Kepala ujung: garpu ke rotator spreader, pin di bawahnya.
  for (const sz of [1, -1]) prism(b.black, [[px - 0.3, -0.3], [px + 0.3, -0.3], [px + 0.2, -RS.pinDrop - 0.15], [px - 0.2, -RS.pinDrop - 0.15]], 0.14, sz * 0.27);
  box(b.black, 0.7, 0.35, 0.7, px, -0.2, 0);
  cyl(b.grey, 0.12, 0.7, px, -RS.pinDrop, 0, 'z', 12);
  return b;
}

// --- spreader ------------------------------------------------------------------

/**
 * Spreader: titik nol di pin gantung (ujung boom), tergantung DATAR di
 * bawahnya; alas twistlock di y = -RS.hang. Panjangnya pada Z.
 */
function buildSpreader(): Bucket {
  const b = bucket();
  const len = BOX.len20;
  const yTop = -RS.hang + 0.75;
  // Kepala rotator: yoke miring dua sisi + piringan putar + rumah motor.
  for (const sz of [1, -1]) prism(b.grey, [[-0.35, 0.05], [0.35, 0.05], [0.55, yTop + 0.25], [-0.55, yTop + 0.25]], 0.16, sz * 0.42);
  cyl(b.grey, 0.55, 0.22, 0, yTop + 0.18, 0, 'y', 20);
  box(b.grey, 0.75, 0.35, 0.55, 0.45, yTop + 0.45, 0.15);
  box(b.black, 0.25, 0.25, 0.25, 0.75, yTop + 0.65, -0.25);
  // Rangka utama melintang + lengan teleskopik keluar di kedua ujung.
  box(b.grey, 1.0, 0.45, len * 0.55, 0, yTop - 0.1, 0);
  box(b.grey, 0.75, 0.35, len - 0.6, 0, yTop - 0.15, 0);
  for (const sz of [1, -1]) {
    // Balok ujung (sepanjang X, selebar kontainer) bergaris kuning-hitam.
    box(b.hazard, BOX.width, 0.38, 0.32, 0, yTop - 0.2, sz * (len / 2 - 0.16));
    for (const sx of [1, -1]) {
      const x = sx * (BOX.width / 2 - 0.15);
      const z = sz * (len / 2 - 0.16);
      box(b.black, 0.22, 0.28, 0.22, x, yTop - 0.52, z); // rumah twistlock
      cyl(b.chrome, 0.06, 0.12, x, yTop - 0.72, z, 'y', 8); // pin twistlock
      box(b.yellow, 0.12, 0.08, 0.2, x, yTop - 0.05, z); // indikator kuning
    }
  }
  // Silinder & rel samping di rangka.
  for (const sx of [1, -1]) tube(b.black, [sx * 0.42, yTop - 0.1, -len * 0.3], [sx * 0.42, yTop - 0.1, len * 0.3], 0.07, 8);
  return b;
}

// --- material ------------------------------------------------------------------

let mats: Record<Key, THREE.Material> | null = null;
const labelCache = new Map<string, THREE.Material>();

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function materials(): Record<Key, THREE.Material> {
  if (mats) return mats;
  const deckTex = canvasTex(64, 64, (g) => {
    g.fillStyle = '#9ea3a7';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#c3c7ca';
    for (let y = 4; y < 64; y += 10) for (let x = (y / 10) % 2 ? 2 : 7; x < 64; x += 10) g.fillRect(x, y, 5, 2);
  });
  deckTex.repeat.set(4, 1);
  mats = {
    yellow: new THREE.MeshPhongMaterial({ color: '#E2B23A', shininess: 30, specular: new THREE.Color('#5a4818') }),
    black: new THREE.MeshPhongMaterial({ color: '#2a2c2f', shininess: 22 }),
    grey: new THREE.MeshPhongMaterial({ color: '#4a4f55', shininess: 28, specular: new THREE.Color('#3a3f44') }),
    deck: new THREE.MeshPhongMaterial({ map: deckTex, shininess: 40 }),
    tire: new THREE.MeshPhongMaterial({ color: '#1b1c1e', shininess: 6 }),
    rim: new THREE.MeshPhongMaterial({ color: '#3c3f43', shininess: 30 }),
    glass: new THREE.MeshPhongMaterial({ color: '#33424c', shininess: 90, specular: new THREE.Color('#a9bccb'), transparent: true, opacity: 0.75 }),
    hazard: new THREE.MeshPhongMaterial({ map: hazardTexture(), shininess: 18 }),
    chrome: new THREE.MeshPhongMaterial({ color: '#c9ccce', shininess: 80, specular: new THREE.Color('#9da3a8') }),
    lamp: new THREE.MeshPhongMaterial({ color: '#e8862a', shininess: 60, emissive: new THREE.Color('#000000') }),
    red: new THREE.MeshBasicMaterial({ color: '#d8352a' }),
    label: new THREE.MeshPhongMaterial({ color: '#ffffff' }),
  };
  applyNight();
  return mats;
}

/** Papan kode alat di boom: huruf hitam tebal di atas cat kuning. */
function labelMaterial(code: string) {
  let m = labelCache.get(code);
  if (!m) {
    const t = canvasTex(512, 106, (g) => {
      g.fillStyle = '#E2B23A';
      g.fillRect(0, 0, 512, 106);
      g.fillStyle = '#16171a';
      g.font = "900 84px 'Arial Black', 'Segoe UI Black', Arial, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(code.toUpperCase(), 256, 58, 480);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    m = new THREE.MeshPhongMaterial({ map: t, shininess: 30 });
    labelCache.set(code, m);
  }
  return m;
}

let nightOn = false;
/** Lampu RS menyala saat mode malam (material bersama). */
export function setReachStackerNight(on: boolean) {
  nightOn = on;
  applyNight();
}
function applyNight() {
  if (mats) (mats.lamp as THREE.MeshPhongMaterial).emissive.set(nightOn ? '#ffd9a0' : '#000000');
}

// --- rakitan -------------------------------------------------------------------

type Parts = { body: THREE.BufferGeometry[]; outer: THREE.BufferGeometry[]; inner: THREE.BufferGeometry[]; spreader: THREE.BufferGeometry[] };
let geoCache: Record<keyof Parts, Partial<Record<Key, THREE.BufferGeometry>>> | null = null;

function mergedGeos(): NonNullable<typeof geoCache> {
  if (geoCache) return geoCache;
  const toMerged = (b: Bucket) => {
    const out: Partial<Record<Key, THREE.BufferGeometry>> = {};
    for (const k of Object.keys(b) as Key[]) {
      if (!b[k].length) continue;
      const list = b[k].map((g) => {
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        return g;
      });
      const m = mergeGeometries(list, false)!;
      m.computeBoundingSphere();
      out[k] = m;
    }
    return out;
  };
  geoCache = { body: toMerged(buildBody()), outer: toMerged(buildBoomOuter()), inner: toMerged(buildBoomInner()), spreader: toMerged(buildSpreader()) };
  return geoCache;
}

/** Silinder angkat satuan (panjang 1 pada +Y), diregangkan per pose. */
let cylUnit: { barrel: THREE.BufferGeometry; rod: THREE.BufferGeometry } | null = null;
function cylGeos() {
  if (cylUnit) return cylUnit;
  const barrel = new THREE.CylinderGeometry(0.15, 0.15, 1, 14);
  barrel.translate(0, 0.5, 0);
  const rod = new THREE.CylinderGeometry(0.075, 0.075, 1, 10);
  rod.translate(0, 0.5, 0);
  cylUnit = { barrel, rod };
  return cylUnit;
}

/** Titik pangkal silinder angkat di sasis dan dudukannya di boom (lokal boom). */
const CYL_BASE = { x: 0.95, y: 1.75 };
const CYL_BOOM_AT = 3.4;

export type ReachStackerObject = THREE.Group & {
  /** Sudut boom (radian, dari horizontal) dan panjang tambahan boom dalam (m). */
  setPose: (angle: number, ext: number) => void;
  /** Posisi alas twistlock spreader (lokal alat) untuk pose saat ini. */
  spreaderBottom: () => THREE.Vector3;
};

/**
 * Satu RS lengkap dengan kode alatnya di boom. Geometri & material dipakai
 * bersama semua unit; hanya grup, silinder, dan papan kodenya per unit.
 */
export function createReachStacker(code = 'RS01', pose: { angle: number; ext: number } = RS.rest): ReachStackerObject {
  const g = mergedGeos();
  const m = materials();
  const root = new THREE.Group() as ReachStackerObject;
  const add = (parent: THREE.Object3D, set: Partial<Record<Key, THREE.BufferGeometry>>) => {
    for (const k of Object.keys(set) as Key[]) {
      const mesh = new THREE.Mesh(set[k], k === 'label' ? labelMaterial(code) : m[k]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  };
  add(root, g.body);
  const boom = new THREE.Group();
  boom.position.set(RS.pivot.x, RS.pivot.y, 0);
  root.add(boom);
  add(boom, g.outer);
  const inner = new THREE.Group();
  boom.add(inner);
  add(inner, g.inner);
  const spreader = new THREE.Group();
  inner.add(spreader);
  add(spreader, g.spreader);

  // Dua silinder angkat: tabung (dari sasis) + batang (dari boom), dibentang tiap pose.
  const cg = cylGeos();
  const cyls = [1, -1].map((sz) => {
    const barrel = new THREE.Mesh(cg.barrel, m.black);
    const rod = new THREE.Mesh(cg.rod, m.chrome);
    root.add(barrel, rod);
    return { sz, barrel, rod };
  });

  const up = new THREE.Vector3(0, 1, 0);
  const tmp = new THREE.Vector3();
  root.setPose = (angle: number, ext: number) => {
    boom.rotation.z = angle;
    inner.position.x = ext;
    // Pin gantung spreader di ujung boom dalam; spreader selalu datar.
    spreader.position.set(RS.innerStart + RS.pinAlong, -RS.pinDrop, 0);
    spreader.rotation.z = -angle;
    const a = new THREE.Vector3(CYL_BASE.x, CYL_BASE.y, 0);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const bx = RS.pivot.x + CYL_BOOM_AT * c - -0.55 * s;
    const by = RS.pivot.y + CYL_BOOM_AT * s + -0.55 * c;
    for (const { sz, barrel, rod } of cyls) {
      const pa = a.clone().setZ(sz * 0.55);
      const pb = new THREE.Vector3(bx, by, sz * 0.55);
      const len = pa.distanceTo(pb);
      const dir = tmp.copy(pb).sub(pa).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      const bl = Math.min(len, 3.2);
      barrel.position.copy(pa);
      barrel.quaternion.copy(q);
      barrel.scale.set(1, bl, 1);
      rod.position.copy(pb);
      rod.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(up, dir.clone().negate()));
      rod.scale.set(1, Math.max(0.2, len - bl + 0.3), 1);
    }
  };
  root.spreaderBottom = () => {
    root.updateMatrixWorld(true);
    const p = new THREE.Vector3(0, -RS.hang, 0);
    spreader.localToWorld(p);
    return root.worldToLocal(p);
  };
  root.setPose(pose.angle, pose.ext);
  return root;
}

/** Jumlah segitiga satu RS (kartu palet / uji). */
export function reachStackerTriangles(): number {
  const g = mergedGeos();
  let n = 0;
  for (const part of Object.values(g)) for (const geo of Object.values(part)) n += geo!.getAttribute('position').count / 3;
  return Math.round(n);
}
