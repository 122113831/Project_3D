import { GATE, PITCH, ROAD, RTG, YARD, type RoadKind } from './constants';
import type { BlockSide, YardBlock, YardData, YardSource } from './types';

/**
 * Tata letak lapangan hasil suntingan.
 *
 * Ini LAPISAN DI ATAS data database, bukan penggantinya. Blok yang id-nya
 * cocok dengan blok dari `CORE_YARD_BLOCK` hanya diubah posisi dan ukurannya —
 * isi kontainernya tetap datang dari database. Blok yang dibuat di editor
 * belum ada di database, jadi kosong.
 *
 * Tata letak disimpan di DUA tempat, dan keduanya punya tugas berbeda. Yang
 * menentukan adalah tabel YARD_LAYOUT: satu baris per sumber data, dibagi semua
 * pengguna, ditarik dan didorong oleh LayoutSync — itulah yang membuat jalan
 * dan alat yang ditata di satu PC muncul sama di PC lain. Salinan di
 * localStorage tinggal sebagai singgahan: ia tampil seketika sebelum server
 * menjawab, dan menahan suntingan tetap hidup kalau penyimpanan ke server
 * sedang gagal atau saklar DEPOT_DB_WRITE mati.
 */

export type LayoutBlock = {
  id: string;
  originX: number;
  originZ: number;
  /** Jumlah posisi slot (satu posisi = satu kontainer 20ft). */
  slots: number;
  rows: number;
  tiers: number;
  /** Sudut putar terhadap pusat blok, radian. */
  rot: number;
  /** Sisi lajur layanan truk. */
  truckLane: BlockSide;
  /** Ujung tempat penomoran slot dimulai. */
  slotStart: BlockSide;
  /** Kenaikan nomor slot tiap posisi; 2 mengikuti penomoran ganjil depot. */
  slotStep: number;
};

/** Jenis alat yang bisa diletakkan, sekaligus daftar aset di palet editor. */
export const EQUIPMENT_KINDS = [
  'rtg',
  'rtgAsset',
  'truck',
  'itv',
  'sts',
  'lamp',
  'gate',
  'gateIn',
  'gateOut',
] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export const EQUIPMENT_LABEL: Record<EquipmentKind, string> = {
  rtg: 'RTG (prosedural)',
  rtgAsset: 'RTG crane',
  truck: 'Truk + chassis',
  itv: 'ITV',
  sts: 'STS crane',
  lamp: 'Tiang lampu',
  gate: 'Gate in/out',
  gateIn: 'Gate in',
  gateOut: 'Gate out',
};

/**
 * Ukuran kira-kira tiap alat: alas DAN tinggi.
 *
 * Tingginya bukan hiasan. Uji klik editor menembakkan sinar ke kotak ini, jadi
 * tanpa tinggi yang benar sebuah tiang lampu setinggi 34 m hanya bisa dipilih
 * dengan mengklik telapak kakinya — badan tiangnya sendiri tidak terhubung ke
 * apa pun.
 */
export const EQUIPMENT_FOOTPRINT: Record<
  EquipmentKind,
  { x: number; z: number; y: number }
> = {
  rtg: { x: 12, z: 27, y: RTG.height },
  // Aset RTG diskalakan ke lebar blok saat digambar (lihat rtgAssetScale), jadi
  // ukuran mentah modelnya — 9,5 x 17,5 x 16,7 — bukan lagi yang terlihat di
  // lapangan. Angka di sini memakai skala blok 6 row yang lazim; sama seperti
  // RTG prosedural di atas, kotak ini memang hampiran.
  rtgAsset: { x: 15, z: 28, y: 27 },
  truck: { x: 15.4, z: 2.6, y: 4.2 },
  itv: { x: 16.4, z: 3.2, y: 4 },
  sts: { x: 27, z: 113.8, y: 62 },
  lamp: { x: 5, z: 3.5, y: 34.5 },
  gate: { x: GATE.depth, z: GATE.span, y: GATE.clear + 2.1 },
  gateIn: { x: GATE.depth, z: GATE.span, y: GATE.clear + 2.1 },
  gateOut: { x: GATE.depth, z: GATE.span, y: GATE.clear + 2.1 },
};

