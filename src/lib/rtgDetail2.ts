import * as THREE from 'three';
import type { ModelPart } from './containerModel';
import { BOX, PITCH } from './constants';
import { box, merge, rbox, rod } from './realisticContainer';
import {
  beam,
  hazardTexture,
  railing,
  RTG_DETAIL,
  rtgDetailRailZ,
  taperedColumn,
  tube,
  type RtgDetailModel,
  type V3,
} from './rtgDetail';

/**
 * RTG detail 2 — RTG kuning terang bergaya "festoon", mengikuti gambar acuan
 * kedua (RTG detail pertama tidak diubah). Koordinat, pembagian kelompok
 * (frame / trolley / spreader / ropes), dan TINGGI yang sama dengan RTG
 * detail pertama (RTG_DETAIL), jadi animasi RtgWorks berlaku apa adanya.
 *
 * Ciri yang ditiru:
 * - 4 roda sebaris per sisi, tiap roda bergarpu U terbalik + drum pivot di
 *   bawah balok sill boks yang besar; rangka pelindung bergaris kuning-hitam;
 *   silinder kemudi abu di ujung.
 * - Rumah mesin putih di platform grating ber-braket balok-I di kedua sisi
 *   (satu dengan silencer & pipa knalpot naik di kaki); tangga zig-zag 4
 *   tingkat dengan bordes; tangga kandang dari tanah.
 * - Girder dengan walkway grating, lampu sorot di bawahnya, dan rel festoon
 *   di atas tiang Π: penjepit kabel merah dan kabel hitam menjuntai.
 * - Trolley berdek abu dengan railing, rumah drum, dudukan puli kuning,
 *   lemari listrik; kabin abu berkaca miring di gantungan navy.
 * - Spreader: badan kuning, 4 dudukan puli, kepala kerucut, blok navy,
 *   lengan teleskopik & balok ujung navy, kaki flipper.
 */

const LEG_X = 4.8;
const SILL_BOTTOM = 2.4;
const SILL_TOP = 4.4;

type Key =
  | 'yellow' | 'white' | 'grate' | 'steel' | 'dark' | 'tire' | 'glass' | 'hazard' | 'navy' | 'lamp' | 'red' | 'cable'
  | 'beam' | 'pool';
type Bucket = Record<Key, THREE.BufferGeometry[]>;
const bucket = (): Bucket => ({
  yellow: [], white: [], grate: [], steel: [], dark: [], tire: [], glass: [], hazard: [], navy: [], lamp: [], red: [], cable: [],
  beam: [], pool: [],
});

/** Tekstur grating berlubang (pelat kisi gelap dengan lubang lonjong terang). */
let grateTex: THREE.Texture | null = null;
function grateTexture() {
  if (grateTex) return grateTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2b2e31';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#8b9095';
  for (let y = 8; y < 128; y += 16) {
    for (let x = (y / 16) % 2 ? 4 : 12; x < 128; x += 16) {
      g.beginPath();
      g.ellipse(x, y, 5, 2.4, Math.PI / 5, 0, Math.PI * 2);
      g.fill();
    }
  }
  grateTex = new THREE.CanvasTexture(c);
  grateTex.colorSpace = THREE.SRGBColorSpace;
  grateTex.wrapS = grateTex.wrapT = THREE.RepeatWrapping;
  grateTex.repeat.set(3, 3);
  return grateTex;
}

/** Platform: alas abu + muka grating di atasnya. */
function platform(b: Bucket, x: number, yTop: number, z: number, w: number, d: number) {
  b.white.push(box(w, 0.16, d, x, yTop - 0.1, z));
  b.grate.push(box(w - 0.1, 0.02, d - 0.1, x, yTop - 0.01, z));
}

