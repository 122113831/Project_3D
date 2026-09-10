import {
  BLOCK_LENGTH,
  BLOCK_WIDTH,
  BOX,
  LINES,
  PITCH,
  VESSELS,
  YARD,
  YARD_EXTENT_X,
  YARD_EXTENT_Z,
} from './constants';
import { containerNumber } from './iso6346';
import { mulberry32, pick, randInt, weighted, type Rng } from './random';
import type {
  BlockSide,
  ContainerSize,
  ContainerStatus,
  ContainerType,
  YardBlock,
  YardContainer,
  YardData,
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

const STATUSES: ContainerStatus[] = ['full', 'empty', 'reefer', 'dangerous', 'damaged'];
const STATUS_WEIGHTS = [62, 24, 8, 4, 2];

/** Tank tidak pernah reefer, dan jauh lebih sering membawa muatan berbahaya. */
const TANK_STATUSES: ContainerStatus[] = ['full', 'empty', 'dangerous', 'damaged'];
const TANK_STATUS_WEIGHTS = [52, 26, 20, 2];

/**
 * Porsi tumpukan 20ft yang berisi tank. Tumpukan 20ft sendiri sekitar 45%
 * dari seluruh tumpukan, jadi 0,12 menghasilkan ~5% tank di lapangan —
 * mendekati proporsi terminal umum yang bukan terminal kimia.
 */
const TANK_STACK_SHARE = 0.12;

/** Tank jarang ditumpuk lebih dari tiga tinggi. */
const TANK_MAX_TIER = 3;

const LINE_CODES = LINES.map((l) => l.code);
const LINE_WEIGHTS = LINES.map((l) => l.weight);
const PREFIX_BY_LINE = Object.fromEntries(LINES.map((l) => [l.code, l.prefix]));

/**
 * Profil tinggi tumpukan. Lapangan yang lengang menumpuk rendah; lapangan
 * padat terpaksa menumpuk sampai tier atas — bobotnya diinterpolasi dari
 * tingkat isi supaya preset "Stress" benar-benar memenuhi lapangan.
 */
const TIER_LOW = [30, 32, 22, 11, 5];
const TIER_HIGH = [2, 6, 16, 30, 46];

const tierWeights = (fill: number, tiers: number) =>
  Array.from({ length: tiers }, (_, i) => TIER_LOW[i] + (TIER_HIGH[i] - TIER_LOW[i]) * fill);

type StackPlan = {
  size: ContainerSize;
  type: ContainerType;
  height: number;
  line: string;
  vessel: string;
};

function planStack(
  rng: Rng,
  tiers: number,
  slotsLeft: number,
  weights: number[],
): StackPlan {
  const size: ContainerSize = slotsLeft >= 2 && rng() < 0.55 ? 40 : 20;
  // ISO tank cuma ada dalam 20ft. Satu tumpukan tidak pernah campur jenis,
  // sama seperti tumpukan tidak pernah campur ukuran.
  const type: ContainerType = size === 20 && rng() < TANK_STACK_SHARE ? 'tank' : 'gp';
  const height = weighted(
    rng,
    Array.from({ length: tiers }, (_, i) => i + 1),
    weights,
  );
  return {
    size,
    type,
    height: type === 'tank' ? Math.min(height, TANK_MAX_TIER) : height,
    line: weighted(rng, LINE_CODES, LINE_WEIGHTS),
    vessel: pick(rng, VESSELS),
  };
}

export type GenerateOptions = {
  /** Tingkat isi lapangan, 0..1 */
  fill?: number;
  seed?: number;
  /** Tanggal acuan untuk field inDate (ISO date). Wajib supaya deterministik. */
  today?: string;
};

/**
 * Membangkitkan isi lapangan secara deterministik.
 *
 * Tumpukan dibuat per (blok, row): berjalan dari slot 0 ke kanan, memutuskan
 * ukuran dan tinggi tumpukan, lalu melompati slot yang sudah terpakai. Satu
 * tumpukan selalu berisi kontainer berukuran sama — seperti di lapangan asli.
 */
export function generateYard(opts: GenerateOptions = {}): YardData {
  const fill = Math.min(1, Math.max(0, opts.fill ?? 0.68));
  const rng = mulberry32(opts.seed ?? 20260831);
  const baseDate = Date.parse(opts.today ?? '2026-08-31T00:00:00Z');

  const stackWeights = tierWeights(fill, YARD.tiers);

  const blocks: YardBlock[] = [];
  let serial = 100_000;
  let totalTeu = 0;

  for (let col = 0; col < YARD.blockCols; col++) {
    for (let row = 0; row < YARD.blockRows; row++) {
      const origin = blockOrigin(col, row);
      const block: YardBlock = {
        id: blockId(col, row),
        originX: origin.x,
        originZ: origin.z,
        slots: YARD.slots,
        // Lapangan bangkitan menomori slotnya berurutan: 1, 2, 3, …
        slotStep: 1,
        rot: 0,
        truckLane: 'L',
        slotStart: 'L',
        rows: YARD.rows,
        tiers: YARD.tiers,
        containers: [],
      };

      for (let r = 0; r < YARD.rows; r++) {
        let bay = 0;
        while (bay < YARD.slots) {
          if (rng() > fill) {
            bay += 1;
            continue;
          }
          const plan = planStack(rng, YARD.tiers, YARD.slots - bay, stackWeights);
          const span = plan.size === 40 ? 2 : 1;
          if (bay + span > YARD.slots) break;

          for (let tier = 1; tier <= plan.height; tier++) {
            serial += randInt(rng, 1, 97);
            const tank = plan.type === 'tank';
            const status = tank
              ? weighted(rng, TANK_STATUSES, TANK_STATUS_WEIGHTS)
              : weighted(rng, STATUSES, STATUS_WEIGHTS);
            block.containers.push({
              no: containerNumber(PREFIX_BY_LINE[plan.line], serial),
              size: plan.size,
              type: plan.type,
              status,
              line: plan.line,
              block: block.id,
              bay,
              row: r,
              tier,
              weightKg:
                status === 'empty'
                  // Tare tank jauh lebih berat daripada box: rangka baja plus
                  // barel bertekanan.
                  ? (tank ? 3900 : plan.size === 40 ? 3800 : 2200) + randInt(rng, 0, 200)
                  : randInt(rng, 6000, plan.size === 40 ? 28000 : 21000),
              vessel: plan.vessel,
              inDate: new Date(baseDate - randInt(rng, 0, 21) * 86_400_000)
                .toISOString()
                .slice(0, 10),
              // Lapangan bangkitan tidak punya CTR_STATUS; yang berkategori
              // 'empty' dianggap kosong, sisanya berisi.
              filled: status !== 'empty',
              damaged: status === 'damaged',
              // Lapangan bangkitan hanya mengenal dua bentuk, jadi kode
              // aslinya diturunkan dari bentuk itu — bukan dikarang lebih jauh.
              reefer: status === 'reefer',
              dangerous: status === 'dangerous',
              typeCode: tank ? 'TK' : 'GP',
              isoCode: `${plan.size === 40 ? '42' : '22'}${tank ? 'T' : 'G'}1`,
            });
            totalTeu += plan.size === 40 ? 2 : 1;
          }
          bay += span;
        }
      }
      blocks.push(block);
    }
  }

  const totalContainers = blocks.reduce((n, b) => n + b.containers.length, 0);

  return {
    blocks,
    meta: {
      generatedAt: new Date(baseDate).toISOString(),
      fill,
      totalContainers,
      totalTeu,
      capacityTeu: YARD.blockCols * YARD.blockRows * YARD.slots * YARD.rows * YARD.tiers,
      extentX: YARD_EXTENT_X,
      extentZ: YARD_EXTENT_Z,
      source: 'demo',
      lines: LINES.map((l) => ({ code: l.code, name: l.name })),
    },
  };
}
