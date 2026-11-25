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
import { RTG_DETAIL, rtgDetailModel, rtgDetailRailZ, type RtgDetailModel } from './rtgDetail';
import { rtgDetail2Model } from './rtgDetail2';
import { warehouseModel } from './warehouse';
import { createReachStacker } from './reachStacker';
import type { WarehouseSpec } from './warehouseSpec';
import { parkingModel } from './parking';
import { buildReeferRack, rackMaterials } from './reeferRack';
import { PARKING_VEHICLE, parkingSpec, type ParkingSpec } from './parkingSpec';
import {
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
  equipmentFootprint,
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

export type AssetCategory = 'block' | 'road' | 'gate' | 'equipment' | 'warehouse' | 'parking';

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  block: 'Block',
  road: 'Road',
  gate: 'Gate',
  equipment: 'Equipment',
  warehouse: 'Warehouse',
  parking: 'Parking',
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
const LAMP = new THREE.MeshPhongMaterial({ color: '#6f7681', shininess: 10 });
const GATE_FRAME = new THREE.MeshPhongMaterial({ color: '#9aa3ad', shininess: 14 });
/** Warna kontainer contoh — sekadar supaya kartu blok terbaca sebagai tumpukan. */
const CARGO = ['#3f6ea8', '#c0392b', '#2f8f5b', '#d8a520', '#8d949c'].map(
  (c) => new THREE.MeshPhongMaterial({ color: c, shininess: 12 }),
);
/** Reefer di kartu blok reefer: badan putih. */
const REEFER_WHITE = new THREE.MeshPhongMaterial({ color: '#e9ecee', shininess: 20 });

/** Alas blok beserta beberapa tumpukan contoh. */
function blockPreview(slots: number, rows: number, tiers: number, reefer = false) {
  const g = new THREE.Group();
  if (reefer) {
    // Blok reefer: rak listriknya ikut di kartu, tumpukan reefer putih.
    const rack = buildReeferRack(slots, rows, tiers, 1);
    const rm = rackMaterials();
    for (const k of ['steel', 'rail', 'grating', 'socket'] as const) g.add(new THREE.Mesh(rack[k], rm[k]));
  }
  const cargo = reefer ? [REEFER_WHITE] : CARGO;
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
        const m = new THREE.Mesh(geo20, cargo[(bay + row + t) % cargo.length]);
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

/** Pratinjau RTG detail: model yang SAMA dengan lapangan, blok 6 row. */
function rtgDetailPreview(model: (railZ: number) => RtgDetailModel = rtgDetailModel) {
  const m = model(rtgDetailRailZ(6 * PITCH.row));
  const g = new THREE.Group();
  for (const p of [...m.frame, ...m.trolley, ...m.ropes]) g.add(new THREE.Mesh(p.geometry, p.material));
  const sp = new THREE.Group();
  sp.position.y = RTG_DETAIL.restUnder;
  for (const p of m.spreader) sp.add(new THREE.Mesh(p.geometry, p.material));
  g.add(sp);
  return g;
}

/** Pratinjau gudang: model yang SAMA dengan lapangan. */
function warehousePreview(spec: Partial<WarehouseSpec>) {
  const g = new THREE.Group();
  for (const p of warehouseModel(spec)) g.add(new THREE.Mesh(p.geometry, p.material));
  return g;
}

/** Pratinjau parkir: pelat lajur saja (model yang sama dengan lapangan). */
function parkingPreview(spec: Partial<ParkingSpec>) {
  const g = new THREE.Group();
  for (const p of parkingModel(spec)) g.add(new THREE.Mesh(p.geometry, p.material));
  return g;
}

/** Area parkir siap pakai; jumlah lajur & baris tetap bisa diubah di panel. */
const PARKING_PRESETS: { id: string; label: string; spec: Partial<ParkingSpec> }[] = [
  { id: 'pk-rs-4', label: 'RS parking, 4 bays', spec: { vehicle: 'reachStacker', bays: 4, rows: 1, label: 'RS PARKING' } },
  { id: 'pk-rs-8', label: 'RS parking, 2 rows', spec: { vehicle: 'reachStacker', bays: 4, rows: 2, label: 'RS PARKING' } },
  { id: 'pk-truck-6', label: 'Truck parking, 6 bays', spec: { vehicle: 'truck', bays: 6, rows: 1, label: 'TRUCK PARKING' } },
];

/** Ukuran gudang siap pakai di palet; ukuran & detail tetap bisa diubah di panel. */
const WAREHOUSE_PRESETS: { id: string; label: string; spec: Partial<WarehouseSpec> }[] = [
  { id: 'wh-s', label: 'Small warehouse', spec: { w: 30, d: 18, h: 7, roof: 'gable', office: false, canopy: false, label: 'WAREHOUSE' } },
  { id: 'wh-m', label: 'Medium warehouse', spec: { w: 60, d: 30, h: 9, roof: 'gable', label: 'WAREHOUSE' } },
  { id: 'wh-l', label: 'Large warehouse', spec: { w: 96, d: 42, h: 12, roof: 'saw', wall: '#cfd6cf', roofColor: '#2f6b46', label: 'WAREHOUSE' } },
  { id: 'wh-cfs', label: 'CFS warehouse', spec: { w: 72, d: 36, h: 10, roof: 'flat', wall: '#e8e2d2', roofColor: '#9a3b2c', label: 'CFS' } },
];

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
    label: 'New block',
    detail: `Starts at ${dim(20, 6)} · size set in the dialog`,
    spec: { kind: 'block', block: { slots: 20, rows: 6, tiers: 7, slotStep: 2, rot: 0, truckLane: 'L', slotStart: 'L' } },
    build: () => blockPreview(20, 6, 7),
  },
  {
    id: 'block-reefer',
    category: 'block',
    label: 'Reefer block',
    detail: `Reefer-only block with power racks · ${dim(20, 6)}`,
    spec: {
      kind: 'block',
      block: { slots: 20, rows: 6, tiers: 5, slotStep: 2, rot: 0, truckLane: 'L', slotStart: 'L', reefer: true },
    },
    build: () => blockPreview(20, 6, 5, true),
  },

  // Satu kartu per bentuk ubin. Arah belokan tidak perlu kartu sendiri:
  // tekan R untuk memutarnya 90 derajat.
  ...ROAD_KINDS.map(
    (k): AssetItem => ({
      id: `road-${k}`,
      category: 'road',
      label: ROAD_LABEL[k],
      detail: `${ROAD.tile} x ${ROAD.tile} m · R rotates 90°`,
      spec: { kind: 'road', road: { kind: k, ry: 0 } },
      build: () => roadPreview(k),
    }),
  ),

  {
    id: 'rtg-detail',
    category: 'equipment',
    label: 'Detailed RTG (yellow)',
    detail: '25 m gantry · procedural · fits block width',
    spec: { kind: 'equipment', equipment: 'rtgDetail' },
    build: () => rtgDetailPreview(),
  },
  {
    id: 'rtg-detail-2',
    category: 'equipment',
    label: 'Detailed RTG 2 (festoon)',
    detail: '25 m gantry · cable festoon · fits block width',
    spec: { kind: 'equipment', equipment: 'rtgDetail2' },
    build: () => rtgDetailPreview(rtgDetail2Model),
  },
  {
    id: 'rtg-asset',
    category: 'equipment',
    label: 'RTG crane',
    detail: '16,084 triangles · GLB asset',
    spec: { kind: 'equipment', equipment: 'rtgAsset' },
    model: RTG_CRANE_MODEL_URL,
  },
  {
    id: 'itv',
    category: 'equipment',
    label: 'ITV',
    detail: '16.4 m · 23,683 triangles · GLB asset',
    spec: { kind: 'equipment', equipment: 'itv' },
    model: ITV_MODEL_URL,
  },
  {
    id: 'sts',
    category: 'equipment',
    label: 'STS crane',
    detail: '114 m outreach · 23,502 triangles · GLB asset',
    spec: { kind: 'equipment', equipment: 'sts' },
    model: STS_MODEL_URL,
  },
  {
    id: 'rtg',
    category: 'equipment',
    label: 'Procedural RTG',
    detail: '27 m gantry · fits block width',
    spec: { kind: 'equipment', equipment: 'rtg' },
    build: rtgPreview,
  },
  // Gate dua arus lebih dulu: satu jalan lurus membawa dua arah, jadi inilah
  // bentuk yang biasa dipakai. Yang satu arah disediakan untuk jalan yang
  // memang cuma dilalui satu arah.
  {
    id: 'gate-both',
    category: 'gate',
    label: 'Gate in/out',
    detail: `${GATE.lanes} lanes · ${GATE.lanes / 2} in + ${GATE.lanes / 2} out`,
    spec: { kind: 'equipment', equipment: 'gate' },
    build: () => gatePreview('both'),
  },
  {
    id: 'gate-in',
    category: 'gate',
    label: 'Gate in',
    detail: `${GATE.lanes} lanes in · ${GATE.depth} x ${GATE.span} m`,
    spec: { kind: 'equipment', equipment: 'gateIn' },
    build: () => gatePreview('in'),
  },
  {
    id: 'gate-out',
    category: 'gate',
    label: 'Gate out',
    detail: `${GATE.lanes} lanes out · ${GATE.depth} x ${GATE.span} m`,
    spec: { kind: 'equipment', equipment: 'gateOut' },
    build: () => gatePreview('out'),
  },
  ...WAREHOUSE_PRESETS.map(
    (p): AssetItem => ({
      id: p.id,
      category: 'warehouse',
      label: p.label,
      detail: `${p.spec.w} x ${p.spec.d} m · ${p.spec.h} m high`,
      spec: { kind: 'equipment', equipment: 'warehouse', extra: { building: p.spec } },
      build: () => warehousePreview(p.spec),
    }),
  ),
  ...PARKING_PRESETS.map((p): AssetItem => {
    const s = parkingSpec(p.spec);
    return {
      id: p.id,
      category: 'parking',
      label: p.label,
      detail: `${s.bays * s.rows} ${PARKING_VEHICLE[s.vehicle].name.toLowerCase()} bays · no equipment`,
      spec: { kind: 'equipment', equipment: 'parking', extra: { parking: p.spec } },
      build: () => parkingPreview(p.spec),
    };
  }),
  {
    id: 'reach-stacker',
    category: 'equipment',
    label: 'Reach stacker',
    detail: 'RS · telescopic boom · 20ft spreader',
    spec: { kind: 'equipment', equipment: 'reachStacker' },
    // Pratinjau dengan boom terangkat, seperti foto acuan.
    build: () => createReachStacker('RS01', { angle: 0.62, ext: 3.5 }),
  },
  {
    id: 'lamp',
    category: 'equipment',
    label: 'Light pole',
    detail: '34 m high',
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
  return equipmentFootprint({
    kind: item.spec.equipment,
    building: item.spec.extra?.building,
    parking: item.spec.extra?.parking,
  });
}

export const itemsIn = (c: AssetCategory) => ASSET_ITEMS.filter((i) => i.category === c);
export const findItem = (id: string) => ASSET_ITEMS.find((i) => i.id === id) ?? null;
