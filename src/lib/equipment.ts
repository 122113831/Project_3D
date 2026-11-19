import { APRON, LANE, PITCH, RTG, RTG_CLEARANCE, rtgAssetScale, rtgSpanScale } from './constants';
import type { LayoutEquipment } from './layout';
import { laneSide } from './yard';
import { mulberry32 } from './random';
import type { YardBlock } from './types';

/**
 * Penempatan alat berat.
 *
 * Dipakai DUA kali dan itu yang menentukan bentuknya: sekali oleh renderer
 * saat belum ada tata letak suntingan, dan sekali lagi oleh editor untuk
 * mengisi tata letak awal. Karena itu keluarannya daftar `LayoutEquipment`
 * datar yang bisa disunting, bukan langsung matriks instance.
 */

/** Semua jenis RTG (alat yang mengangkangi blok). */
export const RTG_KINDS: ReadonlySet<string> = new Set(['rtg', 'rtgAsset', 'rtgDetail', 'rtgDetail2']);

type BlockLike = { originX: number; originZ: number; slots: number; rows: number; rot?: number; truckLane?: 'L' | 'R' };

/**
 * Sumbu portal RTG untuk sebuah blok: digeser RTG.offsetZ ke SISI LAJUR TRUK
 * (konfigurasi "6+1"). Semua jenis RTG berrel di ±(lebar/2 + RTG_CLEARANCE)
 * dari sumbunya, jadi dengan geseran ini rel dekat jatuh di luar lajur
 * layanan dan truk yang berhenti berada DI DALAM kaki RTG.
 */
export function rtgLaneZ(b: BlockLike): number {
  return b.originZ + (b.rows * PITCH.row) / 2 + laneSide(b) * RTG.offsetZ;
}

/**
 * Apakah RTG bersumbu di `z` menaungi lajur layanan blok ini tanpa rel jauhnya
 * menabrak tumpukan. Geseran sumbu ke sisi lajur (meter) harus di antara:
 * - minimal: rel dekat di luar tepi lajur layanan (+0,3 m ruang roda),
 * - maksimal: rel jauh masih di luar tepi blok seberang (−0,3 m).
 */
export function rtgCoversLane(b: BlockLike, z: number): boolean {
  const off = (z - (b.originZ + (b.rows * PITCH.row) / 2)) * laneSide(b);
  return off >= LANE.service.to + 0.3 - RTG_CLEARANCE && off <= RTG_CLEARANCE - 0.3;
}

/**
 * Jepret sumbu RTG ke sisi lajur blok yang sedang ditunjuk (blok tanpa
 * rotasi, kursor di sekitar badannya). Di luar itu z dibiarkan.
 */
export function snapRtgToLane(blocks: readonly BlockLike[], x: number, z: number): number {
  for (const b of blocks) {
    if (Math.abs(b.rot ?? 0) > 1e-3) continue;
    const length = b.slots * PITCH.teu;
    const width = b.rows * PITCH.row;
    const cz = b.originZ + width / 2;
    if (x >= b.originX - 8 && x <= b.originX + length + 8 && Math.abs(z - cz) <= width / 2 + 9) return rtgLaneZ(b);
  }
  return z;
}

/** Lajur tempat truk boleh berdiri, diukur dari tepi blok. */
const TRUCK_LANES = [
  { z: (LANE.service.from + LANE.service.to) / 2, ry: 0 },
  { z: (LANE.road.from + LANE.road.to) / 2 - 3.5, ry: 0 },
  { z: (LANE.road.from + LANE.road.to) / 2 + 3.5, ry: Math.PI },
] as const;

