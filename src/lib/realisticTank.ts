import * as THREE from 'three';
import { BOX } from './constants';
import { TARGET_LINEAR, type InstancedModel, type ModelPart } from './containerModel';
import { liveryKey, type Livery } from './livery';
import { addZone, MAP, type CodeZone } from './containerCode';
import {
  box,
  drawCode,
  drawWeightTable,
  makeMarks,
  merge,
  NARROW,
  NO_DECAL,
  paintMaps,
  plainDecal,
  rbox,
  rod,
  roundRect,
  triangleCount,
  withMarkings,
  type Atlas,
  type Marks,
  type PendingLogo,
  type Quality,
  type Vec2,
} from './realisticContainer';

/**
 * ISO tank realistis — duplikat BARU di samping aset tank GLB lama (aset lama
 * tidak diubah dan tetap dipakai tank yang tidak punya livery TANK di
 * master). Mengikuti foto tank Seaco: rangka balok navy dengan diagonal di
 * kedua ujung, tabung putih berkepala cembung, walkway & manlid di atas,
 * tangga di ujung, kotak dokumen, katup bawah, dan pipa uap di samping.
 *
 * Marka dicampur ke cat tabung lewat shader yang sama dengan GP/reefer
 * (withMarkings), termasuk NOMOR ASLI tiap tank di samping dan di ujung.
 *
 * Panjang selalu 20ft (tank di lapangan ini hanya 20ft), memanjang pada
 * sumbu X seperti model GP.
 */

const L = BOX.len20;
const H = BOX.height;
const W = BOX.width;
const hx = L / 2;
const hy = H / 2;
const hz = W / 2;

/** Jari-jari tabung, pusatnya, ujung bagian silinder, dan dalam kepala cembung. */
const R = 1.1;
const YC = 0.05;
const XC = hx - 0.62;
const HEAD = 0.4;
/** Pita marka di samping tabung: ±55° dari sumbu Z. */
const BAND = (55 * Math.PI) / 180;
const BAND_Y0 = YC - R * Math.sin(BAND);
const BAND_Y1 = YC + R * Math.sin(BAND);
const BAND_H = BAND_Y1 - BAND_Y0;

/** Warna rangka (navy Seaco) dan logam (tangga, kotak, pipa). */
const FRAME_COLOR = '#1F2C4E';
const METAL_COLOR = '#B9BDC1';

/**
 * Atlas: atas = pita samping (panjang × tinggi pita), bawah-kiri = kepala
 * tabung ujung +X (persegi 2R × 2R, proyeksi datar).
 */
function atlasFor(): Atlas {
  const w = 2048;
  const side = Math.round((w * BAND_H) / L);
  const doorH = 1024;
  return { w, h: side + doorH, side, doorW: doorH, doorH };
}

type V3 = [number, number, number];

