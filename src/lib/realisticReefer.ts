import * as THREE from 'three';
import { BOX } from './constants';
import { TARGET_LINEAR, type InstancedModel, type ModelPart } from './containerModel';
import { REAL_REEFER_PAINT } from './realisticPaint';
import { liveryKey, type Livery } from './livery';
import { addZone, MAP, type CodeZone } from './containerCode';
import {
  addDoorEnd,
  addFrame,
  box,
  doorUv,
  drawWeightTable,
  FRAME,
  INK,
  merge,
  triangleCount,
  type Quality,
  NARROW,
  paintMaps,
  plainDecal,
  profileNormals,
  rbox,
  rod,
  roundRect,
  sheet,
  sideUv,
  withMarkings,
  drawSideBrand,
  makeMarks,
  doorMetalMaterial,
  type PendingLogo,
  type Atlas,
  type Marks,
  type P,
  type Vec2,
  type Vec3,
} from './realisticContainer';

/**
 * Reefer realistis — duplikat BARU di samping aset reefer GLB lama (aset lama
 * tidak diubah; pilih lewat "Kontainer realistis"). Mengikuti gambar acuan:
 *
 *   - badan putih berpanel rata dengan sambungan vertikal (bukan gelombang),
 *     logo burung hitam di dinding samping;
 *   - pintu rata (tanpa panel tekan), 4 batang kunci dengan gagang rendah,
 *     kode NARU dan tabel berat di daun kanan, logo di daun kiri;
 *   - muka mesin (ujung -X): flens berbaut keliling, rangka V terbalik, panel
 *     atas dengan pelat akses berlogo dan kode NARU, ceruk mesin berisi kipas
 *     kondensor bergril, kotak kontroler berlayar, kompresor, kotak listrik,
 *     pipa dan kabel hitam.
 *
 * Marka dicampur ke cat lewat shader yang sama dengan kontainer GP realistis.
 */


// --- atlas: atas = dinding samping, bawah-kiri = pintu, bawah-kanan = muka mesin

function atlasFor(length: number): Atlas {
  const w = length > 9 ? 3072 : 2048;
  const side = Math.round((w * BOX.height) / length);
  const doorH = 1024;
  const doorW = Math.round((doorH * BOX.width) / BOX.height);
  return { w, h: side + doorH, side, doorW, doorH };
}

/** Muka mesin dilihat dari depan (-X): kanan = +Z. Dipetakan langsung dari (z, y). */
const machineUv = (A: Atlas) => (z: number, y: number): Vec2 => [
  (A.w - A.doorW + ((z + BOX.width / 2) / BOX.width) * A.doorW) / A.w,
  1 - (A.side + ((BOX.height / 2 - y) / BOX.height) * A.doorH) / A.h,
];

// --- gambar marka -----------------------------------------------------------

/**
 * Siluet merpati terbang menghadap kanan (kotak 100×100): badan elips miring,
 * kepala bulat berparuh, ekor kipas, dan dua sayap terangkat berujung bulu.
 */
const BIRD_WING_BACK: [number, number][] = [
  [44, 70], [37, 54], [28, 38], [19, 24], [12, 13], [21, 17], [20, 7], [28, 16], [30, 6],
  [36, 17], [40, 9], [44, 22], [49, 17], [52, 34], [59, 62],
];
const BIRD_WING_FRONT: [number, number][] = [
  [53, 67], [56, 48], [60, 32], [64, 17], [69, 5], [71, 17], [77, 8], [77, 21], [84, 13],
  [82, 28], [90, 23], [84, 40], [91, 39], [81, 54], [71, 65],
];
const BIRD_TAIL: [number, number][] = [
  [34, 75], [16, 80], [9, 86], [17, 85], [12, 91], [22, 87], [36, 81],
];

