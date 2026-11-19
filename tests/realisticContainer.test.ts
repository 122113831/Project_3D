import { describe, expect, it } from 'vitest';
import { isoCheckDigit } from '@/lib/realisticContainer';

describe('check digit ISO 6346', () => {
  it('cocok dengan contoh resmi dan nomor nyata', () => {
    expect(isoCheckDigit('CSQU305438')).toBe(3); // contoh di ISO 6346
    expect(isoCheckDigit('MSKU907032')).toBe(3);
  });
});
