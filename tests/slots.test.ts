import { describe, expect, it } from 'vitest';
import { blockedCount, expandBlocked, isBlocked, normalizeBlocked, toggleBlocked } from '@/lib/slots';

const b = { slots: 10, rows: 4, tiers: 5 };

describe('slot terkunci', () => {
  it('kunci berlaku dari dasar sampai tier teratas', () => {
    const cells = toggleBlocked([], b, 0, 0, 1);
    expect(cells).toEqual([{ bay: 0, row: 0, tier: 1 }]);
    for (let t = 1; t <= 5; t++) expect(isBlocked(cells, 0, 0, t)).toBe(true);
    expect(isBlocked(cells, 0, 1, 1)).toBe(false);
    expect(blockedCount(cells, b)).toBe(5);
    expect(expandBlocked(cells, b)).toHaveLength(5);
  });

  it('kunci dari tier 3 menyisakan tier 1-2 bebas', () => {
    const cells = toggleBlocked([], b, 2, 1, 3);
    expect(isBlocked(cells, 2, 1, 2)).toBe(false);
    expect(isBlocked(cells, 2, 1, 3)).toBe(true);
    expect(blockedCount(cells, b)).toBe(3);
  });

  it('klik sel terkunci membuka seluruh kolom', () => {
    const cells = toggleBlocked([], b, 2, 1, 1);
    expect(toggleBlocked(cells, b, 2, 1, 4)).toEqual([]);
  });

  it('klik di bawah dasar kunci menurunkan dasarnya', () => {
    const cells = toggleBlocked([], b, 2, 1, 4);
    expect(toggleBlocked(cells, b, 2, 1, 2)).toEqual([{ bay: 2, row: 1, tier: 2 }]);
  });

  it('normalisasi membuang yang di luar blok dan menyatukan satu kolom', () => {
    const cells = normalizeBlocked(
      [
        { bay: 0, row: 0, tier: 4 },
        { bay: 0, row: 0, tier: 2 },
        { bay: 99, row: 0, tier: 1 },
        { bay: 1, row: 1, tier: 9 },
      ],
      b,
    );
    expect(cells).toEqual([{ bay: 0, row: 0, tier: 2 }]);
  });
});