function drawBird(g: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const px = (x: number) => cx + ((x - 50) / 100) * size;
  const py = (y: number) => cy + ((y - 50) / 100) * size;
  const poly = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(px(x), py(y)) : g.lineTo(px(x), py(y))));
    g.closePath();
    g.fill();
  };
  g.save();
  g.lineJoin = 'round';
  poly(BIRD_WING_BACK);
  poly(BIRD_TAIL);
  // Badan dan kepala.
  g.beginPath();
  g.ellipse(px(57), py(72), (25 / 100) * size, (8.5 / 100) * size, (-14 * Math.PI) / 180, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(px(80.5), py(64.5), (6.5 / 100) * size, 0, Math.PI * 2);
  g.fill();
  poly([[85, 62.5], [94, 65.5], [85, 68]]);
  poly(BIRD_WING_FRONT);
  g.restore();
}

/** Gril kipas kondensor: daun kipas abu di balik jeruji vertikal berpotongan silang. */
function drawFan(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#e1e3e4';
  g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  // Daun kipas.
  g.fillStyle = '#a7abae';
  for (let i = 0; i < 5; i++) {
    const a = (i * Math.PI * 2) / 5;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, r * 0.95, a, a + 0.75);
    g.closePath();
    g.fill();
  }
  // Jeruji vertikal.
  g.fillStyle = '#1e2022';
  const bar = r * 0.035;
  for (let x = cx - r; x < cx + r; x += bar * 2) g.fillRect(x, cy - r, bar, 2 * r);
  // Celah silang dan hub, seperti gril empat kuadran di acuan.
  g.fillStyle = '#e8eaeb';
  g.fillRect(cx - r, cy - r * 0.06, 2 * r, r * 0.12);
  g.fillRect(cx - r * 0.06, cy - r, r * 0.12, 2 * r);
  g.fillRect(cx - r * 0.16, cy - r * 0.16, r * 0.32, r * 0.32);
  g.restore();
  g.save();
  g.strokeStyle = '#5a5e61';
  g.lineWidth = r * 0.03;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** Panel kontroler: bingkai abu tua, layar terang berangka, tombol hitam. */