/** Roda besar + garpu U terbalik + drum pivot + rangka pelindung bergaris. */
function wheelUnit(b: Bucket, x: number, z: number, sz: number) {
  const r = 0.95;
  b.tire.push(rod(r, 0.72, x, r, z, 'z', 22));
  b.steel.push(rod(r * 0.55, 0.76, x, r, z, 'z', 16));
  for (const a of [0, 2.1, 4.2]) b.dark.push(rod(0.07, 0.8, x + Math.cos(a) * 0.3, r + Math.sin(a) * 0.3, z, 'z', 6));
  // Garpu: dua kaki pelat di samping roda + palang atas + drum pivot ke sill.
  for (const o of [-0.5, 0.5]) b.yellow.push(rbox(0.5, 1.15, 0.16, x, r + 0.35, z + o, 0.02));
  b.yellow.push(rbox(0.75, 0.32, 1.2, x, 1.98, z, 0.03));
  b.yellow.push(rod(0.36, 0.3, x, 2.26, z, 'y', 16));
  // Pelindung: pelat bergaris di depan & belakang roda, rel pipa kuning.
  for (const dx of [-1.25, 1.25]) b.hazard.push(box(0.05, 1.05, 1.5, x + dx, 0.72, z));
  for (const o of [-0.74, 0.74]) {
    b.yellow.push(tube([x - 1.25, 1.2, z + o], [x + 1.25, 1.2, z + o], 0.035, 6));
    b.yellow.push(tube([x - 1.25, 0.25, z + o], [x - 0.3, 1.2, z + o], 0.03, 5));
    b.yellow.push(tube([x + 1.25, 0.25, z + o], [x + 0.3, 1.2, z + o], 0.03, 5));
  }
  // Sisi luar rangka terbuka (roda tetap terlihat), hanya pipa silang.
  b.yellow.push(tube([x - 1.25, 0.25, z + sz * 0.74], [x + 1.25, 1.2, z + sz * 0.74], 0.03, 5));
}

/** Rumah mesin putih di atas platform grating ber-braket, dengan railing. */
function machineHouse(b: Bucket, z0: number, sz: number, silencer: boolean) {
  const L = LEG_X;
  const pz = z0 + sz * 1.45; // pusat platform (menonjol ke luar)
  const pw = 2 * L - 1.0;
  const pd = 3.3;
  platform(b, 0, SILL_TOP + 0.25, pz, pw, pd);
  // Braket balok-I di bawah bagian yang menonjol.
  for (let i = 0; i < 6; i++) {
    const x = -pw / 2 + 0.6 + (i * (pw - 1.2)) / 5;
    b.white.push(box(0.12, 0.5, 1.7, x, SILL_TOP - 0.15, z0 + sz * 1.9));
    b.white.push(box(0.4, 0.06, 1.7, x, SILL_TOP + 0.08, z0 + sz * 1.9));
    b.white.push(box(0.4, 0.06, 1.7, x, SILL_TOP - 0.38, z0 + sz * 1.9));
  }
  // Rumah: badan, atap, pintu ganda, jendela.
  const hz = z0 + sz * 1.15;
  b.white.push(rbox(5.0, 2.6, 2.3, -0.4, SILL_TOP + 0.25 + 1.3, hz, 0.04));
  b.white.push(box(5.2, 0.12, 2.5, -0.4, SILL_TOP + 0.25 + 2.66, hz));
  const face = hz + sz * 1.16;
  for (const dx of [-1.3, 0.2]) {
    b.steel.push(box(1.4, 2.2, 0.03, -0.4 + dx + 0.35, SILL_TOP + 1.4, face));
    b.glass.push(box(0.42, 0.42, 0.04, -0.4 + dx + 0.35, SILL_TOP + 2.0, face + sz * 0.01));
  }
  b.glass.push(box(0.04, 0.9, 1.3, -0.4 - 2.52, SILL_TOP + 1.9, hz));
  // Railing di tepi luar & samping platform.
  railing(b.white, [-pw / 2 + 0.1, SILL_TOP + 0.25, pz + sz * (pd / 2 - 0.08)], [pw / 2 - 0.1, SILL_TOP + 0.25, pz + sz * (pd / 2 - 0.08)], 1.1, 1.0);
  for (const sx of [-1, 1]) railing(b.white, [sx * (pw / 2 - 0.08), SILL_TOP + 0.25, pz - sz * (pd / 2 - 0.3)], [sx * (pw / 2 - 0.08), SILL_TOP + 0.25, pz + sz * (pd / 2 - 0.1)], 1.1, 0.9);
  if (silencer) {
    // Peredam di atap + pipa knalpot naik di kaki, berbelok keluar.
    const ry = SILL_TOP + 0.25 + 2.72;
    b.steel.push(rod(0.32, 2.4, -1.0, ry + 0.4, hz, 'x', 14));
    b.dark.push(rod(0.34, 0.08, -1.0 + 0.9, ry + 0.4, hz, 'x', 14));
    b.white.push(box(1.0, 0.7, 1.0, 1.2, ry + 0.35, hz));
    const px = -L + 0.75;
    const pzp = z0 + sz * 0.75;
    b.steel.push(tube([px, ry + 0.4, pzp], [px, 16.3, pzp], 0.12, 10));
    b.steel.push(tube([px, 16.3, pzp], [px - 1.4, 16.3, pzp], 0.12, 10));
    b.steel.push(rod(0.24, 1.0, px - 1.9, 16.3, pzp, 'x', 12));
  }
}