/** Pita silinder di antara sudut φ0..φ1 (φ=0 menghadap +Z), dengan decal opsional. */
function shellStrip(
  phi0: number,
  phi1: number,
  seg: number,
  decal: ((x: number, y: number) => Vec2) | null,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const duv: number[] = [];
  const at = (x: number, phi: number) => {
    const ny = Math.sin(phi);
    const nz = Math.cos(phi);
    const y = YC + R * ny;
    pos.push(x, y, R * nz);
    nor.push(0, ny, nz);
    uv.push((x + hx) / L, phi / (Math.PI * 2));
    duv.push(...(decal ? decal(x, y) : NO_DECAL));
  };
  for (let i = 0; i < seg; i++) {
    const a = phi0 + ((phi1 - phi0) * i) / seg;
    const b = phi0 + ((phi1 - phi0) * (i + 1)) / seg;
    // Hadap keluar: urutan (x0,a) (x0,b) (x1,b) untuk φ naik berlawanan jarum
    // jam dilihat dari +X.
    at(-XC, a);
    at(XC, a);
    at(XC, b);
    at(-XC, a);
    at(XC, b);
    at(-XC, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('decalUv', new THREE.Float32BufferAttribute(duv, 2));
  return g;
}

/**
 * Kepala tabung cembung (setengah elipsoid) di ujung `dir` (+1 = +X).
 * Normal dari gradien elipsoid, jadi sorotannya membulat mulus.
 */
function head(dir: 1 | -1, seg: number, rings: number, decal: ((y: number, z: number) => Vec2) | null) {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const duv: number[] = [];
  const vert = (alpha: number, phi: number) => {
    const r = R * Math.cos(alpha);
    const x = dir * (XC + HEAD * Math.sin(alpha));
    const y = YC + r * Math.sin(phi);
    const z = r * Math.cos(phi);
    // Gradien (x'/a², y'/R², z'/R²) dengan x' = jarak dari pangkal kepala.
    const n = new THREE.Vector3((dir * HEAD * Math.sin(alpha)) / (HEAD * HEAD), (y - YC) / (R * R), z / (R * R)).normalize();
    pos.push(x, y, z);
    nor.push(n.x, n.y, n.z);
    uv.push((y + R) / (2 * R), (z + R) / (2 * R));
    duv.push(...(decal ? decal(y, z) : NO_DECAL));
  };
  for (let i = 0; i < rings; i++) {
    const a0 = (Math.PI / 2) * (i / rings);
    const a1 = (Math.PI / 2) * ((i + 1) / rings);
    for (let j = 0; j < seg; j++) {
      const p0 = (Math.PI * 2 * j) / seg;
      const p1 = (Math.PI * 2 * (j + 1)) / seg;
      const quad: [number, number][] =
        dir > 0
          ? [[a0, p0], [a1, p0], [a1, p1], [a0, p0], [a1, p1], [a0, p1]]
          : [[a0, p0], [a1, p1], [a1, p0], [a0, p0], [a0, p1], [a1, p1]];
      for (const [a, p] of quad) vert(a, p);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('decalUv', new THREE.Float32BufferAttribute(duv, 2));
  return g;
}

/** Balok persegi dari titik a ke b (diagonal rangka). */
function beam(a: V3, b: V3, t: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(len, t, t).toNonIndexed();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vb.clone().sub(va).normalize());
  g.applyQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  g.translate(mid.x, mid.y, mid.z);
  return g;
}

/** Cincin (pita insulasi / sadel) mengelilingi tabung di x. */
function ring(x: number, r: number, tube: number, seg: number) {
  const g = new THREE.TorusGeometry(r, tube, 4, seg).toNonIndexed();
  g.rotateY(Math.PI / 2);
  g.translate(x, YC, 0);
  return g;
}

type Geo = {
  paint: THREE.BufferGeometry;
  frame: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  atlas: Atlas;
};
const geoCache = new Map<Quality, Geo>();

function buildGeometry(q: Quality): Geo {
  const hit = geoCache.get(q);
  if (hit) return hit;
  const hi = q === 'inspect';
  const A = atlasFor();
  const seg = hi ? 16 : 8; // segmen per pita (4 pita = 64 / 32 keliling)
  const paint: THREE.BufferGeometry[] = [];
  const frame: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];

  // ---- tabung: 4 pita dengan vertex sendiri-sendiri, supaya decalUv pita
  // samping tidak terinterpolasi ke titik "tanpa marka" (garis di atlas).
  const sideT = (y: number) => (y - BAND_Y0) / BAND_H;
  const sideUv = (u01: number, t01: number): Vec2 => [u01, 1 - ((1 - t01) * A.side) / A.h];
  paint.push(shellStrip(-BAND, BAND, seg, (x, y) => sideUv((x + hx) / L, sideT(y))));
  paint.push(shellStrip(Math.PI - BAND, Math.PI + BAND, seg, (x, y) => sideUv((hx - x) / L, sideT(y))));
  paint.push(shellStrip(BAND, Math.PI - BAND, seg, null));
  paint.push(shellStrip(Math.PI + BAND, Math.PI * 2 - BAND, seg, null));
  // Kepala: +X bermarka (proyeksi datar; dilihat dari +X, kanan = -Z).
  const endUv = (y: number, z: number): Vec2 => {
    const u01 = (R - z) / (2 * R);
    const t01 = (y - (YC - R)) / (2 * R);
    return [(u01 * A.doorW) / A.w, 1 - (A.side + (1 - t01) * A.doorH) / A.h];
  };
  paint.push(head(1, seg * 4, hi ? 8 : 5, endUv));
  paint.push(head(-1, seg * 4, hi ? 8 : 5, null));
  // Pita insulasi tipis (baja tahan karat di atas cladding).
  for (const x of [-XC + 0.05, -XC / 3, XC / 3, XC - 0.05]) metal.push(ring(x, R + 0.004, 0.012, seg * 4));

  // ---- rangka navy
  const POST = 0.16;
  for (const ex of [1, -1]) {
    const xe = ex * (hx - POST / 2);
    // Tiang sudut, palang atas & bawah ujung.
    for (const ez of [1, -1]) frame.push(rbox(POST, H - 0.2, POST, xe, 0, ez * (hz - POST / 2), 0.015));
    frame.push(rbox(POST, 0.14, W - 0.3, xe, hy - 0.07, 0, 0.012));
    frame.push(rbox(POST, 0.16, W - 0.3, xe, -hy + 0.08, 0, 0.012));
    // Sadel: cincin rangka di pangkal kepala, diagonal dari keempat sudut.
    const xs = ex * (XC + 0.02);
    frame.push(ring(xs, R + 0.03, 0.05, seg * 4));
    for (const ez of [1, -1]) {
      for (const ey of [1, -1]) {
        const corner: V3 = [ex * (hx - POST / 2), ey * (hy - 0.12), ez * (hz - 0.12)];
        const onRing: V3 = [xs, YC + ey * (R + 0.03) * Math.SQRT1_2, ez * (R + 0.03) * Math.SQRT1_2];
        frame.push(beam(corner, onRing, 0.11));
      }
    }
  }
  // Rel samping atas & bawah sepanjang tank.
  for (const ez of [1, -1]) {
    frame.push(rbox(L - 0.3, 0.16, 0.12, 0, -hy + 0.08, ez * (hz - 0.06), 0.014));
    frame.push(rbox(L - 0.3, 0.12, 0.1, 0, hy - 0.06, ez * (hz - 0.05), 0.014));
  }
  // Corner casting.
  for (const ex of [1, -1])
    for (const ey of [1, -1])
      for (const ez of [1, -1]) {
        dark.push(rbox(0.178, 0.118, 0.162, ex * (hx - 0.089), ey * (hy - 0.059), ez * (hz - 0.081), 0.012));
      }

  // ---- atas: walkway kisi gelap di atas penyangga, manlid & katup.
  const top = YC + R;
  dark.push(box(L - 1.6, 0.025, 0.56, 0, top + 0.1, 0));
  for (const x of [-1.8, -0.6, 0.6, 1.8]) metal.push(box(0.05, 0.1, 0.5, x, top + 0.04, 0));
  metal.push(rod(0.3, 0.14, 0, top + 0.06, 0, 'y', hi ? 20 : 12));
  metal.push(rod(0.26, 0.03, 0, top + 0.15, 0, 'y', hi ? 20 : 12));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    dark.push(rod(0.02, 0.07, Math.cos(a) * 0.28, top + 0.16, Math.sin(a) * 0.28, 'y', 6));
  }
  metal.push(rod(0.07, 0.22, 0.9, top + 0.1, 0.12, 'y', 10));
  dark.push(rod(0.09, 0.03, 0.9, top + 0.22, 0.12, 'y', 10));

  // ---- ujung +X: tangga di sisi -Z, kotak dokumen di sisi +Z, katup bawah.
  const lx = hx - 0.1;
  for (const z of [-0.55, -0.85]) metal.push(rod(0.018, H - 0.3, lx, 0, z, 'y', 6));
  for (let i = 0; i < 9; i++) metal.push(rod(0.012, 0.3, lx, -hy + 0.35 + i * 0.25, -0.7, 'z', 5));
  metal.push(box(0.14, 0.55, 0.3, hx - 0.12, -0.15, 0.82));
  dark.push(box(0.01, 0.5, 0.26, hx - 0.05, -0.15, 0.82));
  dark.push(box(0.28, 0.2, 0.3, hx - 0.3, YC - R + 0.08, 0));
  metal.push(rod(0.05, 0.22, hx - 0.2, YC - R + 0.04, 0, 'x', 10));
  dark.push(rod(0.07, 0.03, hx - 0.07, YC - R + 0.04, 0, 'x', 10));

  // ---- pipa uap di sisi +Z, bawah (foto ke-2), dengan katup.
  const py = YC - R * 0.8;
  const pz = Math.sqrt(R * R - (py - YC) ** 2) + 0.06;
  metal.push(rod(0.03, L - 1.6, 0, py, pz, 'x', 8));
  metal.push(rod(0.025, L - 2.0, 0, py - 0.22, pz - 0.05, 'x', 8));
  for (const x of [-1.7, -0.6, 0.5, 1.6]) {
    metal.push(rod(0.02, 0.22, x, py - 0.11, pz - 0.02, 'y', 6));
    dark.push(box(0.08, 0.06, 0.08, x, py, pz + 0.02));
  }

  const out: Geo = {
    paint: merge(paint),
    frame: merge(frame.map(plainDecal)),
    metal: merge(metal.map(plainDecal)),
    dark: merge(dark.map(plainDecal)),
    atlas: A,
  };
  geoCache.set(q, out);
  return out;
}

// --- marka -------------------------------------------------------------------

/** Tata letak bermerek per livery tank; tanpa entri = hanya nomor & stiker. */
const TANK_BRAND: Record<string, 'seaco'> = { SEACO_TANK: 'seaco' };

/** Baris teks kecil abu (panduan operasi) — terbaca sebagai blok teks. */
function textBlock(g: CanvasRenderingContext2D, x: number, y: number, w: number, lines: number, h: number) {
  const words = ['CONNECT', 'AIR', 'VALVE', 'OUTLET', 'BEFORE', 'LOADING', 'ENSURE', 'MAX', 'PRESSURE', 'DISCHARGE', 'STEAM', 'CLOSED'];
  g.save();
  g.fillStyle = '#4a4f55';
  g.font = `600 ${h}px ${NARROW}`;
  for (let i = 0; i < lines; i++) {
    let t = `${i + 1}. `;
    let k = i * 3;
    while (g.measureText(t).width < w * (0.75 + ((i * 37) % 25) / 100)) t += words[k++ % words.length] + ' ';
    g.fillText(t, x, y + i * h * 1.45);
  }
  g.restore();
}

/**
 * Nama merek yang ditulis di kode, warna = warna tulisan livery. Dipakai
 * merek tanpa berkas logo (K Line, CTP) dan merek yang logonya TEGAK (SPIL,
 * Tanto) — logo tegak di pita tabung yang melebar menjadi terlalu kecil.
 */
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Arial Black', Arial, 'Segoe UI', sans-serif";
const TANK_TEXT: Record<string, { text: string; font: string }> = {
  KLINE_TANK: { text: '“K” LINE', font: SERIF },
  CTP_TANK: { text: 'CTP', font: SERIF },
  SPIL_TANK: { text: 'SPIL', font: SANS },
  TANTO_TANK: { text: 'TANTO', font: SANS },
};

function drawMarkings(A: Atlas, liv: Livery): { canvas: HTMLCanvasElement; zones: CodeZone[]; pending: PendingLogo[] } {
  const zones: CodeZone[] = [];
  const pending: PendingLogo[] = [];
  const cv = document.createElement('canvas');
  cv.width = A.w;
  cv.height = A.h;
  const g = cv.getContext('2d')!;
  const INK = liv.textColor;
  g.fillStyle = INK;
  g.strokeStyle = INK;
  g.textBaseline = 'top';
  const brand = TANK_BRAND[liv.code];

  // ---- pita samping (meter → px). x dari ujung kiri, y dari tepi atas pita.
  const k = A.w / L;
  const m = (v: number) => v * k;
  const x0 = hx - XC; // awal silinder

  // Nomor kanan atas & kode ISO.
  const codeH = m(0.13);
  const right = m(L - x0 - 1.0);
  drawCode(g, zones, right, m(0.2), codeH, true);
  addZone(zones, right - m(1.05), m(0.2) + codeH * 1.5, codeH, MAP.iso);

  // Stiker CAUTION kuning dan wajik kecil.
  const cx0 = m(L - x0 - 0.88);
  g.fillStyle = '#F3C316';
  g.fillRect(cx0, m(0.18), m(0.42), m(0.36));
  g.fillStyle = '#1c1e20';
  g.font = `bold ${m(0.06)}px ${NARROW}`;
  g.textAlign = 'center';
  ['CAUTION', `9'6" HIGH`, `8' WIDE`, 'CONTAINER'].forEach((t, i) => g.fillText(t, cx0 + m(0.21), m(0.22 + i * 0.075)));
  g.textAlign = 'left';
  g.fillStyle = '#F3C316';
  g.save();
  g.translate(cx0 - m(0.2), m(0.42));
  g.rotate(Math.PI / 4);
  g.fillRect(-m(0.05), -m(0.05), m(0.1), m(0.1));
  g.restore();

  if (brand === 'seaco') {
    // "seaco" merah, huruf kecil tebal membulat, kiri atas pita.
    g.fillStyle = '#D3232A';
    g.textBaseline = 'alphabetic';
    const px = m(0.5);
    g.font = `800 ${px}px 'Arial Rounded MT Bold', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;
    g.fillText('seaco', m(x0 + 0.45), m(0.25) + px * 0.75);
    g.fillStyle = '#2b2f34';
    g.font = `600 ${m(0.085)}px 'Segoe UI', Arial, sans-serif`;
    g.fillText('www.seacoglobal.com', m(x0 + 0.48), m(0.25) + px * 0.75 + m(0.17));
    g.textBaseline = 'top';
  } else if (TANK_TEXT[liv.code]) {
    const t = TANK_TEXT[liv.code];
    g.fillStyle = liv.textColor;
    g.textBaseline = 'alphabetic';
    g.font = `700 ${m(0.42)}px ${t.font}`;
    g.fillText(t.text, m(x0 + 0.45), m(0.7));
    g.textBaseline = 'top';
  } else if (liv.logoFile && liv.logoPos !== 'NONE') {
    // Logo berkas agen di tempat yang sama dengan "seaco": kiri atas pita.
    // Dimuat menyusul; papan latar otomatis bila kontrasnya kurang.
    pending.push({ file: liv.logoFile, cx: m(x0 + 1.35), cy: m(0.52), w: m(1.9), h: m(0.55), body: liv.bodyColor });
  }

  // Blok teks panduan operasi kiri & kanan bawah, rambu dilarang forklift.
  textBlock(g, m(x0 + 0.42), m(BAND_H - 0.62), m(1.5), 7, m(0.035));
  textBlock(g, m(L - x0 - 2.1), m(BAND_H - 0.66), m(1.4), 7, m(0.035));
  const sx = m(L / 2 + 0.2);
  const sy = m(BAND_H - 0.45);
  const sr = m(0.12);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(sx, sy, sr, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1c1e20';
  g.fillRect(sx - sr * 0.5, sy - sr * 0.1, sr * 0.7, sr * 0.35);
  g.fillRect(sx + sr * 0.15, sy - sr * 0.45, sr * 0.1, sr * 0.7);
  g.strokeStyle = '#D3232A';
  g.lineWidth = sr * 0.16;
  g.beginPath();
  g.arc(sx, sy, sr, 0, Math.PI * 2);
  g.moveTo(sx - sr * 0.7, sy - sr * 0.7);
  g.lineTo(sx + sr * 0.7, sy + sr * 0.7);
  g.stroke();

  // ---- kepala ujung +X (2R × 2R). u dari kiri, t dari atas, dalam meter.
  const s = A.doorW / (2 * R);
  const ex = (u: number) => u * s;
  const ey = (t: number) => A.side + t * s;
  g.fillStyle = INK;
  g.strokeStyle = INK;
  if (brand === 'seaco') {
    g.font = `italic 800 ${ex(0.09)}px 'Segoe UI', Arial, sans-serif`;
    g.fillText('NT', ex(1.1), ey(0.38));
    g.font = `italic 600 ${ex(0.09)}px 'Segoe UI', Arial, sans-serif`;
    g.fillText('tank', ex(1.1) + g.measureText('NT ').width * 1.1, ey(0.38));
  }
  const ec = drawCode(g, zones, ex(0.62), ey(0.52), ex(0.11), false);
  addZone(zones, ec.x0, ey(0.69), ex(0.11), MAP.iso);
  g.fillStyle = INK;
  drawWeightTable(
    g,
    [
      ['MGW', '36000 kg', '79365 lb'],
      ['TARE', '3850 kg', '8488 lb'],
    ],
    ex(0.62),
    ex(1.05),
    ex(1.32),
    ey(0.88),
    ex(0.045),
    ex(0.06),
  );
  if (brand === 'seaco') {
    g.font = `600 ${ex(0.04)}px ${NARROW}`;
    g.fillText('Seaco SRL', ex(0.62), ey(1.04));
    g.fillText('Bridgetown, Barbados', ex(0.62), ey(1.09));
  }
  // Pelat data biru-putih dan segitiga bahaya listrik kuning.
  g.fillStyle = '#2a3f7a';
  roundRect(g, ex(0.38), ey(1.0), ex(0.2), ex(0.12), ex(0.01));
  g.fill();
  g.fillStyle = '#ffffff';
  g.fillRect(ex(0.4), ey(1.02), ex(0.16), ex(0.03));
  const tx = ex(1.5);
  const ty = ey(1.06);
  const tr = ex(0.11);
  g.fillStyle = '#F3C316';
  g.beginPath();
  g.moveTo(tx, ty - tr);
  g.lineTo(tx + tr * 1.1, ty + tr * 0.8);
  g.lineTo(tx - tr * 1.1, ty + tr * 0.8);
  g.closePath();
  g.fill();
  g.strokeStyle = '#1c1e20';
  g.lineWidth = tr * 0.1;
  g.stroke();
  g.fillStyle = '#1c1e20';
  g.beginPath();
  g.moveTo(tx + tr * 0.1, ty - tr * 0.55);
  g.lineTo(tx - tr * 0.25, ty + tr * 0.15);
  g.lineTo(tx + tr * 0.05, ty + tr * 0.1);
  g.lineTo(tx - tr * 0.12, ty + tr * 0.65);
  g.lineTo(tx + tr * 0.28, ty - tr * 0.05);
  g.lineTo(tx - tr * 0.02, ty);
  g.closePath();
  g.fill();

  return { canvas: cv, zones, pending };
}

const marksCache = new Map<string, Marks>();
function marksTexture(A: Atlas, liv: Livery): Marks {
  const key = liveryKey(liv);
  const hit = marksCache.get(key);
  if (hit) return hit;
  const { canvas, zones, pending } = drawMarkings(A, liv);
  const out = makeMarks(canvas, zones, A, pending);
  marksCache.set(key, out);
  return out;
}

// --- model -------------------------------------------------------------------

type Variant = 'tint' | 'plain';
const modelCache = new Map<string, InstancedModel>();

/**
 * Model instanced ISO tank realistis untuk satu livery (cat tabung, marka).
 * Hanya parts20: tank di lapangan selalu 20ft.
 */
export function realisticTankModel(variant: Variant, liv: Livery, quality: Quality = 'yard'): InstancedModel {
  const cacheKey = `${variant}|${quality}|${liveryKey(liv)}`;
  const hit = modelCache.get(cacheKey);
  if (hit) return hit;
  const geo = buildGeometry(quality);
  // Cladding tank bersih, tanpa belang & bintik karat peta cat GP — jadi
  // tanpa map, dan tanpa koreksi rata-rata peta itu.
  const { normal } = paintMaps();
  const paintColor = new THREE.Color();
  if (variant === 'plain') paintColor.set(liv.bodyColor);
  else paintColor.setRGB(TARGET_LINEAR, TARGET_LINEAR, TARGET_LINEAR, THREE.LinearSRGBColorSpace);

  // Cladding tabung: cat putih semi-gloss, sorotan lebih tajam dari GP.
  const paint = new THREE.MeshPhongMaterial({
    color: paintColor,
    normalMap: quality === 'inspect' ? normal : null,
    normalScale: new THREE.Vector2(0.25, 0.25),
    shininess: 55,
    specular: new THREE.Color('#4a5058'),
  });
  withMarkings(paint, marksTexture(geo.atlas, liv), liv.textColor);
  const frame = new THREE.MeshPhongMaterial({ color: new THREE.Color(FRAME_COLOR), shininess: 30, specular: new THREE.Color('#2a3040') });
  const metal = new THREE.MeshPhongMaterial({ color: new THREE.Color(METAL_COLOR), shininess: 70, specular: new THREE.Color('#9aa0a6') });
  const dark = new THREE.MeshPhongMaterial({ color: new THREE.Color('#25282b'), shininess: 10, specular: new THREE.Color('#15181b') });

  const model: InstancedModel = {
    parts20: [
      { name: `tank-${liv.code}-paint`, geometry: geo.paint, material: paint },
      { name: `tank-${liv.code}-frame`, geometry: geo.frame, material: frame },
      { name: `tank-${liv.code}-metal`, geometry: geo.metal, material: metal },
      { name: `tank-${liv.code}-dark`, geometry: geo.dark, material: dark },
    ] as ModelPart[],
    parts40: null,
  };
  modelCache.set(cacheKey, model);
  return model;
}

/** Jumlah segitiga satu tank (untuk README / uji). */
export function realisticTankTriangles(quality: Quality = 'yard'): number {
  const g = buildGeometry(quality);
  return triangleCount(g.paint) + triangleCount(g.frame) + triangleCount(g.metal) + triangleCount(g.dark);
}
