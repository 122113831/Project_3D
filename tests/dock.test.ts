import { describe, expect, it } from 'vitest';
import { DOCK_TABS, dockTabForKey, glassSolid, PANEL_W, viewShiftPx } from '@/lib/dock';

describe('dok menu bawah', () => {
  it('empat menu dengan urutan Warna, Filter, Gate, Tampilan (menu Data dihapus)', () => {
    expect(DOCK_TABS.map((t) => t.id)).toEqual(['color', 'filter', 'traffic', 'options']);
  });

  it('tombol 1–4 memilih menu, 5 = indikator, lainnya bukan pintasan', () => {
    expect(dockTabForKey('1')).toBe('color');
    expect(dockTabForKey('3')).toBe('traffic');
    expect(dockTabForKey('4')).toBe('options');
    expect(dockTabForKey('5')).toBe('indicators');
    expect(dockTabForKey('6')).toBeNull();
    expect(dockTabForKey('a')).toBeNull();
  });
});

describe('kaca HUD padat saat GPU kepayahan', () => {
  const ok = { dpr: 1.5, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)' };

  it('kaca tembus pandang selama resolusi masih penuh', () => {
    expect(glassSolid(ok)).toBe(false);
  });

  it('padat begitu kualitas adaptif menurunkan resolusi di bawah 1', () => {
    expect(glassSolid({ ...ok, dpr: 0.85 })).toBe(true);
  });

  it('dpr 0 = belum diukur, jangan dianggap turun', () => {
    expect(glassSolid({ ...ok, dpr: 0 })).toBe(false);
  });

  it('padat di render perangkat lunak (SwiftShader / llvmpipe)', () => {
    expect(glassSolid({ dpr: 1, renderer: 'Google SwiftShader' })).toBe(true);
    expect(glassSolid({ dpr: 1, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe(true);
  });

  it('padat kalau pengguna minta transparansi dikurangi', () => {
    expect(glassSolid(ok, true)).toBe(true);
  });
});

describe('kamera bergeser saat panel kiri terbuka', () => {
  it('tertutup = tidak bergeser', () => {
    expect(viewShiftPx(false)).toBe(0);
  });

  it('terbuka = isi lapangan bergeser ke kanan setengah lebar panel + sela', () => {
    expect(viewShiftPx(true)).toBe(-(PANEL_W + 12) / 2);
    expect(viewShiftPx(true, 200, 0)).toBe(-100);
  });
});
