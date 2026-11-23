import { describe, expect, it } from 'vitest';
import { equipmentFootprint } from '../src/lib/layout';
import { PARKING_VEHICLE, parkingSlots, parkingSpec } from '../src/lib/parkingSpec';
import { rsUnits } from '../src/lib/rsPlan';

describe('parkir alat', () => {
  it('jumlah lajur = lajur per baris × baris; baris kedua menghadap sebaliknya', () => {
    const slots = parkingSlots({ bays: 4, rows: 2 });
    expect(slots).toHaveLength(8);
    expect(slots.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(slots[0].ry).toBe(0);
    expect(slots[4].ry).toBe(Math.PI);
  });

  it('lajur dibatasi 1–30; isian lama (alat parkir, awalan) diabaikan', () => {
    expect(parkingSpec({ bays: 99 }).bays).toBe(30);
    expect(parkingSpec({ bays: 0 }).bays).toBe(4); // kosong/0 → bawaan
    const legacy = parkingSpec({ bays: 3, parked: 2, prefix: 'RS' } as never);
    expect(legacy).toEqual({ bays: 3, rows: 1, vehicle: 'reachStacker', label: 'PARKIR RS' });
  });

  it('tapak membesar mengikuti jumlah lajur dan jenis alat', () => {
    const a = equipmentFootprint({ kind: 'parking', parking: { bays: 4, vehicle: 'reachStacker' } });
    const b = equipmentFootprint({ kind: 'parking', parking: { bays: 8, vehicle: 'reachStacker' } });
    expect(b.z - a.z).toBeCloseTo(4 * PARKING_VEHICLE.reachStacker.bayW);
    const t = equipmentFootprint({ kind: 'parking', parking: { bays: 4, rows: 2, vehicle: 'truck' } });
    expect(t.x).toBeCloseTo(2 * PARKING_VEHICLE.truck.bayL + 3);
  });

  it('area parkir tidak membawa alat: RS hanya dari RS yang ditaruh sendiri', () => {
    expect(rsUnits([{ id: 'pk', kind: 'parking', x: 0, z: 0, ry: 0, parking: { bays: 4 } }])).toEqual([]);
  });
});
