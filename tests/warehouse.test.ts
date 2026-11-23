import { describe, expect, it } from 'vitest';
import { equipmentFootprint } from '@/lib/layout';
import { warehouseBounds, warehouseFootprint, warehouseSpec, WAREHOUSE_LIMITS } from '@/lib/warehouseSpec';

describe('gudang', () => {
  it('ukuran dibatasi dan kanopi hanya ada bila ada dock', () => {
    const s = warehouseSpec({ w: 999, d: 1, h: 100, docks: false, canopy: true });
    expect(s.w).toBe(WAREHOUSE_LIMITS.w[1]);
    expect(s.d).toBe(WAREHOUSE_LIMITS.d[0]);
    expect(s.h).toBe(WAREHOUSE_LIMITS.h[1]);
    expect(s.canopy).toBe(false);
  });

  it('tapak mencakup badan + dock/kanopi + kantor, dan tiap gudang beda ukuran', () => {
    const kecil = warehouseFootprint({ w: 30, d: 18, office: false, docks: true, canopy: false });
    expect(kecil.x).toBeCloseTo(30 + 2, 5);
    expect(kecil.z).toBeCloseTo(18 + 1 + 3.2 + 0.2, 5);
    const sedang = equipmentFootprint({ kind: 'warehouse', building: { w: 60, d: 30, office: true, canopy: true } });
    expect(sedang.x).toBeCloseTo(60 + 2 + 8, 5);
    expect(sedang.z).toBeCloseTo(30 + 1 + 5.6 + 0.2, 5);
    // Alat lain tetap memakai ukuran tetapnya.
    expect(equipmentFootprint({ kind: 'lamp' }).y).toBeCloseTo(34.5, 5);
  });

  it('tengah tapak bergeser ke arah kantor (-X) dan dock (+Z)', () => {
    const b = warehouseBounds(warehouseSpec({ w: 60, d: 30, office: true, docks: true, canopy: true }));
    expect(b.cx).toBeLessThan(0);
    expect(b.cz).toBeGreaterThan(0);
  });
});
