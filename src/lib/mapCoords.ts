import { PITCH } from './constants';

/**
 * Bolak-balik antara METER di layar dan SATUAN PETA di kolom X/Y.
 *
 * Kolom X dan Y di CORE_YARD_BLOCK bukan meter — nilainya (124,127), (121,283),
 * (127,567) terlalu renggang untuk itu. Yang bisa dipercaya cuma susunan
 * relatifnya, jadi ada satu skala yang menerjemahkan keduanya.
 *
 * Skala itu HARUS tetap. Selama lapangan hanya dibaca, menurunkannya dari jarak
 * antar blok sudah cukup. Begitu blok bisa digeser lalu disimpan, skala turunan
 * jadi jebakan: menggeser satu blok mengubah skalanya, seluruh lapangan ikut
 * memuai, dan simpan-lalu-muat tidak pernah kembali ke tempat yang sama.
 * Karena itu server hanya mengirim transform ini kalau DEPOT_MAP_SCALE terisi;
 * kalau null, menyimpan posisi memang tidak boleh.
 *
 * Perhatikan bahwa X dan Y tidak memakai jangkar yang sama — X menunjuk PUSAT
 * blok pada sumbu panjangnya, Y menunjuk TEPI depan. Itu konvensi datanya yang
 * sudah ada, bukan pilihan saya; mengubahnya akan menggeser ketiga blok yang
 * sekarang tergambar benar.
 */

export type MapTransform = { scale: number };

type Placed = { originX: number; originZ: number; slots: number };

/** Meter -> satuan peta, untuk disimpan ke kolom X/Y. */
export function worldToMap(t: MapTransform, b: Placed) {
  const length = b.slots * PITCH.teu;
  return {
    mapX: (b.originX + length / 2) / t.scale,
    mapY: b.originZ / t.scale,
  };
}

/** Satuan peta -> meter. Kebalikan tepat dari worldToMap. */
export function mapToWorld(t: MapTransform, mapX: number, mapY: number, slots: number) {
  const length = slots * PITCH.teu;
  return {
    originX: mapX * t.scale - length / 2,
    originZ: mapY * t.scale,
  };
}

/** Radian di layar -> derajat di kolom ROT_DEG, dinormalkan ke 0–360. */
export const radToDeg = (rad: number) => (((rad * 180) / Math.PI) % 360 + 360) % 360;