export type LayoutEquipment = {
  id: string;
  kind: EquipmentKind;
  x: number;
  z: number;
  /** Rotasi terhadap sumbu Y, radian. */
  ry: number;
  /** Khusus truk: apakah chassis-nya membawa kontainer. */
  loaded?: boolean;
};

/**
 * Sebuah UBIN jalan. Satu ubin = satu petak persegi seukuran ROAD.tile.
 *
 * Dulu jalan adalah pita panjang dengan panjang dan lebar sendiri. Pita tidak
 * bisa berbelok, dan dua pita yang bersilangan cuma saling menimpa tanpa marka
 * persimpangan. Dengan ubin, jalur dibangun dengan menderetkan potongan —
 * lurus, belokan, pertigaan, perempatan — dan marka di tepinya bertemu tepat
 * di batas ubin.
 */
export type LayoutRoad = {
  id: string;
  kind: RoadKind;
  x: number;
  z: number;
  /** Rotasi terhadap sumbu Y, radian. Kelipatan 90 derajat. */
  ry: number;
  /**
   * Panjang searah lengannya, meter. Kosong berarti seukuran ubin penuh.
   *
   * Ada karena ubin berukuran tetap tidak akan pernah bisa menutup celah antar
   * blok: panjang blok kelipatan 6,4 m sedangkan ubin 24 m, dan 24 / 6,4 = 3,75.
   * Sisa yang lebih pendek dari satu ubin itulah yang dulu tidak bisa disambung.
   *
   * Hanya berlaku untuk jalan lurus — lihat roadLen() di roadSnap.ts.
   */
  len?: number;
};

export type YardLayout = {
  version: 1;
  blocks: LayoutBlock[];
  equipment: LayoutEquipment[];
  roads: LayoutRoad[];
  savedAt: string;
  /**
   * Lapangan mana yang ditata: 'depot' atau 'demo'.
   *
   * Sebuah tata letak hanya berarti untuk lapangan asalnya — blok A di database
   * dan A01 di demo bukan blok yang sama. Tanpa penanda ini, salinan di
   * peramban tidak bisa dibedakan asalnya, dan tata letak demo bisa terkirim ke
   * baris DEPOT saat pertama kali diselaraskan.
   *
   * Opsional karena tata letak yang tersimpan sebelum kolom ini ada tidak
   * punya — yang begitu diperlakukan sebagai "tidak diketahui".
   */
  source?: YardSource;
};

/**
 * Kunci penyimpanan tata letak — bernomor versi, dan angkanya HARUS naik setiap
 * kali arti koordinatnya berubah.
 *
 * v1 disimpan waktu lapangan masih digeser ke titik origin. Setelah pemusatan
 * itu dihapus, koordinat dunia jadi koordinat peta yang sebenarnya, dan tata
 * letak v1 yang masih tersimpan di peramban berisi angka dari sistem yang lain.
 * Itu bukan sekadar tampilan meleset: menyimpan posisi blok membaca angka dari
 * tata letak lokal, jadi tata letak basi akan MEMINDAHKAN blok di database ke
 * tempat yang tidak pernah dipilih siapa pun. Terjadi sungguhan pada blok C —
 * X 127 jadi 158,7 — sebelum ini dinaikkan.
 *
 * v2 lalu naik lagi ke v3 waktu jalan berubah dari pita panjang menjadi ubin:
 * bentuk datanya berbeda, dan jalan v2 tidak punya field `kind` sama sekali.
 *
 * Menaikkan versinya membuat tata letak lama diabaikan diam-diam; pengguna
 * tinggal menyalin ulang dari lapangan.
 *
 * Kuncinya SATU PER SUMBER DATA. Dulu hanya satu untuk keduanya, dan akibatnya
 * terlihat langsung: menyunting lapangan database lalu pindah ke demo membuat
 * lapangan demo memakai susunan blok database — karena tata letak yang tersimpan
 * menimpa apa pun yang sedang tampil, tanpa peduli lapangan mana yang ditata.
 */
