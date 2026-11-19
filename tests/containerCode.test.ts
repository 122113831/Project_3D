import { describe, expect, it } from 'vitest';
import { BLANK, CODE_VALID, GLYPHS, codeString, decodeChar, encodeCode, isoFor } from '@/lib/containerCode';

const roundTrip = (no: string, iso: string) => {
  const a0 = new Float32Array(4);
  const a1 = new Float32Array(4);
  encodeCode(no, iso, a0, a1, 0);
  const s = Array.from({ length: 15 }, (_, k) => {
    const c = decodeChar(a0, a1, k);
    return c === BLANK ? ' ' : GLYPHS[c];
  }).join('');
  return { s, valid: a1[3] };
};

describe('nomor kontainer per instance', () => {
  it('nomor + ISO kembali utuh lewat rumus dekode shader', () => {
    expect(roundTrip('KKLU2390978', '42G1')).toEqual({ s: 'KKLU239097842G1', valid: CODE_VALID });
    expect(roundTrip('ZZZU9999999', 'ZZZZ').s).toBe('ZZZU9999999ZZZZ');
  });

  it('nomor kotor dirapikan: huruf kecil, spasi, tanda baca, terlalu pendek', () => {
    expect(codeString('msku 220-417 0', '22g1')).toBe('MSKU220417022G1');
    expect(roundTrip('AB12', '').s).toBe('AB12'.padEnd(15, ' '));
  });

  it('ISO dari data kalau valid, kalau tidak ditebak dari ukuran dan reefer', () => {
    expect(isoFor({ isoCode: '45G1', size: 40 })).toBe('45G1');
    expect(isoFor({ isoCode: '', size: 20 })).toBe('22G1');
    expect(isoFor({ isoCode: 'x', size: 40, reefer: true })).toBe('45R1');
  });
});
