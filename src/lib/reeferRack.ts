import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PITCH } from './constants';

/**
 * Rak listrik reefer (reefer rack) untuk blok khusus reefer.
 *
 * Struktur baja galvanis di sisi panjang blok, di seberang lajur truk:
 *   - tiang dalam & luar tiap dua bay, dengan balok melintang di tiap tingkat;
 *   - platform kisi di tiap tingkat tier ke-2 ke atas (tempat petugas berdiri
 *     untuk mencolok kabel reefer di tumpukan tier itu);
 *   - pagar kuning (rel atas & tengah) di sisi luar dan di puncak;
 *   - kotak stopkontak oranye per bay per tingkat, menghadap tumpukan;
 *   - tangga zig-zag di satu ujung, lemari panel listrik di kakinya.
 *
 * Koordinat LOKAL blok: x sepanjang blok (pusat 0), z melintang (pusat 0,
 * +z = sisi lajur truk), y ke atas dari tanah. Pemanggil memutar/memindah
 * grupnya seperti blok (aroundBlock = rotasi y three dengan sudut blok).
 */
export type RackParts = {
  steel: THREE.BufferGeometry;
  rail: THREE.BufferGeometry;
  grating: THREE.BufferGeometry;
  socket: THREE.BufferGeometry;
};

/** Jarak rak dari tepi blok, kedalaman platform, dan tinggi pagar (m). */
export const RACK = { gap: 0.5, depth: 1.3, railH: 1.05, post: 0.16 };

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};

/** Tinggi lantai platform untuk tier t (t ≥ 2): sedikit di bawah alas tier itu. */
export const rackLevel = (tier: number) => (tier - 1) * PITCH.tier - 0.25;

/**
 * Bagian-bagian rak untuk blok `slots × rows × tiers`. `side` = sisi lajur
 * truk (+1 = +z); rak berdiri di sisi seberangnya.
 */
export function buildReeferRack(slots: number, rows: number, tiers: number, side: 1 | -1 = 1): RackParts {
  const L = slots * PITCH.teu;
  const W = rows * PITCH.row;
  const s = -side; // sisi rak
  const zIn = s * (W / 2 + RACK.gap);
  const zOut = s * (W / 2 + RACK.gap + RACK.depth);
  const zMid = (zIn + zOut) / 2;
  const top = rackLevel(Math.max(2, tiers)) + RACK.railH;
  const steel: THREE.BufferGeometry[] = [];
  const rail: THREE.BufferGeometry[] = [];
  const grating: THREE.BufferGeometry[] = [];
  const socket: THREE.BufferGeometry[] = [];

  // Tiang tiap dua bay (dan di kedua ujung), dalam & luar.
  const spans = Math.max(1, Math.round(slots / 2));
  const xs: number[] = [];
  for (let i = 0; i <= spans; i++) xs.push(-L / 2 + (L * i) / spans);
  const levels: number[] = [];
  for (let t = 2; t <= tiers; t++) levels.push(rackLevel(t));
  for (const x of xs) {
    for (const z of [zIn, zOut]) steel.push(box(RACK.post, top, RACK.post, x, top / 2, z));
    // Balok melintang di tiap tingkat + pengaku silang di kaki.
    for (const y of levels) steel.push(box(0.1, 0.14, RACK.depth, x, y - 0.07, zMid));
    steel.push(box(0.08, 0.1, RACK.depth, x, 0.6, zMid));
  }

  for (const y of levels) {
    // Balok memanjang dalam & luar, lantai kisi di antaranya.
    for (const z of [zIn, zOut]) steel.push(box(L, 0.16, 0.1, 0, y - 0.08, z));
    grating.push(box(L, 0.04, RACK.depth - 0.12, 0, y + 0.02, zMid));
    // Pagar kuning sisi luar: rel atas & tengah, plus papan kaki.
    for (const h of [RACK.railH, RACK.railH / 2]) rail.push(box(L, 0.05, 0.05, 0, y + h, zOut));
    rail.push(box(L, 0.12, 0.02, 0, y + 0.06, zOut));
    // Tiang pagar kecil tiap bay.
    for (let k = 0; k <= slots; k++) rail.push(box(0.04, RACK.railH, 0.04, -L / 2 + k * PITCH.teu, y + RACK.railH / 2, zOut));
  }
  // Pagar puncak sisi dalam juga (tidak ada tumpukan di atas tier tertinggi).
  if (levels.length) {
    const yTop = levels[levels.length - 1];
    for (const h of [RACK.railH, RACK.railH / 2]) rail.push(box(L, 0.05, 0.05, 0, yTop + h, zIn));
  }

  // Kotak stopkontak per bay per tier, di sisi dalam menghadap tumpukan:
  // tier 1 dicolok dari tanah, tier ≥ 2 dari platform di bawahnya.
  for (let b = 0; b < slots; b++) {
    const x = -L / 2 + (b + 0.5) * PITCH.teu;
    for (let t = 1; t <= tiers; t++) {
      const base = t === 1 ? 0 : rackLevel(t);
      socket.push(box(0.32, 0.42, 0.14, x, base + 1.15, zIn - s * 0.1));
    }
  }

  // Tangga zig-zag di ujung +x, di luar panjang blok, dengan bordes tiap tingkat.
  const sx = L / 2 + 1.1;
  let prev = 0;
  levels.forEach((y, i) => {
    const rise = y - prev;
    const run = Math.max(2.2, rise * 1.1);
    const flight = new THREE.BoxGeometry(Math.hypot(run, rise), 0.08, RACK.depth - 0.2);
    flight.rotateZ((i % 2 === 0 ? 1 : -1) * Math.atan2(rise, run));
    flight.translate(sx + (i % 2 === 0 ? 0 : 0), prev + rise / 2, zMid);
    grating.push(flight);
    grating.push(box(1.4, 0.05, RACK.depth, sx, y + 0.02, zMid));
    rail.push(box(1.4, 0.05, 0.05, sx, y + RACK.railH, zOut));
    prev = y;
  });
  for (const z of [zIn, zOut]) steel.push(box(RACK.post, top, RACK.post, sx + 0.75, top / 2, z));
  // Lemari panel listrik (abu, pintu oranye di sisi depan) di kaki tangga.
  steel.push(box(1.0, 1.9, 0.6, sx + 0.1, 0.95, zOut + s * 0.5));
  socket.push(box(0.8, 1.5, 0.03, sx + 0.1, 1.0, zOut + s * 0.81));

  const m = (list: THREE.BufferGeometry[]) => mergeGeometries(list, false)!;
  return { steel: m(steel), rail: m(rail), grating: m(grating), socket: m(socket) };
}

/** Material bersama rak (sekali buat, dipakai semua blok reefer). */
let mats: Record<keyof RackParts, THREE.MeshPhongMaterial> | null = null;
export function rackMaterials() {
  mats ??= {
    steel: new THREE.MeshPhongMaterial({ color: '#9aa3aa', shininess: 40, specular: new THREE.Color('#556068') }),
    rail: new THREE.MeshPhongMaterial({ color: '#e7b324', shininess: 30 }),
    grating: new THREE.MeshPhongMaterial({ color: '#4a5158', shininess: 12 }),
    socket: new THREE.MeshPhongMaterial({ color: '#e8701a', shininess: 20 }),
  };
  return mats;
}
