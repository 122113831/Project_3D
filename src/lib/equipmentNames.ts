/**
 * Nama alat untuk papan label dan panel editor — MURNI, supaya diuji.
 *
 * Nama = kode alat yang diisi di panel (LayoutEquipment.code, sama dengan
 * KODE_ALAT di database). Bila kosong, dibuat urut per jenis: RTG01, RTG02,
 * STS01, ITV01, TRK01. Area parkir tidak diberi label (papan namanya sendiri
 * sudah ada) dan tidak membawa alat.
 * (awalan + nomor), lewat rsUnits — sumber yang sama dengan RsWorks.
 */
import { equipmentFootprint, type EquipmentKind, type LayoutEquipment } from './layout';
import { rsUnits } from './rsPlan';

export type EquipmentLabel = {
  /** id alat (untuk RS juga kunci pekerjaan RsWorks). */
  key: string;
  name: string;
  type: string;
  /** Cara label mengikuti alat yang bekerja. */
  group: 'rtg' | 'rs' | 'other';
  x: number;
  y: number;
  z: number;
};

const RTG_KINDS = new Set<EquipmentKind>(['rtg', 'rtgAsset', 'rtgDetail', 'rtgDetail2']);

/** Jenis alat yang diberi label, awalan nama otomatis, dan nama jenisnya. */
const NAMED: Partial<Record<EquipmentKind, { prefix: string; type: string }>> = {
  rtg: { prefix: 'RTG', type: 'RTG' },
  rtgAsset: { prefix: 'RTG', type: 'RTG' },
  rtgDetail: { prefix: 'RTG', type: 'RTG' },
  rtgDetail2: { prefix: 'RTG', type: 'RTG' },
  reachStacker: { prefix: 'RS', type: 'Reach stacker' },
  sts: { prefix: 'STS', type: 'STS crane' },
  itv: { prefix: 'ITV', type: 'ITV' },
  truck: { prefix: 'TRK', type: 'Truk' },
};

/** Jenis alat yang punya kode (dan isian kode di panel editor). */
export const hasEquipmentCode = (kind: EquipmentKind) => kind in NAMED;

/** Nama otomatis tiap alat bernama, menurut urutan di tata letak. */
function autoNames(items: readonly LayoutEquipment[]): Map<string, string> {
  const count = new Map<string, number>();
  const out = new Map<string, string>();
  for (const it of items) {
    const n = NAMED[it.kind];
    if (!n) continue;
    const k = (count.get(n.prefix) ?? 0) + 1;
    count.set(n.prefix, k);
    out.set(it.id, `${n.prefix}${String(k).padStart(2, '0')}`);
  }
  return out;
}

/** Nama yang tampil untuk satu alat (kode isian, atau nama otomatis). */
export function equipmentName(items: readonly LayoutEquipment[], id: string): string {
  const it = items.find((e) => e.id === id);
  return it?.code?.trim() || autoNames(items).get(id) || '';
}

export function equipmentLabels(items: readonly LayoutEquipment[]): EquipmentLabel[] {
  const auto = autoNames(items);
  const out: EquipmentLabel[] = [];
  for (const it of items) {
    const n = NAMED[it.kind];
    if (!n || it.kind === 'reachStacker') continue;
    out.push({
      key: it.id,
      name: it.code?.trim() || auto.get(it.id)!,
      type: n.type,
      group: RTG_KINDS.has(it.kind) ? 'rtg' : 'other',
      x: it.x,
      y: equipmentFootprint(it).y + 1.5,
      z: it.z,
    });
  }
  // RS: kunci & kode sama dengan RsWorks (rsUnits). Nama RS
  // lepas yang kosong mengikuti urutan RS di atas (RS01, RS02, …).
  for (const u of rsUnits(items)) {
    out.push({ key: u.key, name: u.code, type: 'Reach stacker', group: 'rs', x: u.x, y: 8.5, z: u.z });
  }
  return out;
}