function buildFrame(railZ: number): Bucket {
  const D = RTG_DETAIL;
  const b = bucket();
  const L = LEG_X;
  const sillLen = 2 * L + 3.8;
  for (const sz of [1, -1]) {
    const z = sz * railZ;
    // Balok sill boks besar + pelat sambung berbaut.
    b.yellow.push(rbox(sillLen, SILL_TOP - SILL_BOTTOM, 1.15, 0, (SILL_TOP + SILL_BOTTOM) / 2, z, 0.04));
    for (const sx of [-1, 1]) {
      b.yellow.push(box(1.1, 0.9, 0.06, sx * 3.4, 2.95, z + sz * 0.6));
      b.dark.push(rod(0.1, 0.1, sx * 3.4, 2.95, z + sz * 0.65, 'z', 6));
    }
    // Empat roda sebaris.
    for (const wx of [-5.1, -1.7, 1.7, 5.1]) wheelUnit(b, wx, z, sz);
    // Silinder kemudi abu di ujung +X, dengan lengan ke garpu roda.
    b.steel.push(rod(0.24, 2.4, sillLen / 2 + 0.35, 2.6, z, 'y', 14));
    b.steel.push(rod(0.28, 0.25, sillLen / 2 + 0.35, 3.3, z, 'y', 14));
    b.steel.push(rbox(0.9, 0.55, 0.5, sillLen / 2 - 0.05, 1.4, z, 0.08));
    b.cable.push(tube([sillLen / 2 + 0.35, 3.6, z], [sillLen / 2 - 0.5, 4.2, z + sz * 0.4], 0.025, 5));
    // Kaki portal.
    for (const sx of [-1, 1]) b.yellow.push(taperedColumn(sx * L, z, SILL_TOP - 0.1, D.girderBottom + 0.1, 1.05, 1.15, 1.25, 1.0));
    // Batang pengikat berpin antar kaki.
    b.yellow.push(tube([-L + 0.5, 15.5, z], [L - 0.5, 15.5, z], 0.12, 10));
    for (const sx of [-1, 1]) b.yellow.push(box(0.3, 0.3, 0.3, sx * (L - 0.55), 15.5, z));
    // Kepala portal + platform ujung + tangga kandang ke atas.
    b.yellow.push(rbox(2 * L + 1.6, 1.5, 1.35, 0, D.girderBottom + 0.75, z, 0.04));
    platform(b, -L - 1.3, D.girderTop - 0.05, z, 1.8, 2.0);
    railing(b.white, [-L - 2.15, D.girderTop - 0.05, z - 0.95], [-L - 2.15, D.girderTop - 0.05, z + 0.95], 1.1, 0.7);
    // Rumah mesin di kedua sisi; sisi -Z dengan silencer.
    machineHouse(b, z, sz, sz < 0);
  }

  // ---- tangga zig-zag di sisi +Z (di luar bidang kaki), 4 tingkat.
  const zs = railZ + 1.35;
  const levels = [SILL_TOP + 0.25, 9.0, 13.4, 17.8, D.girderTop - 0.05];
  const xa = -L + 1.0;
  const xb = L - 1.0;
  const landing = (x: number, y: number) => {
    platform(b, x, y, zs, 1.5, 1.3);
    railing(b.white, [x - 0.7, y, zs + 0.6], [x + 0.7, y, zs + 0.6], 1.1, 0.7);
    b.white.push(beam([x, y - 0.12, zs - 0.6], [x, y - 0.12, railZ + 0.5], 0.14));
    b.white.push(beam([x, y - 0.12, zs], [x, y - 1.2, railZ + 0.55], 0.08));
  };
  for (let i = 0; i < levels.length - 1; i++) {
    const [x0, x1] = i % 2 === 0 ? [xa, xb] : [xb, xa];
    const y0 = levels[i];
    const y1 = levels[i + 1];
    for (const off of [-0.45, 0.45]) b.white.push(beam([x0, y0, zs + off], [x1, y1, zs + off], 0.06, 0.24));
    const n = Math.round((y1 - y0) / 0.24);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      b.grate.push(box(0.26, 0.04, 0.88, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, zs));
    }
    railing(b.white, [x0, y0, zs + 0.5], [x1, y1, zs + 0.5], 1.0, 1.4);
    railing(b.white, [x0, y0, zs - 0.5], [x1, y1, zs - 0.5], 1.0, 1.4);
    landing(x0, y0);
    landing(x1, y1);
  }
  // Tangga kandang dari tanah ke platform rumah mesin (ujung -X).
  const lx = -(2 * L - 1.0) / 2 - 0.35;
  const lz = railZ + 2.6;
  for (const off of [-0.25, 0.25]) b.white.push(tube([lx + off, 0.1, lz], [lx + off, SILL_TOP + 1.3, lz], 0.025, 5));
  for (let y = 0.4; y < SILL_TOP + 0.3; y += 0.3) b.white.push(tube([lx - 0.25, y, lz], [lx + 0.25, y, lz], 0.018, 4));
  for (let y = 2.0; y < SILL_TOP + 1.2; y += 0.6) {
    const hoop = new THREE.TorusGeometry(0.42, 0.02, 4, 14, Math.PI).toNonIndexed();
    hoop.rotateX(Math.PI / 2);
    hoop.translate(lx, y, lz);
    b.white.push(hoop);
  }

  // ---- girder, walkway, lampu, festoon.
  const gLen = 2 * railZ + 2.6;
  for (const sx of [1, -1]) {
    const x = sx * L;
    b.yellow.push(rbox(1.1, D.girderTop - D.girderBottom, gLen, x, (D.girderTop + D.girderBottom) / 2, 0, 0.04));
    b.steel.push(box(0.14, 0.12, gLen - 0.6, x - sx * 0.32, D.girderTop + 0.06, 0));
  }
  // Girder +X: walkway sempit + railing.
  platform(b, L + 0.85, D.girderTop + 0.02, 0, 0.7, gLen);
  railing(b.white, [L + 1.18, D.girderTop + 0.02, -gLen / 2 + 0.2], [L + 1.18, D.girderTop + 0.02, gLen / 2 - 0.2], 1.1, 1.8);
  // Girder -X: walkway lebar, railing dua sisi, lampu di bawahnya.
  const wx = -L - 1.2;
  platform(b, wx, D.girderTop + 0.02, 0, 1.3, gLen);
  for (let zz = -gLen / 2 + 0.7; zz <= gLen / 2 - 0.7; zz += 1.6) b.white.push(box(1.2, 0.22, 0.08, wx, D.girderTop - 0.16, zz));
  railing(b.white, [wx - 0.62, D.girderTop + 0.02, -gLen / 2 + 0.2], [wx - 0.62, D.girderTop + 0.02, gLen / 2 - 0.2], 1.1, 1.8);
  for (let zz = -gLen / 2 + 1.3; zz <= gLen / 2 - 1.3; zz += 2.6) {
    b.dark.push(box(0.04, 0.3, 0.04, wx, D.girderTop - 0.42, zz));
    b.dark.push(rbox(0.62, 0.24, 0.42, wx, D.girderTop - 0.66, zz, 0.03));
    b.lamp.push(box(0.52, 0.02, 0.32, wx, D.girderTop - 0.79, zz));
    // Cahaya malam: berkas kerucut dari lampu ke tanah dan genangan cahaya.
    // Hanya tampak saat mode malam (lihat setRtgDetail2Night).
    const top = D.girderTop - 0.8;
    const beam = new THREE.CylinderGeometry(0.3, 3.2, top - 0.1, 20, 1, true).toNonIndexed();
    beam.translate(wx + 1.0, (top + 0.1) / 2, zz);
    b.beam.push(beam);
    const pool = new THREE.CircleGeometry(4.2, 28).toNonIndexed();
    pool.rotateX(-Math.PI / 2);
    pool.translate(wx + 1.6, 0.08, zz);
    b.pool.push(pool);
  }
  // Rel festoon (balok-I) di atas tiang Π di tepi luar walkway.
  const fx = wx - 0.25;
  const fy = D.girderTop + 2.35;
  b.steel.push(box(0.16, 0.3, gLen + 0.4, fx, fy, 0));
  b.steel.push(box(0.36, 0.04, gLen + 0.4, fx, fy + 0.15, 0));
  for (let zz = -gLen / 2 + 0.4; zz <= gLen / 2 - 0.4; zz += 3.2) {
    b.white.push(box(0.12, fy - D.girderTop, 0.12, wx - 0.6, (fy + D.girderTop) / 2, zz));
    b.white.push(box(0.12, fy - D.girderTop - 0.6, 0.12, wx - 0.6, (fy + D.girderTop) / 2 + 0.3, zz + 0.5));
    b.white.push(box(0.5, 0.12, 0.12, wx - 0.35, fy + 0.2, zz));
  }
  // Penjepit kabel merah dari ujung -Z sampai trolley (diam di z = 0), kabel
  // hitam menjuntai di antaranya (parabola, tiga kabel sejajar).
  const clamps = 5;
  const z0c = -gLen / 2 + 1.0;
  const zc = (i: number) => z0c + ((0 - z0c) * i) / (clamps - 1);
  for (let i = 0; i < clamps; i++) {
    b.red.push(rbox(0.36, 0.5, 0.42, fx, fy - 0.38, zc(i), 0.05));
    b.dark.push(box(0.2, 0.12, 0.3, fx, fy - 0.12, zc(i)));
  }
  for (let i = 0; i < clamps - 1; i++) {
    const za = zc(i);
    const zb = zc(i + 1);
    for (const off of [-0.07, 0, 0.07]) {
      const pts: V3[] = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push([fx + off, fy - 0.62 - 2.2 * 4 * t * (1 - t), za + (zb - za) * t]);
      }
      for (let k = 0; k < 12; k++) b.cable.push(tube(pts[k], pts[k + 1], 0.035, 5));
    }
  }
  return b;
}

