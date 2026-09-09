import * as THREE from 'three';
import {
  BOX,
  GATE,
  PITCH,
  ROAD,
  ROAD_KINDS,
  ROAD_LABEL,
  type RoadKind,
} from './constants';
import { ITV_MODEL_URL, RTG_CRANE_MODEL_URL, STS_MODEL_URL } from './containerModel';
import {
  createChassisGeometry,
  createChassisLoadGeometry,
  createContainerGeometry,
  createGateGeometry,
  createGateSignGeometry,
  createLampGeometry,
  createRoadTileTexture,
  createRtgGeometry,
  createRtgSpreaderGeometry,
  createSlotMarkingTexture,
} from './geometry';
import {
  EQUIPMENT_FOOTPRINT,
  type EquipmentKind,
  type LayoutBlock,
  type LayoutEquipment,
  type LayoutRoad,
} from './layout';

/**
 * Katalog aset editor.
 *
 * Tiap kartu membawa DUA hal: apa yang ditaruh di lapangan, dan cara membangun
 * pratinjaunya. Pratinjau memakai geometri yang sama dengan yang dipakai
 * renderer, jadi kartu tidak bisa berbohong tentang isi lapangan.
 */

export type AssetCategory = 'block' | 'road' | 'gate' | 'equipment';

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  block: 'Blok',
  road: 'Jalan',
  gate: 'Gate',
  equipment: 'Alat',
};

export type AssetSpec =
  | { kind: 'block'; block: Omit<LayoutBlock, 'id' | 'originX' | 'originZ'> }
  | { kind: 'road'; road: Omit<LayoutRoad, 'id' | 'x' | 'z'> }
  | { kind: 'equipment'; equipment: EquipmentKind; extra?: Partial<LayoutEquipment> };

export type AssetItem = {
  id: string;
  category: AssetCategory;
  label: string;
  /** Baris kedua di kartu: ukuran atau keterangan singkat. */
  detail: string;
  spec: AssetSpec;
  /** Pratinjau prosedural, dibangun langsung. */
  build?: () => THREE.Object3D;
  /** Atau pratinjau dari berkas GLB — aset yang sama yang dipakai lapangan. */
  model?: string;
};

// --- bahan pratinjau ---------------------------------------------------------

const STEEL = new THREE.MeshPhongMaterial({ color: '#3a6ea5', shininess: 20 });
const ORANGE = new THREE.MeshPhongMaterial({ color: '#d9741f', shininess: 20 });
const CHASSIS = new THREE.MeshPhongMaterial({ color: '#5b636e', shininess: 20 });
const LAMP = new THREE.MeshPhongMaterial({ color: '#6f7681', shininess: 10 });
const GATE_FRAME = new THREE.MeshPhongMaterial({ color: '#9aa3ad', shininess: 14 });
/** Warna kontainer contoh — sekadar supaya kartu blok terbaca sebagai tumpukan. */
const CARGO = ['#3f6ea8', '#c0392b', '#2f8f5b', '#d8a520', '#8d949c'].map(
  (c) => new THREE.MeshPhongMaterial({ color: c, shininess: 12 }),
);

/** Alas blok beserta beberapa tumpukan contoh. */
function blockPreview(slots: number, rows: number, tiers: number) {
  const g = new THREE.Group();
  const length = slots * PITCH.teu;
  const width = rows * PITCH.row;

  const slab = new THREE.PlaneGeometry(length, width);
  slab.rotateX(-Math.PI / 2);
  const uv = slab.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * slots, uv.getY(i) * rows);
  const marking = new THREE.MeshPhongMaterial({
    map: createSlotMarkingTexture(2),
    shininess: 2,
  });
  g.add(new THREE.Mesh(slab, marking));

  // Isi sebagian saja: kartu harus menunjukkan BENTUK blok, bukan lapangan penuh.
  const geo20 = createContainerGeometry(BOX.len20);
  let n = 0;
  for (let bay = 0; bay < slots; bay += 2) {
    for (let row = 0; row < rows; row++) {
      const height = ((bay * 7 + row * 3) % tiers) + 1;
      for (let t = 1; t <= height; t++) {
        const m = new THREE.Mesh(geo20, CARGO[(bay + row + t) % CARGO.length]);
        m.position.set(
          -length / 2 + (bay + 0.5) * PITCH.teu,
          (t - 1) * PITCH.tier + BOX.height / 2,
          -width / 2 + (row + 0.5) * PITCH.row,
        );
        g.add(m);
        n++;
      }
    }
    if (n > 90) break;
  }
  return g;
}

