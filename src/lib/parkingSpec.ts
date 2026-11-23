/**
 * Spesifikasi area parkir alat — MURNI, tanpa three.js, supaya dipakai bersama
 * oleh model 3D, kotak pilih editor, validasi, dan uji.
 *
 * Area parkir hanya PELAT LAJUR (aspal, garis, nomor, ganjal roda, papan
 * nama). Alatnya TIDAK ikut: RS, truk, dan alat lain ditaruh sendiri dari
 * tab Alat dengan kodenya masing-masing, lalu diletakkan di lajur mana pun.
 *
 * Disimpan per area di tata letak (LayoutEquipment.parking). Koordinat lokal:
 * lajur berderet di sumbu Z, panjang lajur di sumbu X. Dua baris = dua deret
 * lajur yang punggungnya bertemu.
 */

export type ParkingVehicle = 'reachStacker' | 'truck';

export type ParkingSpec = {
  /** Lajur per baris. */
  bays: number;
  /** 1 atau 2 baris lajur. */
  rows: 1 | 2;
  /** Jenis alat yang dilayani — menentukan ukuran lajur. */
  vehicle: ParkingVehicle;
  label: string;
};

/** Ukuran satu lajur: lebar pada Z, panjang pada X. */
export const PARKING_VEHICLE: Record<ParkingVehicle, { name: string; bayW: number; bayL: number }> = {
  // RS: tapak 15 × 6,4 m termasuk spreader melintang 6,1 m.
  reachStacker: { name: 'Reach stacker', bayW: 7.5, bayL: 17 },
  // Truk + chassis: 15,4 × 2,6 m.
  truck: { name: 'Truk + chassis', bayW: 4, bayL: 18 },
};

export const PARKING_LIMITS = { bays: [1, 30] } as const;

export const PARKING_DEFAULT: ParkingSpec = {
  bays: 4,
  rows: 1,
  vehicle: 'reachStacker',
  label: 'PARKIR RS',
};

/** Jarak tepi pelat ke garis lajur terluar. */
export const PARKING_MARGIN = 1.5;

/** Spesifikasi lengkap dari isian parsial (default + batas). Isian lama
 *  (jumlah alat parkir, awalan kode) diabaikan. */
export function parkingSpec(p?: Partial<ParkingSpec> | null): ParkingSpec {
  const s = { ...PARKING_DEFAULT, ...(p ?? {}) };
  const vehicle: ParkingVehicle = s.vehicle === 'truck' ? 'truck' : 'reachStacker';
  const bays = Math.round(
    Math.min(PARKING_LIMITS.bays[1], Math.max(PARKING_LIMITS.bays[0], Number(s.bays) || PARKING_DEFAULT.bays)),
  );
  const rows: 1 | 2 = Number(s.rows) === 2 ? 2 : 1;
  return { bays, rows, vehicle, label: String(s.label ?? '') };
}

/** Ukuran pelat parkir (tanpa papan nama): panjang X, lebar Z. */
export function parkingSize(s: ParkingSpec) {
  const v = PARKING_VEHICLE[s.vehicle];
  return { x: s.rows * v.bayL + 2 * PARKING_MARGIN, z: s.bays * v.bayW + 2 * PARKING_MARGIN };
}

/** Ukuran tapak & tinggi (kotak pilih editor dan validasi); tinggi = papan nama. */
export function parkingFootprint(p?: Partial<ParkingSpec> | null) {
  const { x, z } = parkingSize(parkingSpec(p));
  return { x, z, y: 4.5 };
}

export type ParkingSlot = {
  /** Nomor lajur (1-based) seperti dicat di aspal. */
  no: number;
  /** Tengah lajur, koordinat lokal area. */
  x: number;
  z: number;
  /** Arah keluar lajur: 0 = +X, π = −X. */
  ry: number;
};

/** Semua lajur: baris pertama dari ujung −Z, lalu baris kedua. */
export function parkingSlots(p?: Partial<ParkingSpec> | null): ParkingSlot[] {
  const s = parkingSpec(p);
  const v = PARKING_VEHICLE[s.vehicle];
  const { z: sizeZ } = parkingSize(s);
  const out: ParkingSlot[] = [];
  for (let r = 0; r < s.rows; r++) {
    // Satu baris: lajur di tengah pelat. Dua baris: baris 1 di +X (keluar ke
    // +X), baris 2 di −X (keluar ke −X).
    const x = s.rows === 1 ? 0 : r === 0 ? v.bayL / 2 : -v.bayL / 2;
    const ry = r === 0 ? 0 : Math.PI;
    for (let b = 0; b < s.bays; b++) {
      out.push({ no: r * s.bays + b + 1, x, z: -sizeZ / 2 + PARKING_MARGIN + (b + 0.5) * v.bayW, ry });
    }
  }
  return out;
}
