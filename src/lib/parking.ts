import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelPart } from './containerModel';
import {
  PARKING_MARGIN,
  PARKING_VEHICLE,
  parkingSize,
  parkingSlots,
  parkingSpec,
  type ParkingSpec,
} from './parkingSpec';

/**
 * Area parkir alat prosedural: pelat aspal dengan garis lajur putih, tepi
 * kuning, nomor lajur dicat, ganjal roda beton di ujung belakang tiap lajur,
 * dan papan nama bertiang. Lajurnya KOSONG: RS, truk, dan alat lain ditaruh
 * sendiri dari tab Alat lalu diletakkan di lajur.
 *
 * Titik nol = tengah pelat, di tanah.
 */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Cat aspal: satu tekstur untuk seluruh pelat (garis, tepi, nomor, label). */
function padTexture(s: ParkingSpec) {
  const v = PARKING_VEHICLE[s.vehicle];
  const { x: sx, z: sz } = parkingSize(s);
  // ±20 px per meter, dibatasi 2048 di sisi terpanjang.
  const ppm = Math.min(20, 2048 / Math.max(sx, sz));
  const W = Math.round(sx * ppm);
  const H = Math.round(sz * ppm);
  // Kanvas: sumbu u = X lokal, sumbu v (ke bawah) = Z lokal.
  const px = (x: number) => (x + sx / 2) * ppm;
  const pz = (z: number) => (z + sz / 2) * ppm;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#3b3f44';
    g.fillRect(0, 0, W, H);
    // Butiran aspal halus.
    for (let i = 0; i < (W * H) / 60; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.06)';
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    // Tepi kuning.
    g.strokeStyle = '#e8b52a';
    g.lineWidth = 0.3 * ppm;
    g.strokeRect(0.5 * ppm, 0.5 * ppm, W - ppm, H - ppm);

    g.strokeStyle = '#eef0f2';
    g.lineWidth = 0.15 * ppm;
    const z0 = -sz / 2 + PARKING_MARGIN;
    for (let r = 0; r < s.rows; r++) {
      const xa = s.rows === 1 ? -v.bayL / 2 : r === 0 ? 0 : -v.bayL;
      const xb = xa + v.bayL;
      // Garis pemisah lajur.
      for (let b = 0; b <= s.bays; b++) {
        const z = z0 + b * v.bayW;
        g.beginPath();
        g.moveTo(px(xa), pz(z));
        g.lineTo(px(xb), pz(z));
        g.stroke();
      }
      // Garis belakang lajur (sisi ganjal roda).
      const back = r === 0 ? xa : xb;
      g.beginPath();
      g.moveTo(px(back), pz(z0));
      g.lineTo(px(back), pz(z0 + s.bays * v.bayW));
      g.stroke();
    }
    // Nomor lajur di ujung depan, menghadap pengemudi yang masuk.
    g.fillStyle = '#eef0f2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(Math.min(v.bayW * 0.5, 2.6) * ppm)}px 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif`;
    for (const slot of parkingSlots(s)) {
      const front = slot.x + Math.cos(slot.ry) * (v.bayL / 2 - 1.8);
      g.save();
      g.translate(px(front), pz(slot.z));
      g.rotate(slot.ry === 0 ? Math.PI / 2 : -Math.PI / 2);
      g.fillText(String(slot.no), 0, 0);
      g.restore();
    }
  });
}

let shared: { concrete: THREE.MeshPhongMaterial; pole: THREE.MeshPhongMaterial } | null = null;
const sharedMats = () =>
  (shared ??= {
    concrete: new THREE.MeshPhongMaterial({ color: '#c9c6bd', shininess: 6 }),
    pole: new THREE.MeshPhongMaterial({ color: '#7d858e', shininess: 30 }),
  });