/**
 * Satu ubin jalan dengan marka aslinya.
 *
 * Kartu palet memakai tekstur yang SAMA dengan yang dipakai lapangan, jadi
 * bentuk belokan dan persimpangan di kartu tidak bisa berbeda dari yang akan
 * muncul saat ditaruh.
 */
function roadPreview(kind: RoadKind) {
  const g = new THREE.PlaneGeometry(ROAD.tile, ROAD.tile);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(
    g,
    new THREE.MeshPhongMaterial({ map: createRoadTileTexture(kind, 2), shininess: 2 }),
  );
}

const GATE_IN = '#2f8f5b';
const GATE_OUT = '#c0392b';

/** Gate beserta papan namanya; warna papan yang membedakan masuk dan keluar. */
function gatePreview(mode: 'both' | 'in' | 'out') {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(createGateGeometry(mode === 'both' ? 'center' : 'all'), GATE_FRAME));
  const sign = (side: 'full' | 'in' | 'out', color: string) =>
    new THREE.Mesh(
      createGateSignGeometry(side),
      new THREE.MeshPhongMaterial({ color, shininess: 16 }),
    );
  if (mode === 'both') {
    g.add(sign('in', GATE_IN));
    g.add(sign('out', GATE_OUT));
  } else {
    g.add(sign('full', mode === 'in' ? GATE_IN : GATE_OUT));
  }
  return g;
}

function rtgPreview() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(createRtgGeometry(), STEEL));
  g.add(new THREE.Mesh(createRtgSpreaderGeometry(), ORANGE));
  return g;
}

function truckPreview(loaded: boolean) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(createChassisGeometry(), CHASSIS));
  if (loaded) g.add(new THREE.Mesh(createChassisLoadGeometry(), CARGO[0]));
  // Kepala traktor diwakili kotak: aset GLB-nya dimuat asinkron, dan kartu
  // palet tidak boleh menunggu unduhan sebelum bisa digambar.
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.1, 2.5), STEEL);
  cab.position.set(2.9, 2.3, 0);
  g.add(cab);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.9, 1.1, 2.5), CHASSIS);
  frame.position.set(1.5, 0.55, 0);
  g.add(frame);
  return g;
}

// --- katalog -----------------------------------------------------------------

const dim = (slots: number, rows: number) =>
  `${(slots * PITCH.teu).toFixed(0)} x ${(rows * PITCH.row).toFixed(0)} m`;