export const storageKey = (source: YardSource) => `yard3d.layout.v3.${source}`;

/**
 * Kunci lama yang tidak bersumber. Isinya dianggap milik depot — itu satu-satunya
 * sumber yang bisa disunting sungguhan saat kunci itu masih dipakai — lalu
 * dipindahkan ke kunci bersumber dan yang lama dibuang.
 */
const LEGACY_KEY = 'yard3d.layout.v3';

export const newId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export const emptyLayout = (): YardLayout => ({
  version: 1,
  blocks: [],
  equipment: [],
  roads: [],
  savedAt: new Date().toISOString(),
});

export const blockSize = (b: Pick<LayoutBlock, 'slots' | 'rows'>) => ({
  length: b.slots * PITCH.teu,
  width: b.rows * PITCH.row,
});

/** Kotak alas sebuah blok di koordinat dunia. */
export function blockRect(b: LayoutBlock) {
  const { length, width } = blockSize(b);
  return { x0: b.originX, z0: b.originZ, x1: b.originX + length, z1: b.originZ + width };
}

// --- penyimpanan -------------------------------------------------------------

export function loadLayout(source: YardSource): YardLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    let raw = window.localStorage.getItem(storageKey(source));
    // Warisan kunci tunggal: dipungut sekali sebagai tata letak depot, lalu
    // dipindahkan supaya tidak ada dua salinan yang bisa berbeda isinya.
    if (!raw && source === 'depot') {
      raw = window.localStorage.getItem(LEGACY_KEY);
      if (raw) {
        window.localStorage.setItem(storageKey('depot'), raw);
        window.localStorage.removeItem(LEGACY_KEY);
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw) as YardLayout;
    // Versi lama dibuang diam-diam, bukan dipaksa dibaca: bentuknya bisa
    // berbeda dan satu tata letak rusak lebih menyulitkan daripada mulai ulang.
    if (parsed?.version !== 1 || !Array.isArray(parsed.blocks)) return null;
    return {
      ...emptyLayout(),
      ...parsed,
      equipment: parsed.equipment ?? [],
      roads: parsed.roads ?? [],
      source,
    };
  } catch {
    return null;
  }
}

export function saveLayout(source: YardSource, layout: YardLayout) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      storageKey(source),
      JSON.stringify({ ...layout, source, savedAt: new Date().toISOString() }),
    );
  } catch {
    // Kuota penuh atau localStorage dimatikan. Tidak fatal: tata letak tetap
    // hidup di memori sampai tab ditutup, dan tombol Ekspor tetap bekerja.
  }
}

/** Membuang salinan satu sumber saja; sumber yang lain tidak tersentuh. */
export function clearStoredLayout(source: YardSource) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(source));
  } catch {
    // Sama seperti saveLayout: tidak fatal.
  }
}

// --- membentuk tata letak awal dari data yang sedang tampil -------------------

export function layoutFromData(data: YardData): LayoutBlock[] {
  return data.blocks.map((b) => ({
    id: b.id,
    originX: b.originX,
    originZ: b.originZ,
    slots: b.slots,
    rows: b.rows,
    tiers: b.tiers,
    slotStep: b.slotStep ?? 1,
    rot: b.rot ?? 0,
    truckLane: b.truckLane ?? 'L',
    slotStart: b.slotStart ?? 'L',
  }));
}

/** Blok baru berukuran wajar, dipakai saat menaruh blok di lapangan kosong. */
export function defaultBlock(x: number, z: number, id: string): LayoutBlock {
  return {
    id,
    originX: x,
    originZ: z,
    slots: YARD.slots / 2,
    rows: YARD.rows,
    tiers: YARD.tiers,
    slotStep: 2,
    rot: 0,
    truckLane: 'L',
    slotStart: 'L',
  };
}

