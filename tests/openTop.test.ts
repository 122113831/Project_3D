import { describe, expect, it } from 'vitest';
import { isOpenTop } from '../src/lib/realisticContainer';

describe('open top', () => {
  it('kode ISO berkelompok U (22U1, 42U1, 45U6) = open top', () => {
    expect(isOpenTop({ isoCode: '22U1' })).toBe(true);
    expect(isOpenTop({ isoCode: '42U1' })).toBe(true);
    expect(isOpenTop({ isoCode: '45u6' })).toBe(true);
  });

  it('jenis OT tanpa kode ISO tetap open top', () => {
    expect(isOpenTop({ isoCode: '', typeCode: 'OT' })).toBe(true);
  });

  it('GP, reefer, tank, dan high cube bukan open top', () => {
    for (const iso of ['22G1', '45G1', '22R1', '20T0', '42H2', '']) expect(isOpenTop({ isoCode: iso, typeCode: 'GP' })).toBe(false);
  });
});
