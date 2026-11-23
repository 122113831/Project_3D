import {
  BLOCK_LENGTH,
  BLOCK_WIDTH,
  BOX,
  PITCH,
  YARD,
  YARD_EXTENT_X,
  YARD_EXTENT_Z,
} from './constants';
import { blockedCount } from './slots';
import type {
  BlockSide,
  ContainerSize,
  YardBlock,
  YardContainer,
} from './types';

const COL_LETTERS = 'ABCDEFGH';

export const blockId = (col: number, row: number) =>
  `${COL_LETTERS[col]}${String(row + 1).padStart(2, '0')}`;

/** Sudut blok (slot 0, row 0) dalam koordinat dunia. Lapangan berpusat di origin. */
export function blockOrigin(col: number, row: number) {
  return {
    x: -YARD_EXTENT_X / 2 + col * (BLOCK_LENGTH + YARD.gapX),
    z: -YARD_EXTENT_Z / 2 + row * (BLOCK_WIDTH + YARD.gapZ),
  };
}

/**
 * Jarak dari tepi -X blok ke PUSAT kontainer di sebuah bay.
 *
 * 20ft duduk di tengah satu posisi; 40ft membentang di posisi bay dan bay+1,
 * jadi pusatnya di batas antara keduanya.
 *
 * SLOT_START menentukan dari ujung MANA nomor slot dihitung. Dengan 'R', slot 1
 * ada di ujung +X, jadi indeks bay dicerminkan. Pencerminan ini harus dipakai
 * bersama penomoran label di BlockLabels — kalau tidak, kontainer bernomor slot
 * 1 akan berdiri di atas petak yang bertuliskan angka lain.
 */
export function bayOffsetX(
  block: Pick<YardBlock, 'slots'> & { slotStart?: BlockSide },
  bay: number,
  size: ContainerSize,
): number {
  const span = size === 40 ? 2 : 1;
  const pos = block.slotStart === 'R' ? block.slots - bay - span : bay;
  return (pos + span / 2) * PITCH.teu;
}

/** Nomor slot yang tercetak pada posisi fisik ke-`pos`, mengikuti SLOT_START. */
export function slotNumberAt(
  block: Pick<YardBlock, 'slots' | 'slotStep'> & { slotStart?: BlockSide },
  pos: number,
): number {
  const index = block.slotStart === 'R' ? block.slots - 1 - pos : pos;
  return index * (block.slotStep || 1) + 1;
}

/** +1 kalau lajur truk di sisi +Z blok (baku), -1 kalau di seberangnya. */
export const laneSide = (block: { truckLane?: BlockSide }) =>
  block.truckLane === 'R' ? -1 : 1;

/**
 * Rotasi mengikuti KONVENSI three.js, dan itu bukan detail selera.
 *
 * Matrix4.makeRotationY memakai x' = x·cos + z·sin, z' = -x·sin + z·cos.
 * Rumus tanda kebalikannya — x' = x·cos - z·sin, z' = x·sin + z·cos — adalah
 * rotasi ke arah yang BERLAWANAN. Sempat terpakai di sini, dan akibatnya persis
 * bisa dilihat di layar: slab, quad label, dan orientasi instance diputar oleh
 * three (+θ), sementara POSISI kontainer dan label dihitung di sini (-θ). Blok
 * berputar ke kanan, angkanya berputar ke kiri.
 *
 * Semua yang menghitung titik terhadap sudut blok harus memakai rumus yang sama
 * dengan three, termasuk uji klik editor yang membaliknya.
 */

/**
 * Posisi dunia satu kontainer. Ini satu-satunya tempat rumus tata letak
 * ditulis — komponen 3D, marker seleksi, dan kamera semua memakainya.
 */
export function containerPosition(
  block: Pick<YardBlock, 'originX' | 'originZ' | 'slots' | 'rows'> & { rot?: number },
  c: Pick<YardContainer, 'size' | 'bay' | 'row' | 'tier'>,
): [number, number, number] {
  const offsetX = bayOffsetX(block, c.bay, c.size);
  const offsetZ = (c.row + 0.5) * PITCH.row;
  const y = (c.tier - 1) * PITCH.tier + BOX.height / 2;

  const rot = block.rot ?? 0;
  if (rot === 0) return [block.originX + offsetX, y, block.originZ + offsetZ];

  // Blok berputar terhadap PUSATNYA, bukan sudutnya. Kalau berputar terhadap
  // sudut, memutar blok akan melemparnya jauh dari tempat semula dan
  // menggeser-lalu-memutar jadi mustahil dipakai.
  const cx = (block.slots * PITCH.teu) / 2;
  const cz = (block.rows * PITCH.row) / 2;
  const dx = offsetX - cx;
  const dz = offsetZ - cz;
  const sin = Math.sin(rot);
  const cos = Math.cos(rot);
  return [
    block.originX + cx + dx * cos + dz * sin,
    y,
    block.originZ + cz - dx * sin + dz * cos,
  ];
}

/** Pusat blok di koordinat dunia — sumbu putarnya. */
export function blockCenter(
  b: Pick<YardBlock, 'originX' | 'originZ' | 'slots' | 'rows'>,
): [number, number] {
  return [b.originX + (b.slots * PITCH.teu) / 2, b.originZ + (b.rows * PITCH.row) / 2];
}

/**
 * Titik di sekitar blok, ikut berputar bersamanya. `dx`/`dz` diukur dari PUSAT
 * blok. Dipakai lorong RTG, label, dan apa pun yang menempel pada blok.
 */
/**
 * Isi dan sisa kapasitas satu blok, dalam posisi 20ft (TEU).
 *
 * Kapasitas = slot × row × tier — cara yang sama dengan meta.capacityTeu,
 * jadi persen per blok dan persen lapangan di TopBar tidak bisa berselisih.
 * Kontainer 40ft memakan dua posisi. "Sisa" dihitung dalam box 20ft: sebuah
 * 40ft butuh dua di antaranya.
 */
export function blockOccupancy(b: Pick<YardBlock, 'slots' | 'rows' | 'tiers' | 'containers' | 'blocked'>) {
  // Slot terkunci dikeluarkan dari kapasitas — sama seperti meta.capacityTeu.
  const blocked = blockedCount(b.blocked, b);
  const capacity = b.slots * b.rows * b.tiers - blocked;
  const used = b.containers.reduce((n, c) => n + (c.size === 40 ? 2 : 1), 0);
  return {
    capacity,
    blocked,
    used,
    boxes: b.containers.length,
    free: Math.max(0, capacity - used),
    pct: capacity > 0 ? Math.min(100, (used / capacity) * 100) : 0,
  };
}

export function aroundBlock(
  b: Pick<YardBlock, 'originX' | 'originZ' | 'slots' | 'rows'> & { rot?: number },
  dx: number,
  dz: number,
): [number, number] {
  const [cx, cz] = blockCenter(b);
  const rot = b.rot ?? 0;
  if (rot === 0) return [cx + dx, cz + dz];
  const sin = Math.sin(rot);
  const cos = Math.cos(rot);
  return [cx + dx * cos + dz * sin, cz - dx * sin + dz * cos];
}