function drawController(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.save();
  roundRect(g, x + w * 0.12, y + h * 0.08, w * 0.76, h * 0.84, w * 0.04);
  g.fillStyle = '#5b5f63';
  g.fill();
  // Layar.
  const sx = x + w * 0.2;
  const sy = y + h * 0.13;
  const sw = w * 0.6;
  const sh = h * 0.3;
  g.fillStyle = '#dfe5df';
  g.fillRect(sx, sy, sw, sh);
  g.fillStyle = '#26292b';
  g.font = `bold ${sh * 0.2}px ${NARROW}`;
  g.textAlign = 'right';
  g.textBaseline = 'top';
  ['0.0', '0.0', '5.0'].forEach((t, i) => g.fillText(t, sx + sw * 0.95, sy + sh * (0.12 + i * 0.27)));
  g.textAlign = 'left';
  for (let i = 0; i < 4; i++) g.strokeRect(sx + sw * (0.06 + i * 0.12), sy + sh * 0.2, sw * 0.09, sh * 0.5);
  // Tombol F1–F4 dan panah.
  g.fillStyle = '#111314';
  for (let i = 0; i < 4; i++) g.fillRect(sx + sw * (0.02 + i * 0.26), sy + sh * 1.15, sw * 0.18, sh * 0.16);
  g.beginPath();
  g.arc(x + w * 0.5, y + h * 0.66, w * 0.11, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2b8fd6';
  g.fillRect(x + w * 0.45, y + h * 0.63, w * 0.1, h * 0.05);
  g.fillStyle = '#111314';
  for (const [dx, dy] of [[0.27, 0.6], [0.73, 0.6], [0.5, 0.8]]) {
    g.beginPath();
    g.moveTo(x + w * (dx - 0.06), y + h * dy);
    g.lineTo(x + w * (dx + 0.06), y + h * dy);
    g.lineTo(x + w * dx, y + h * (dy + 0.05));
    g.closePath();
    g.fill();
  }
  g.restore();
}

/**
 * Reefer tanpa livery (atau livery NARU_REEFER) memakai logo burung bawaan
 * aset acuan. Livery lain memakai teks merek / logo berkasnya sendiri, dan
 * reefer polos (GENERIC_REEFER) tanpa logo sama sekali.
 */
const NARU: Livery = {
  code: 'NARU_REEFER',
  brand: 'NARU (reefer putih)',
  model: 'REEFER_PANEL',
  bodyColor: REAL_REEFER_PAINT,
  textColor: INK,
  brandText: null,
  logoFile: null,
  logoPos: 'CENTER',
  logoScale: 0.5,
};

function drawMarkings(
  length: number,
  A: Atlas,
  liv: Livery,
): { canvas: HTMLCanvasElement; zones: CodeZone[]; pending: PendingLogo[] } {
  const pending: PendingLogo[] = [];
  const bird = liv.code === 'NARU_REEFER';
  const INK = liv.textColor;
  // Semua nomor (samping, pintu, muka mesin) adalah nomor ASLI tiap kontainer,
  // digambar shader per instance di zona-zona ini (lihat containerCode.ts).
  const zones: CodeZone[] = [];
  const cv = document.createElement('canvas');
  cv.width = A.w;
  cv.height = A.h;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, A.w, A.h);
  g.fillStyle = INK;
  g.strokeStyle = INK;
  const H = BOX.height;
  const W = BOX.width;
  const is40 = length > 9;

  // ---- dinding samping: burung besar di tengah, kode kecil kanan atas.
  const k = A.w / length;
  const m = (v: number) => v * k;
  if (bird) drawBird(g, m(length / 2), m(H * 0.5), m(H * (is40 ? 0.58 : 0.5)));
  else drawSideBrand(g, liv, length, m, pending);
  g.fillStyle = INK;
  addZone(zones, m(length - 0.42), m(0.3), m(0.1), MAP.fullSpaced, 'right');
  addZone(zones, m(length - 0.42), m(0.44), m(0.1), MAP.iso, 'right');

  // ---- pintu (kiri kanvas = +Z, dilihat dari belakang)
  const dx = (zFromLeft: number) => (zFromLeft / W) * A.doorW;
  const dy = (mFromTop: number) => A.side + (mFromTop / H) * A.doorH;
  const ds = (v: number) => (v / H) * A.doorH;
  if (bird) drawBird(g, dx(0.62), dy(0.72), ds(0.42));
  addZone(zones, dx(1.7), dy(0.5), ds(0.13), MAP.owner);
  addZone(zones, dx(1.7), dy(0.66), ds(0.13), MAP.serialCheck);
  addZone(zones, dx(1.7), dy(0.84), ds(0.08), MAP.iso);
  const rows: [string, string, string][] = is40
    ? [
        ['GROSS WT', '76,190 LB', '34,560 KG'],
        ['PAYLOAD', '66,140 LB', '30,000 KG'],
        ['TARE WT', '10,050 LB', '4,560 KG'],
        ['CUBE', '2,370 FT', '67.3 M'],
      ]
    : [
        ['GROSS WT', '67,200 LB', '30,480 KG'],
        ['PAYLOAD', '60,430 LB', '27,410 KG'],
        ['TARE WT', '6,770 LB', '3,070 KG'],
        ['CUBE', '1,000 FT', '28.3 M'],
      ];
  g.fillStyle = INK;
  drawWeightTable(g, rows, dx(1.3), dx(1.92), dx(2.24), dy(1.42), ds(0.055), ds(0.085));

  // ---- muka mesin (koordinat z, y langsung)
  const mx = (z: number) => A.w - A.doorW + ((z + W / 2) / W) * A.doorW;
  const my = (y: number) => A.side + ((H / 2 - y) / H) * A.doorH;
  const msz = (v: number) => (v / H) * A.doorH;
  if (bird) drawBird(g, mx(0), my(0.8), msz(0.26));
  g.fillStyle = INK;
  addZone(zones, mx(-0.36), my(0.3) - msz(0.17) / 2, msz(0.17), MAP.owner, 'center');
  addZone(zones, mx(0.32), my(0.3) - msz(0.17) / 2, msz(0.17), MAP.serialCheck, 'center');
  drawFan(g, mx(0), my(-0.36), msz(0.33));
  drawController(g, mx(0.55), my(0.01), msz(0.38), msz(0.62));

  return { canvas: cv, zones, pending };
}

// --- geometri ---------------------------------------------------------------