export function generateEquipment(
  blocks: readonly YardBlock[],
  extentX: number,
  extentZ: number,
): LayoutEquipment[] {
  const rng = mulberry32(7717);
  const out: LayoutEquipment[] = [];

  for (const b of blocks) {
    const width = b.rows * PITCH.row;
    const length = b.slots * PITCH.teu;

    // Satu RTG per blok, di bay acak.
    const bay = Math.floor(rng() * Math.max(1, b.slots - 4)) + 2;
    // Id DETERMINISTIK, bukan acak: daftar ini dibangkitkan ulang di beberapa
    // komponen secara terpisah, dan RTG yang sedang bekerja dikenali lewat
    // id-nya. Dengan id acak, Equipment dan RtgWorks memegang id yang berbeda
    // untuk alat yang sama, dan alat itu tergambar dua kali.
    out.push({
      id: `rtg-${b.id}`,
      kind: 'rtg',
      x: b.originX + Math.min(bay, b.slots - 1) * PITCH.teu,
      z: rtgLaneZ(b),
      ry: 0,
    });

    // Beberapa truk di lajur yang dicat, menghadap arah panahnya.
    const n = Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const lane = TRUCK_LANES[Math.floor(rng() * TRUCK_LANES.length)];
      out.push({
        id: `trk-${b.id}-${i}`,
        kind: 'truck',
        // Rig traktor + chassis ~15,4 m: 11 m di belakang titik penempatan dan
        // 4,5 m di depannya. Marginnya menjaga rig tidak menjulur keluar blok.
        x: b.originX + 12 + rng() * Math.max(1, length - 24),
        z: b.originZ + width + lane.z,
        ry: lane.ry,
        loaded: rng() < 0.55,
      });
    }
  }

  // Tiang lampu mengelilingi lapangan yang sebenarnya.
  const halfX = extentX / 2 + APRON * 0.55;
  const halfZ = extentZ / 2 + APRON * 0.55;
  const cols = Math.max(2, Math.round(extentX / 120));
  for (let i = 0; i <= cols; i++) {
    const x = -extentX / 2 + (i * extentX) / cols;
    out.push({ id: `lmp-n-${i}`, kind: 'lamp', x, z: -halfZ, ry: 0 });
    out.push({ id: `lmp-s-${i}`, kind: 'lamp', x, z: halfZ, ry: Math.PI });
  }
  const rows = Math.max(1, Math.round(extentZ / 140));
  for (let i = 0; i <= rows; i++) {
    const z = -extentZ / 2 + (i * extentZ) / rows;
    out.push({ id: `lmp-w-${i}`, kind: 'lamp', x: -halfX, z, ry: Math.PI / 2 });
    out.push({ id: `lmp-e-${i}`, kind: 'lamp', x: halfX, z, ry: -Math.PI / 2 });
  }

  return out;
}

/**
 * Faktor skala Z portal RTG, diambil dari blok terdekat pada sumbu Z.
 *
 * RTG harus menaungi bloknya, dan lebar blok berbeda-beda. Diturunkan dari
 * posisi alih-alih disimpan di datanya sendiri supaya RTG yang digeser user
 * ke blok lain langsung menyesuaikan bentang, tanpa perlu ada yang menyuntingnya.
 */
export function rtgScaleAt(blocks: readonly YardBlock[], z: number): number {
  const width = nearestBlockWidth(blocks, z);
  return width === null ? 1 : rtgSpanScale(width);
}

/**
 * Skala SERAGAM aset RTG, dari blok terdekat yang sama.
 *
 * Terpisah dari rtgScaleAt karena titik acuannya berbeda: portal prosedural
 * relnya di 12,5 m dari sumbu, aset ini di 7,6 m. Memakai angka yang sama untuk
 * keduanya membuat salah satunya pasti meleset — dan yang meleset selama ini
 * adalah asetnya, yang berdiri di dalam blok alih-alih menaunginya.
 */
export function rtgAssetScaleAt(blocks: readonly YardBlock[], z: number): number {
  const width = nearestBlockWidth(blocks, z);
  return width === null ? 1 : rtgAssetScale(width);
}

/** Lebar blok terdekat pada sumbu Z, atau null kalau lapangannya kosong. */
function nearestBlockWidth(blocks: readonly YardBlock[], z: number): number | null {
  let best: YardBlock | null = null;
  let bestDist = Infinity;
  for (const b of blocks) {
    const centre = b.originZ + (b.rows * PITCH.row) / 2;
    const d = Math.abs(centre - z);
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best ? best.rows * PITCH.row : null;
}