function buildTrolley(): Bucket {
  const D = RTG_DETAIL;
  const b = bucket();
  const L = LEG_X;
  const y0 = D.trolleyDeck;
  const xMin = -L - 0.5;
  const xMax = L + 2.9; // overhang membawa kabin di sisi +X
  const w = xMax - xMin;
  const cx0 = (xMin + xMax) / 2;
  // Kisi rangka kuning di bawah dek, dek abu, railing.
  for (const zz of [-1.7, 0, 1.7]) b.yellow.push(box(w, 0.32, 0.22, cx0, y0 + 0.16, zz));
  for (let x = xMin + 0.3; x <= xMax - 0.3; x += 1.6) b.yellow.push(box(0.22, 0.32, 3.6, x, y0 + 0.16, 0));
  b.white.push(box(w, 0.1, 3.8, cx0, y0 + 0.37, 0));
  for (const zz of [-1.85, 1.85]) railing(b.white, [xMin + 0.1, y0 + 0.42, zz], [xMax - 0.1, y0 + 0.42, zz], 1.1, 1.0);
  for (const xx of [xMin + 0.1, xMax - 0.1]) railing(b.white, [xx, y0 + 0.42, -1.85], [xx, y0 + 0.42, 1.85], 1.1, 1.0);
  // Roda trolley.
  for (const sx of [1, -1]) for (const zz of [-1.4, 1.4]) b.dark.push(rod(0.22, 0.16, sx * (L - 0.32), y0 + 0.02, zz, 'x', 10));
  // Rumah drum setengah silinder + kotak ujung.
  const drum = new THREE.CylinderGeometry(0.75, 0.75, 2.6, 18, 1, false, 0, Math.PI).toNonIndexed();
  drum.rotateZ(Math.PI / 2);
  drum.rotateX(-Math.PI / 2);
  drum.translate(-1.7, y0 + 0.42, -0.4);
  b.steel.push(drum);
  b.steel.push(box(2.6, 0.06, 1.5, -1.7, y0 + 0.45, -0.4));
  b.white.push(box(0.8, 0.75, 1.0, -3.4, y0 + 0.8, -0.4));
  b.dark.push(box(0.5, 0.6, 0.9, -1.7 + 1.55, y0 + 0.75, -0.4));
  // Dudukan puli kuning.
  for (const zz of [-0.5, 0.6]) {
    b.yellow.push(rbox(0.7, 0.5, 0.45, 1.6, y0 + 0.65, zz, 0.04));
    b.yellow.push(rod(0.42, 0.14, 1.6, y0 + 1.1, zz, 'z', 18));
  }
  b.dark.push(box(3.0, 0.05, 0.05, 0.0, y0 + 0.46, 0.1));
  // Lemari listrik tinggi.
  b.white.push(rbox(0.8, 1.6, 0.8, 3.5, y0 + 1.22, -1.2, 0.03));
  b.dark.push(box(0.6, 0.3, 0.02, 3.5, y0 + 1.5, -1.6));
  // Kabin: gantungan navy (rangka A), badan abu, kaca miring, platform+railing.
  const cx = L + 2.0;
  for (const zz of [-0.9, 0.9]) {
    b.navy.push(beam([cx - 0.9, y0, zz], [cx - 0.2, 20.85, zz * 0.6], 0.16));
    b.navy.push(beam([cx + 0.9, y0, zz], [cx + 0.2, 20.85, zz * 0.6], 0.16));
  }
  b.navy.push(box(1.6, 0.18, 2.0, cx, 20.85, 0));
  b.white.push(rbox(2.0, 1.9, 2.2, cx + 0.2, 19.85, 0, 0.06));
  // Muka kaca miring ke arah tengah bentang (sisi -X), dan kaca bawah.
  const g1 = new THREE.BoxGeometry(0.05, 1.5, 1.9).toNonIndexed();
  g1.rotateZ(-0.32);
  g1.translate(cx - 0.98, 19.75, 0);
  b.glass.push(g1);
  b.white.push(box(0.45, 0.08, 2.2, cx - 0.95, 20.78, 0));
  b.glass.push(box(1.2, 0.04, 1.6, cx - 0.2, 18.88, 0));
  for (const zz of [-1.11, 1.11]) b.glass.push(box(1.1, 0.9, 0.04, cx + 0.3, 20.0, zz));
  platform(b, cx + 0.1, 18.86, 0, 2.9, 2.9);
  railing(b.white, [cx + 1.5, 18.86, -1.4], [cx + 1.5, 18.86, 1.4], 1.05, 0.7);
  railing(b.white, [cx - 1.3, 18.86, 1.4], [cx + 1.5, 18.86, 1.4], 1.05, 0.7);
  return b;
}