const signCache = new Map<string, THREE.Material>();
function signMaterial(label: string) {
  let m = signCache.get(label);
  if (!m) {
    const t = canvasTex(512, 192, (g) => {
      g.fillStyle = '#1d4f91';
      g.fillRect(0, 0, 512, 192);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 8;
      g.strokeRect(10, 10, 492, 172);
      g.fillStyle = '#ffffff';
      g.font = "700 130px 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('P', 70, 100);
      g.font = "700 64px 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
      g.textAlign = 'left';
      g.fillText(label.toUpperCase(), 140, 100, 350);
    });
    m = new THREE.MeshPhongMaterial({ map: t, shininess: 20 });
    signCache.set(label, m);
  }
  return m;
}

const specKey = (s: ParkingSpec) => [s.bays, s.rows, s.vehicle, s.label].join('|');
const modelCache = new Map<string, ModelPart[]>();

/** Bagian model pelat parkir (di-cache per ukuran & label; jumlah alat tidak memengaruhi). */
export function parkingModel(p?: Partial<ParkingSpec> | null): ParkingModelPart[] {
  const s = parkingSpec(p);
  const key = specKey(s);
  const hit = modelCache.get(key);
  if (hit) return hit;
  const v = PARKING_VEHICLE[s.vehicle];
  const { x: sx, z: sz } = parkingSize(s);
  const m = sharedMats();

  const pad = new THREE.PlaneGeometry(sx, sz);
  pad.rotateX(-Math.PI / 2);
  pad.translate(0, 0.03, 0);
  const padMat = new THREE.MeshPhongMaterial({ map: padTexture(s), shininess: 4, polygonOffset: true, polygonOffsetFactor: -2 });

  // Ganjal roda: balok beton di belakang tiap lajur.
  const stops: THREE.BufferGeometry[] = [];
  for (const slot of parkingSlots(s)) {
    const g = new THREE.BoxGeometry(0.3, 0.15, Math.min(2.2, v.bayW - 1.4));
    g.translate(slot.x - Math.cos(slot.ry) * (v.bayL / 2 - 0.6), 0.1, slot.z);
    stops.push(g);
  }

  // Papan nama bertiang di ujung −Z, menghadap −Z (dari jalan).
  const signW = 5.2;
  const signH = (signW * 192) / 512;
  const poles: THREE.BufferGeometry[] = [-1, 1].map((k) => {
    const g = new THREE.CylinderGeometry(0.08, 0.08, 4.2, 8);
    g.translate(k * (signW / 2 - 0.3), 2.1, -sz / 2 - 0.4);
    return g;
  });
  // Dua muka berpunggungan, supaya tulisan terbaca (tidak terbalik) dari kedua sisi.
  const front = new THREE.PlaneGeometry(signW, signH);
  front.rotateY(Math.PI);
  front.translate(0, 4.2 - signH / 2, -sz / 2 - 0.47);
  const back = new THREE.PlaneGeometry(signW, signH);
  back.translate(0, 4.2 - signH / 2, -sz / 2 - 0.45);
  const sign = mergeGeometries([front, back], false)!;
  const board = new THREE.BoxGeometry(signW + 0.1, signH + 0.1, 0.015);
  board.translate(0, 4.2 - signH / 2, -sz / 2 - 0.46);
  poles.push(board);

  const parts: ModelPart[] = [
    { name: `pk-${key}-pad`, geometry: pad, material: padMat, shadow: false } as ParkingModelPart,
    { name: `pk-${key}-stops`, geometry: mergeGeometries(stops, false)!, material: m.concrete } as ParkingModelPart,
    { name: `pk-${key}-poles`, geometry: mergeGeometries(poles, false)!, material: m.pole } as ParkingModelPart,
    { name: `pk-${key}-sign`, geometry: sign, material: signMaterial(s.label) } as ParkingModelPart,
  ];
  modelCache.set(key, parts);
  return parts as ParkingModelPart[];
}

export type ParkingModelPart = ModelPart & { shadow?: boolean };