/** Panel rata dengan alur sambungan dangkal tiap `pitch` (dinding reefer). */
function seamed(a: number, b: number, pitch: number, groove = 0.03, depth = 0.006): P[] {
  const n = Math.max(1, Math.round((b - a) / pitch));
  const p = (b - a) / n;
  const pts: [number, number][] = [[a, depth]];
  for (let i = 0; i < n; i++) {
    const s = a + i * p;
    if (i > 0) pts.push([s - groove / 2, depth], [s, 0], [s + groove / 2, depth]);
  }
  pts.push([b, depth]);
  return profileNormals(pts);
}

const flat = (a: number, b: number): P[] => [
  { s: a, off: 0, ns: 0, no: 1 },
  { s: b, off: 0, ns: 0, no: 1 },
];

type Geo = { paint: THREE.BufferGeometry; dark: THREE.BufferGeometry; metal: THREE.BufferGeometry; atlas: Atlas };
const geoCache = new Map<number, Geo>();

function buildGeometry(L: number): Geo {
  const cached = geoCache.get(L);
  if (cached) return cached;
  const H = BOX.height;
  const W = BOX.width;
  const hx = L / 2;
  const hy = H / 2;
  const hz = W / 2;
  const A = atlasFor(L);
  const sUv = sideUv(A);
  const mUv = machineUv(A);
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const NX = new THREE.Vector3(-1, 0, 0);
  const { CAST, RAIL_B, RAIL_T, POST } = FRAME;

  const paint: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  // ---- dinding samping: panel rata bersambungan
  const wy0 = -hy + RAIL_B;
  const wy1 = hy - RAIL_T;
  const sidePts = seamed(-hx + POST, hx - POST, 0.42, 0.045, 0.014);
  for (const side of [1, -1]) {
    const zIn = side * (hz - 0.022);
    const u = (s: number) => (side > 0 ? (s + hx) / L : (hx - s) / L);
    paint.push(
      sheet({
        pts: sidePts,
        t0: wy0,
        t1: wy1,
        tSeg: 1,
        at: (s, t, off): Vec3 => [s, t, zIn + side * off],
        uv: (s, t) => [u(s), (t + hy) / H],
        decal: (s, t) => sUv(u(s), (t + hy) / H),
        sAxis: X,
        outward: new THREE.Vector3(0, 0, side),
      }),
    );
  }

  // ---- atap rata bersambungan
  paint.push(
    sheet({
      pts: seamed(-hx + CAST.x, hx - CAST.x, 0.6, 0.04, 0.008),
      t0: -hz + RAIL_T,
      t1: hz - RAIL_T,
      tSeg: 1,
      at: (s, t, off) => [s, hy - 0.03 + off, t],
      uv: (s, t) => [(s + hx) / L, (t + hz) / W],
      sAxis: X,
      outward: Y,
    }),
  );

  // ---- pintu & rangka (bersama GP)
  const metal: THREE.BufferGeometry[] = [];
  addDoorEnd(paint, dark, L, doorUv(A), { ribs: false, handleY: -0.6, sealY: -0.05, metal });
  addFrame(paint, dark, L, false);

  // ---- muka mesin (ujung -X)
  const F = -hx;
  const zi = hz - 0.2; // tepi dalam bukaan mesin
  const yt = hy - 0.17;
  const yb = -hy + 0.3;
  const yMid = 0.12; // batas panel atas / ceruk
  paint.push(rbox(0.12, 0.12, W - 2 * POST, F + 0.06, hy - 0.06, 0));
  paint.push(rbox(0.12, 0.3, W - 2 * POST, F + 0.06, -hy + 0.15, 0));

  // Flens keliling + baut.
  const flW = 0.08;
  paint.push(rbox(0.03, flW, 2 * zi + 2 * flW, F + 0.055, yt + flW / 2, 0, 0.006));
  paint.push(rbox(0.03, flW, 2 * zi + 2 * flW, F + 0.055, yb - flW / 2, 0, 0.006));
  for (const ez of [1, -1]) paint.push(rbox(0.03, yt - yb + 2 * flW, flW, F + 0.055, (yt + yb) / 2, ez * (zi + flW / 2), 0.006));
  const bolt = (y: number, z: number) => dark.push(rod(0.017, 0.02, F + 0.035, y, z, 'x', 8));
  for (let i = 0; i <= 8; i++) {
    const z = -zi + (2 * zi * i) / 8;
    bolt(yt + flW / 2, z);
    bolt(yb - flW / 2, z);
  }
  for (let i = 1; i < 7; i++) {
    const y = yb + ((yt - yb) * i) / 7;
    bolt(y, zi + flW / 2);
    bolt(y, -zi - flW / 2);
  }

  const mSheet = (x: number, z0: number, z1: number, y0: number, y1: number, decal: boolean) =>
    paint.push(
      sheet({
        pts: flat(z0, z1),
        t0: y0,
        t1: y1,
        tSeg: 1,
        at: (z, y, off) => [x - off, y, z],
        uv: (z, y) => [(z + hz) / W, (y + hy) / H],
        decal: decal ? (z, y) => mUv(z, y) : undefined,
        sAxis: Z,
        outward: NX,
      }),
    );

  // Panel atas bermarka, pelat akses berlogo dengan tab berbaut, bibir di bawah kode.
  mSheet(F + 0.07, -zi, zi, yMid, yt, true);
  paint.push(rbox(0.012, 0.5, 1.1, F + 0.064, 0.78, 0, 0.004));
  mSheet(F + 0.0575, -0.55, 0.55, 0.53, 1.03, true);
  for (const ty of [1.06, 0.5]) {
    for (const tz of [-0.42, 0.42]) {
      paint.push(box(0.012, 0.06, 0.13, F + 0.064, ty, tz));
      for (const bz of [-0.03, 0.03]) dark.push(rod(0.01, 0.012, F + 0.056, ty, tz + bz, 'x', 6));
    }
  }
  paint.push(rbox(0.06, 0.035, 2 * zi, F + 0.09, yMid, 0, 0.008));

  // Ceruk mesin: dinding belakang, sisi, langit-langit, lantai.
  const back = F + 0.3;
  mSheet(back, -zi, zi, yb, yMid, false);
  for (const ez of [1, -1]) {
    paint.push(
      sheet({
        pts: flat(F + 0.07, back),
        t0: yb,
        t1: yMid,
        tSeg: 1,
        at: (x, y, off) => [x, y, ez * (zi - off)],
        uv: (x, y) => [(x - F) / 0.3, (y + hy) / H],
        sAxis: X,
        outward: new THREE.Vector3(0, 0, -ez),
      }),
    );
  }
  paint.push(
    sheet({
      pts: flat(-zi, zi),
      t0: F + 0.07,
      t1: back,
      tSeg: 1,
      at: (z, x, off) => [x, yMid - off, z],
      uv: (z, x) => [(z + hz) / W, (x - F) / 0.3],
      sAxis: Z,
      outward: new THREE.Vector3(0, -1, 0),
    }),
  );
  paint.push(
    sheet({
      pts: flat(-zi, zi),
      t0: F + 0.07,
      t1: back,
      tSeg: 1,
      at: (z, x, off) => [x, yb + off, z],
      uv: (z, x) => [(z + hz) / W, (x - F) / 0.3],
      sAxis: Z,
      outward: Y,
    }),
  );

  // Rangka V terbalik dari sudut atas ke tengah bawah.
  for (const ez of [1, -1]) {
    const z0 = ez * (zi - 0.04);
    const y0 = yt - 0.02;
    const z1 = ez * 0.05;
    const y1 = yb + 0.02;
    const len = Math.hypot(z1 - z0, y1 - y0);
    const g = rbox(0.05, len, 0.075, 0, 0, 0, 0.01);
    g.rotateX(Math.atan2(z1 - z0, y1 - y0));
    g.translate(F + 0.08, (y0 + y1) / 2, (z0 + z1) / 2);
    paint.push(g);
  }

  // Kipas kondensor (gril di tekstur), baki di bawahnya.
  mSheet(F + 0.14, -0.62, 0.62, -0.8, yMid - 0.02, true);
  paint.push(rbox(0.16, 0.05, 1.15, F + 0.17, -0.8, 0, 0.008));

  // Kotak kontroler berlayar (kanan, +Z).
  paint.push(rbox(0.14, 0.62, 0.38, F + 0.19, -0.3, 0.74, 0.012));
  mSheet(F + 0.119, 0.56, 0.92, -0.6, 0.0, true);

  // Kiri: kotak listrik, rak, kompresor, akumulator, pipa.
  paint.push(rbox(0.12, 0.4, 0.45, F + 0.21, -0.12, -0.72, 0.01));
  paint.push(rbox(0.16, 0.07, 0.55, F + 0.18, -0.5, -0.67, 0.008));
  paint.push(rod(0.12, 0.4, F + 0.2, -0.76, -0.75, 'y', 14));
  paint.push(box(0.2, 0.03, 0.3, F + 0.2, -0.97, -0.75));
  paint.push(rod(0.07, 0.22, F + 0.2, -0.33, -0.86, 'y', 12));
  dark.push(rod(0.016, 0.42, F + 0.2, -0.3, -0.97, 'y', 6));
  dark.push(rod(0.016, 0.3, F + 0.22, -0.35, -0.6, 'y', 6));
  // Kabel hitam ke kontroler.
  dark.push(rod(0.02, 1.25, F + 0.24, -0.62, 0.0, 'z', 8));
  dark.push(rod(0.02, 0.22, F + 0.24, -0.52, 0.64, 'y', 8));
  dark.push(rod(0.02, 0.22, F + 0.24, -0.52, 0.84, 'y', 8));
  // Kotak bawah kanan.
  paint.push(rbox(0.08, 0.28, 0.75, F + 0.25, -0.84, 0.5, 0.008));

  // Kotak dalam gelap: di belakang ceruk mesin sampai di belakang daun pintu.
  dark.push(box(L - 0.43, H - 0.12, W - 0.16, (back + 0.02 + hx - 0.11) / 2, 0, 0));

  const out: Geo = { paint: merge(paint.map(plainDecal)), dark: merge(dark), metal: merge(metal), atlas: A };
  geoCache.set(L, out);
  return out;
}