export const ASSET_ITEMS: AssetItem[] = [
  // Satu kartu blok saja.
  //
  // Dulu ada empat preset ukuran, dan itu masuk akal waktu blok ditempel
  // langsung ke lapangan. Sejak membuat blok lewat dialog — yang kotak slot,
  // row, dan tier-nya bisa diisi bebas — empat kartu cuma menanyakan hal yang
  // sama dua kali.
  {
    id: 'block-new',
    category: 'block',
    label: 'Blok baru',
    detail: `Awal ${dim(20, 6)} · ukuran diatur di dialog`,
    spec: { kind: 'block', block: { slots: 20, rows: 6, tiers: 7, slotStep: 2, rot: 0, truckLane: 'L', slotStart: 'L' } },
    build: () => blockPreview(20, 6, 7),
  },

  // Satu kartu per bentuk ubin. Arah belokan tidak perlu kartu sendiri:
  // tekan R untuk memutarnya 90 derajat.
  ...ROAD_KINDS.map(
    (k): AssetItem => ({
      id: `road-${k}`,
      category: 'road',
      label: ROAD_LABEL[k],
      detail: `${ROAD.tile} x ${ROAD.tile} m · R memutar 90°`,
      spec: { kind: 'road', road: { kind: k, ry: 0 } },
      build: () => roadPreview(k),
    }),
  ),

  {
    id: 'rtg-asset',
    category: 'equipment',
    label: 'RTG crane',
    detail: '16.084 triangle · aset GLB',
    spec: { kind: 'equipment', equipment: 'rtgAsset' },
    model: RTG_CRANE_MODEL_URL,
  },
  {
    id: 'itv',
    category: 'equipment',
    label: 'ITV',
    detail: '16,4 m · 23.683 triangle · aset GLB',
    spec: { kind: 'equipment', equipment: 'itv' },
    model: ITV_MODEL_URL,
  },
  {
    id: 'sts',
    category: 'equipment',
    label: 'STS crane',
    detail: '114 m jangkauan · 23.502 triangle · aset GLB',
    spec: { kind: 'equipment', equipment: 'sts' },
    model: STS_MODEL_URL,
  },
  {
    id: 'rtg',
    category: 'equipment',
    label: 'RTG prosedural',
    detail: 'Portal 27 m · menyesuaikan lebar blok',
    spec: { kind: 'equipment', equipment: 'rtg' },
    build: rtgPreview,
  },
  {
    id: 'truck-loaded',
    category: 'equipment',
    label: 'Truk bermuatan',
    detail: 'Traktor + chassis 40ft + kontainer',
    spec: { kind: 'equipment', equipment: 'truck', extra: { loaded: true } },
    build: () => truckPreview(true),
  },
  {
    id: 'truck-empty',
    category: 'equipment',
    label: 'Truk kosong',
    detail: 'Traktor + chassis 40ft',
    spec: { kind: 'equipment', equipment: 'truck', extra: { loaded: false } },
    build: () => truckPreview(false),
  },
  // Gate dua arus lebih dulu: satu jalan lurus membawa dua arah, jadi inilah
  // bentuk yang biasa dipakai. Yang satu arah disediakan untuk jalan yang
  // memang cuma dilalui satu arah.
  {
    id: 'gate-both',
    category: 'gate',
    label: 'Gate in/out',
    detail: `${GATE.lanes} lajur · ${GATE.lanes / 2} masuk + ${GATE.lanes / 2} keluar`,
    spec: { kind: 'equipment', equipment: 'gate' },
    build: () => gatePreview('both'),
  },
  {
    id: 'gate-in',
    category: 'gate',
    label: 'Gate in',
    detail: `${GATE.lanes} lajur masuk · ${GATE.depth} x ${GATE.span} m`,
    spec: { kind: 'equipment', equipment: 'gateIn' },
    build: () => gatePreview('in'),
  },
  {
    id: 'gate-out',
    category: 'gate',
    label: 'Gate out',
    detail: `${GATE.lanes} lajur keluar · ${GATE.depth} x ${GATE.span} m`,
    spec: { kind: 'equipment', equipment: 'gateOut' },
    build: () => gatePreview('out'),
  },
  {
    id: 'lamp',
    category: 'equipment',
    label: 'Tiang lampu',
    detail: 'Tinggi 34 m',
    spec: { kind: 'equipment', equipment: 'lamp' },
    build: () => new THREE.Mesh(createLampGeometry(), LAMP),
  },
];

/** Ukuran alas kartu, dipakai kotak hantu pratinjau saat menaruh. */
export function assetFootprint(item: AssetItem): { x: number; z: number } {
  if (item.spec.kind === 'block') {
    return {
      x: item.spec.block.slots * PITCH.teu,
      z: item.spec.block.rows * PITCH.row,
    };
  }
  if (item.spec.kind === 'road') {
    return { x: ROAD.tile, z: ROAD.tile };
  }
  return EQUIPMENT_FOOTPRINT[item.spec.equipment];
}

export const itemsIn = (c: AssetCategory) => ASSET_ITEMS.filter((i) => i.category === c);
export const findItem = (id: string) => ASSET_ITEMS.find((i) => i.id === id) ?? null;
