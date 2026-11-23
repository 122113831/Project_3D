import { describe, expect, it } from 'vitest';
import { equipmentLabels, equipmentName, hasEquipmentCode } from '../src/lib/equipmentNames';
import type { LayoutEquipment } from '../src/lib/layout';

const items: LayoutEquipment[] = [
  { id: 'l1', kind: 'lamp', x: 0, z: 0, ry: 0 },
  { id: 'r1', kind: 'rtgDetail2', x: 10, z: 20, ry: 0 },
  { id: 'r2', kind: 'rtgAsset', x: 30, z: 20, ry: 0, code: 'RTG-B1' },
  { id: 'r3', kind: 'rtg', x: 50, z: 20, ry: 0 },
  { id: 's1', kind: 'sts', x: 0, z: 90, ry: 0 },
  { id: 'rs', kind: 'reachStacker', x: 5, z: 5, ry: 0 },
  { id: 'pk', kind: 'parking', x: -40, z: 50, ry: 0, parking: { vehicle: 'reachStacker', bays: 4 } },
  { id: 'g1', kind: 'gate', x: 0, z: 0, ry: 0 },
];

describe('nama alat', () => {
  it('kode isian dipakai; kosong = urut per jenis (semua RTG satu urutan)', () => {
    expect(equipmentName(items, 'r1')).toBe('RTG01');
    expect(equipmentName(items, 'r2')).toBe('RTG-B1');
    expect(equipmentName(items, 'r3')).toBe('RTG03');
    expect(equipmentName(items, 's1')).toBe('STS01');
    expect(equipmentName(items, 'l1')).toBe('');
  });

  it('label untuk alat saja — bukan lampu, gate, atau area parkir', () => {
    const l = equipmentLabels(items);
    expect(l.map((x) => [x.key, x.name, x.group])).toEqual([
      ['r1', 'RTG01', 'rtg'],
      ['r2', 'RTG-B1', 'rtg'],
      ['r3', 'RTG03', 'rtg'],
      ['s1', 'STS01', 'other'],
      ['rs', 'RS01', 'rs'],
    ]);
    // Label di atas alatnya: STS jauh lebih tinggi dari RTG.
    expect(l.find((x) => x.key === 's1')!.y).toBeGreaterThan(l.find((x) => x.key === 'r1')!.y);
  });

  it('isian kode tersedia untuk alat, tidak untuk lampu/gate/gudang', () => {
    expect(hasEquipmentCode('rtgDetail')).toBe(true);
    expect(hasEquipmentCode('reachStacker')).toBe(true);
    expect(hasEquipmentCode('lamp')).toBe(false);
    expect(hasEquipmentCode('warehouse')).toBe(false);
  });
});