// --- material & model -------------------------------------------------------

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

type Variant = 'tint' | 'plain';
const modelCache = new Map<string, InstancedModel>();

/** Model instanced reefer realistis (parts20 + parts40), pengganti langsung aset reefer GLB. */
export function realisticReeferModel(variant: Variant, liv: Livery = NARU, quality: Quality = 'yard'): InstancedModel {
  const cacheKey = `${variant}|${quality}|${liveryKey(liv)}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;
  const { tex, normal, mean } = paintMaps();
  const level = TARGET_LINEAR / mean;
  const paintColor = new THREE.Color();
  if (variant === 'plain') paintColor.set(liv.bodyColor).multiplyScalar(level);
  else paintColor.setRGB(level, level, level, THREE.LinearSRGBColorSpace);

  const dark = new THREE.MeshPhongMaterial({
    color: new THREE.Color('#202325'),
    shininess: 12,
    specular: new THREE.Color('#15181b'),
  });

  const partsFor = (L: number): ModelPart[] => {
    const geo = buildGeometry(L);
    const paint = new THREE.MeshPhongMaterial({
      color: paintColor,
      map: tex,
      normalMap: quality === 'inspect' ? normal : null,
      normalScale: new THREE.Vector2(0.35, 0.35),
      shininess: 30,
      specular: new THREE.Color('#3a4048'),
    });
    withMarkings(paint, marksTexture(L, geo.atlas, liv), liv.textColor);
    return [
      { name: `reefer-${liv.code}-${L}-paint`, geometry: geo.paint, material: paint },
      { name: `reefer-${liv.code}-${L}-dark`, geometry: geo.dark, material: dark },
      { name: `reefer-${liv.code}-${L}-metal`, geometry: geo.metal, material: doorMetalMaterial() },
    ];
  };

  const model: InstancedModel = { parts20: partsFor(BOX.len20), parts40: partsFor(BOX.len40) };
  modelCache.set(cacheKey, model);
  return model;
}

/** Jumlah segitiga per reefer (untuk README / uji). */
export function realisticReeferTriangles(L: number = BOX.len20): number {
  const g = buildGeometry(L);
  return triangleCount(g.paint) + triangleCount(g.dark) + triangleCount(g.metal);
}
