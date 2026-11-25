/**
 * Spesifikasi gudang (bangunan di lapangan) — MURNI, tanpa three.js, supaya
 * dipakai bersama oleh model 3D, kotak pilih editor, validasi, dan uji.
 *
 * Disimpan per gudang di tata letak (LayoutEquipment.building), jadi tiap
 * gudang boleh beda ukuran, atap, dan warna tanpa tabel database baru.
 */

export type WarehouseRoof = 'gable' | 'flat' | 'saw';

export type WarehouseSpec = {
  /** Panjang (sumbu X lokal), lebar (Z), tinggi dinding — meter. */
  w: number;
  d: number;
  h: number;
  roof: WarehouseRoof;
  wall: string;
  roofColor: string;
  /** Pintu gulung + platform dock di sisi +Z. */
  docks: boolean;
  /** Kanopi di atas dock (hanya bila docks). */
  canopy: boolean;
  /** Kantor kecil menempel di ujung -X. */
  office: boolean;
  label: string;
};

export const WAREHOUSE_DEFAULT: WarehouseSpec = {
  w: 60,
  d: 30,
  h: 9,
  roof: 'gable',
  wall: '#d9dedf',
  roofColor: '#3f6f9e',
  docks: true,
  canopy: true,
  office: true,
  label: 'WAREHOUSE',
};

/** Batas ukuran yang masuk akal (juga dipakai panel editor). */
export const WAREHOUSE_LIMITS = { w: [12, 160], d: [10, 80], h: [4, 18] } as const;

/** Pasangan warna dinding/atap yang tersedia di panel. */
export const WAREHOUSE_PAINTS: { name: string; wall: string; roof: string }[] = [
  { name: 'Gray & blue', wall: '#d9dedf', roof: '#3f6f9e' },
  { name: 'Cream & red', wall: '#e8e2d2', roof: '#9a3b2c' },
  { name: 'Blue & zinc', wall: '#2f5d8a', roof: '#cfd5d8' },
  { name: 'Gray & green', wall: '#cfd6cf', roof: '#2f6b46' },
];

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** Spesifikasi lengkap dari isian parsial (default + batas). */
export function warehouseSpec(p?: Partial<WarehouseSpec> | null): WarehouseSpec {
  const s = { ...WAREHOUSE_DEFAULT, ...(p ?? {}) };
  return {
    ...s,
    w: clamp(Number(s.w) || WAREHOUSE_DEFAULT.w, WAREHOUSE_LIMITS.w),
    d: clamp(Number(s.d) || WAREHOUSE_DEFAULT.d, WAREHOUSE_LIMITS.d),
    h: clamp(Number(s.h) || WAREHOUSE_DEFAULT.h, WAREHOUSE_LIMITS.h),
    canopy: s.docks && s.canopy,
  };
}

/** Kedalaman dock (+Z) dan panjang kantor (-X), meter. */
export const DOCK_DEPTH = 3.2;
export const CANOPY_DEPTH = 5.6;
export const OFFICE_DEPTH = 8;

/** Tinggi bubungan/parapet di atas dinding. */
export const roofRise = (s: WarehouseSpec) => (s.roof === 'gable' ? s.d * 0.14 : s.roof === 'saw' ? 3 : 1.2);

/**
 * Batas tapak dalam koordinat BANGUNAN (titik nol = tengah badan gudang),
 * termasuk dock, kanopi, kantor, dan pelat dasar. Model digeser sehingga
 * tengah batas ini jatuh di titik penempatan.
 */
export function warehouseBounds(s: WarehouseSpec) {
  const minX = -s.w / 2 - 1 - (s.office ? OFFICE_DEPTH : 0);
  const maxX = s.w / 2 + 1;
  const minZ = -s.d / 2 - 1;
  const maxZ = s.d / 2 + Math.max(1, s.docks ? (s.canopy ? CANOPY_DEPTH : DOCK_DEPTH) + 0.2 : 1);
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, height: s.h + roofRise(s) + 1 };
}

/** Ukuran tapak & tinggi (untuk kotak pilih editor dan validasi). */
export function warehouseFootprint(p?: Partial<WarehouseSpec> | null) {
  const b = warehouseBounds(warehouseSpec(p));
  return { x: b.maxX - b.minX, z: b.maxZ - b.minZ, y: b.height };
}

/** Jumlah pintu gulung untuk panjang dinding tertentu (jarak 9 m). */
export const dockCount = (s: WarehouseSpec) => (s.docks ? Math.max(1, Math.floor((s.w - 12) / 9)) : 0);