function buildSpreader(): Bucket {
  const b = bucket();
  const half = BOX.len20 / 2;
  const w = BOX.width;
  // Badan kuning (pelat) + dua bukaan gelap di atasnya.
  b.yellow.push(rbox(3.5, 0.36, 2.1, 0, 0.56, 0, 0.03));
  for (const xx of [-0.85, 0.85]) b.dark.push(box(0.9, 0.02, 0.55, xx, 0.75, 0));
  // Blok navy tengah, kepala kerucut kuning.
  b.navy.push(rbox(1.7, 0.34, 1.0, 0, 0.92, 0, 0.03));
  b.navy.push(box(0.8, 0.22, 1.2, -0.95, 0.85, 0));
  b.yellow.push(new THREE.CylinderGeometry(0.24, 0.4, 0.5, 16, 1).toNonIndexed().translate(0, 1.33, 0));
  b.yellow.push(rod(0.2, 0.2, 0, 1.68, 0, 'y', 14));
  // Empat dudukan puli.
  for (const xx of [-1.3, 1.3]) {
    for (const zz of [-0.72, 0.72]) {
      b.yellow.push(rbox(0.55, 0.42, 0.32, xx, 0.94, zz, 0.03));
      b.yellow.push(box(0.12, 0.55, 0.32, xx - 0.22, 1.12, zz));
      b.yellow.push(box(0.12, 0.55, 0.32, xx + 0.22, 1.12, zz));
      b.steel.push(rod(0.27, 0.12, xx, 1.25, zz, 'x', 16));
    }
  }
  // Lengan teleskopik navy keluar dari badan, balok ujung, kaki flipper.
  for (const sx of [-1, 1]) {
    for (const zz of [-0.55, 0.55]) b.navy.push(box(half - 1.6, 0.3, 0.3, sx * (1.75 + (half - 1.75) / 2), 0.5, zz));
    b.navy.push(rbox(0.38, 0.38, w, sx * (half - 0.19), 0.5, 0, 0.03));
    for (const zz of [-1, 1]) {
      const x = sx * (half - 0.12);
      const z = zz * (w / 2 - 0.13);
      b.navy.push(box(0.22, 1.05, 0.26, x + sx * 0.08, -0.15, z));
      b.navy.push(box(0.36, 0.22, 0.3, x, 0.6, z));
      b.dark.push(rod(0.07, 0.15, x - sx * 0.05, -0.02, z, 'y', 8));
    }
  }
  return b;
}