// --- menerapkan tata letak ke data -------------------------------------------

/**
 * Menggabungkan tata letak dengan data database.
 *
 * Blok dicocokkan berdasarkan id. Kontainer yang jatuh di luar ukuran blok
 * setelah disunting DIBUANG, bukan dijepit ke tepi: menggeser kontainer ke
 * posisi yang bukan tempatnya akan membuat lapangan berbohong tentang isinya.
 */
export function applyLayout(data: YardData, layout: YardLayout | null): YardData {
  if (!layout || layout.blocks.length === 0) return data;

  const fromDb = new Map(data.blocks.map((b) => [b.id, b]));
  let dropped = 0;

  const blocks: YardBlock[] = layout.blocks.map((lb) => {
    const src = fromDb.get(lb.id);
    const containers = (src?.containers ?? []).filter((c) => {
      const fits =
        c.bay >= 0 &&
        c.bay + (c.size === 40 ? 1 : 0) < lb.slots &&
        c.row >= 0 &&
        c.row < lb.rows &&
        c.tier >= 1 &&
        c.tier <= lb.tiers;
      if (!fits) dropped++;
      return fits;
    });
    return {
      id: lb.id,
      originX: lb.originX,
      originZ: lb.originZ,
      slots: lb.slots,
      rows: lb.rows,
      tiers: lb.tiers,
      slotStep: lb.slotStep,
      // Sudut dari database dipakai kalau tata letak lokal belum punya.
      // Tanpa ?? src?.rot, tata letak yang dibuat sebelum fitur rotasi ada akan
      // MENOLKAN sudut yang sudah tersimpan di CORE_YARD_BLOCK — blok tampak
      // lurus padahal datanya bilang miring.
      rot: lb.rot ?? src?.rot ?? 0,
      truckLane: lb.truckLane ?? src?.truckLane ?? 'L',
      slotStart: lb.slotStart ?? src?.slotStart ?? 'L',
      containers,
    };
  });

  const totalContainers = blocks.reduce((n, b) => n + b.containers.length, 0);
  const totalTeu = blocks.reduce(
    (n, b) => n + b.containers.reduce((m, c) => m + (c.size === 40 ? 2 : 1), 0),
    0,
  );
  const capacityTeu = blocks.reduce((n, b) => n + b.slots * b.rows * b.tiers, 0);

  // Luas lapangan diukur ulang dari kotak nyata blok-blok hasil suntingan.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const lb of layout.blocks) {
    const r = blockRect(lb);
    minX = Math.min(minX, r.x0);
    maxX = Math.max(maxX, r.x1);
    minZ = Math.min(minZ, r.z0);
    maxZ = Math.max(maxZ, r.z1);
  }
  // Ubin jalan selalu persegi seukuran ROAD.tile, jadi memutarnya tidak
  // mengubah kotak pembatasnya.
  for (const r of layout.roads) {
    minX = Math.min(minX, r.x - ROAD.tile / 2);
    maxX = Math.max(maxX, r.x + ROAD.tile / 2);
    minZ = Math.min(minZ, r.z - ROAD.tile / 2);
    maxZ = Math.max(maxZ, r.z + ROAD.tile / 2);
  }

  return {
    blocks,
    meta: {
      ...data.meta,
      totalContainers,
      totalTeu,
      capacityTeu,
      fill: capacityTeu > 0 ? totalTeu / capacityTeu : 0,
      extentX: Number.isFinite(minX) ? maxX - minX : data.meta.extentX,
      extentZ: Number.isFinite(minZ) ? maxZ - minZ : data.meta.extentZ,
      centerX: Number.isFinite(minX) ? (minX + maxX) / 2 : data.meta.centerX,
      centerZ: Number.isFinite(minZ) ? (minZ + maxZ) / 2 : data.meta.centerZ,
      droppedByLayout: dropped,
    },
  };
}
