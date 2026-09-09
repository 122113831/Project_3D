import * as THREE from 'three';
import { PITCH } from '@/lib/constants';
import type { YardBlock } from '@/lib/types';

/**
 * Registry level-of-detail per blok.
 *
 * Aset GLB kontainer 8.379 segitiga dan tank 78.630. Dipakai untuk seluruh
 * lapangan sekaligus itu ratusan juta segitiga per frame — tidak ada GPU yang
 * sanggup. Jadi blok yang jauh tetap memakai geometri prosedural (~200-320
 * segitiga) dan hanya blok di sekitar kamera yang naik ke model penuh.
 *
 * Pergantiannya cuma mengubah flag `visible` pada dua group yang SAMA-SAMA
 * sudah punya matriks instance-nya. Tidak ada geometri yang dibuat ulang dan
 * tidak ada buffer yang di-upload ulang saat kamera bergerak.
 */
export type LodEntry = {
  /** Kode blok. Anggaran dihitung per blok, bukan per group. */
  key: string;
  near: THREE.Object3D;
  far: THREE.Object3D;
  bounds: THREE.Box3;
};

const registry = new Set<LodEntry>();

/** Jarak kamera ke kotak blok (meter) di mana model penuh mulai dipertimbangkan. */
export const LOD_DISTANCE = 240;

/**
 * Batas keras jumlah blok bermodel penuh.
 *
 * Ambang jarak saja tidak cukup. Blok panjangnya 256 m dan barisnya cuma
 * berjarak 43 m, jadi kamera setinggi 30 m di tengah lapangan punya HAMPIR
 * SELURUH 30 blok dalam radius 240 m — tepat skenario ratusan juta segitiga
 * yang mau dihindari. Anggaran inilah yang benar-benar mengunci biayanya.
 *
 * Angkanya harus disetel ulang tiap kali aset GP diganti — ini pernah
 * dilupakan dan hasilnya seluruh lapangan nyaris menyala berbarengan. Blok
 * terpadat pada preset Normal berisi 460 kontainer; dengan aset GP 8.379
 * segitiga satu blok penuh ~6 juta segitiga, jadi empat blok ~24 juta. (Aset
 * GP 32.456 segitiga yang sempat dipakai memaksa angka ini turun ke dua.)
 */
export const LOD_MAX_BLOCKS = 4;

/**
 * Blok yang sudah detail baru diturunkan kalau peringkatnya jatuh sejauh ini
 * di bawah anggaran. Tanpa histeresis, blok yang jaraknya nyaris sama akan
 * bertukar peringkat tiap frame saat kamera diorbit dan geometrinya berkedip.
 *
 * Ditahan di 1: tiap peringkat tambahan berarti satu blok ~6 juta segitiga
 * lagi yang boleh ikut menyala, jadi kasus terburuknya lima blok ~30 juta.
 */
const HYSTERESIS = 1;

export function blockBounds(block: YardBlock): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(block.originX, 0, block.originZ),
    new THREE.Vector3(
      block.originX + block.slots * PITCH.teu,
      block.tiers * PITCH.tier,
      block.originZ + block.rows * PITCH.row,
    ),
  );
}

export function registerLod(entry: LodEntry) {
  registry.add(entry);
  return () => {
    registry.delete(entry);
  };
}

const distances = new Map<string, number>();
const ranked: string[] = [];

/**
 * @returns true kalau ada blok yang berganti level — pemanggil perlu meminta
 * frame baru karena frameloop="demand".
 */
export function updateLod(camera: THREE.Camera): boolean {
  distances.clear();
  for (const entry of registry) {
    const d = entry.bounds.distanceToPoint(camera.position);
    const current = distances.get(entry.key);
    if (current === undefined || d < current) distances.set(entry.key, d);
  }

  ranked.length = 0;
  for (const [key, d] of distances) if (d < LOD_DISTANCE) ranked.push(key);
  ranked.sort((a, b) => distances.get(a)! - distances.get(b)!);

  let changed = false;
  for (const entry of registry) {
    const rank = ranked.indexOf(entry.key);
    const budget = entry.near.visible ? LOD_MAX_BLOCKS + HYSTERESIS : LOD_MAX_BLOCKS;
    const near = rank >= 0 && rank < budget;
    if (entry.near.visible === near) continue;
    entry.near.visible = near;
    entry.far.visible = !near;
    changed = true;
  }
  return changed;
}