/** 8 tali hoist posisi diam: dua per puli, nyaris tegak. */
function buildRopes(): THREE.BufferGeometry[] {
  const D = RTG_DETAIL;
  const out: THREE.BufferGeometry[] = [];
  for (const xx of [-1.3, 1.3]) {
    for (const zz of [-0.72, 0.72]) {
      for (const o of [-0.12, 0.12]) {
        out.push(tube([xx + o, D.ropeTop, zz], [xx + o, D.restUnder + 1.3, zz], 0.022, 5));
      }
    }
  }
  return out;
}

// --- material -------------------------------------------------------------------

let mats: Record<Key | 'rope', THREE.Material> | null = null;
function materials() {
  if (mats) return mats;
  mats = {
    yellow: new THREE.MeshPhongMaterial({ color: '#F2CC1C', shininess: 32, specular: new THREE.Color('#6a5a18') }),
    white: new THREE.MeshPhongMaterial({ color: '#DEE1E3', shininess: 30, specular: new THREE.Color('#7d8287') }),
    grate: new THREE.MeshPhongMaterial({ map: grateTexture(), shininess: 40 }),
    steel: new THREE.MeshPhongMaterial({ color: '#9EA4AA', shininess: 45, specular: new THREE.Color('#8a9096') }),
    dark: new THREE.MeshPhongMaterial({ color: '#2E3236', shininess: 20 }),
    tire: new THREE.MeshPhongMaterial({ color: '#1B1C1D', shininess: 6 }),
    glass: new THREE.MeshPhongMaterial({ color: '#2A3740', shininess: 90, specular: new THREE.Color('#a8bccb') }),
    hazard: new THREE.MeshPhongMaterial({ map: hazardTexture(), shininess: 18 }),
    navy: new THREE.MeshPhongMaterial({ color: '#25395B', shininess: 30, specular: new THREE.Color('#3a4c6a') }),
    // Muka lampu sorot: kaca abu saat mati, berpendar saat malam.
    lamp: new THREE.MeshPhongMaterial({ color: '#B9BEC2', shininess: 60, emissive: new THREE.Color('#000000') }),
    // Berkas & genangan: aditif, tanpa tulis kedalaman, tidak di-tone-map.
    beam: new THREE.MeshBasicMaterial({
      color: '#FFE9B8',
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
    pool: new THREE.MeshBasicMaterial({
      map: poolTexture(),
      color: '#FFE2A6',
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
    red: new THREE.MeshPhongMaterial({ color: '#C3362E', shininess: 30 }),
    cable: new THREE.MeshPhongMaterial({ color: '#1C1D1F', shininess: 25 }),
    rope: new THREE.MeshPhongMaterial({ color: '#2E3134', shininess: 30 }),
  };
  applyNight(mats);
  return mats;
}

/** Gradasi radial lembut untuk genangan cahaya di tanah. */
function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let nightOn = false;
function applyNight(m: Record<Key | 'rope', THREE.Material>) {
  (m.lamp as THREE.MeshPhongMaterial).emissive.set(nightOn ? '#FFF4D6' : '#000000');
  m.beam.visible = nightOn;
  m.pool.visible = nightOn;
}

/**
 * Lampu sorot RTG detail 2 menyala (mode malam) atau mati. Materialnya
 * dipakai bersama semua unit — yang diam maupun yang bekerja — jadi satu
 * panggilan menyalakan semuanya. Pemanggil perlu meminta frame baru.
 */
export function setRtgDetail2Night(on: boolean) {
  nightOn = on;
  if (mats) applyNight(mats);
}

function toParts(name: string, b: Bucket): ModelPart[] {
  const m = materials();
  return (Object.keys(b) as Key[])
    .filter((k) => b[k].length)
    .map((k) => ({ name: `rtgd2-${name}-${k}`, geometry: merge(b[k]), material: m[k] }) as ModelPart);
}

const frameCache = new Map<string, ModelPart[]>();
let moving: Omit<RtgDetailModel, 'frame'> | null = null;

/** Model RTG detail 2 untuk rel di ±railZ (rangka di-cache per lebar). */
export function rtgDetail2Model(railZ: number): RtgDetailModel {
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
      ropes: [{ name: 'rtgd2-ropes', geometry: merge(buildRopes()), material: materials().rope } as ModelPart],
    };
  }
  return { frame, ...moving };
}

export function rtgDetail2Triangles(railZ = rtgDetailRailZ(6 * PITCH.row)): number {
  const m = rtgDetail2Model(railZ);
  return [...m.frame, ...m.trolley, ...m.spreader, ...m.ropes].reduce(
    (n, p) => n + (p.geometry.getIndex()?.count ?? p.geometry.getAttribute('position').count) / 3,
    0,
  );
}
