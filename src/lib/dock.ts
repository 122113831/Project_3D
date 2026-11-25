/**
 * Dok menu di tengah bawah layar — MURNI, tanpa React, supaya diuji.
 *
 * Empat menu tampilan (dulu ditumpuk di satu kartu panjang di kiri) jadi
 * tombol di dok; menekan satu membuka panelnya di kiri. Indikator (kolom
 * kanan) ikut di dok sebagai tombol kelima.
 */

export type DockTab = 'color' | 'filter' | 'traffic' | 'options';

export const DOCK_TABS: { id: DockTab; label: string; title: string }[] = [
  { id: 'color', label: 'Color', title: 'Color by' },
  { id: 'filter', label: 'Filter', title: 'Filter' },
  { id: 'traffic', label: 'Gate', title: 'Gate traffic' },
  { id: 'options', label: 'Display', title: 'Display options' },
];

/** Pintasan papan ketik: 1–4 menu, 5 indikator. */
export function dockTabForKey(key: string): DockTab | 'indicators' | null {
  const n = Number(key);
  if (!Number.isInteger(n)) return null;
  if (n >= 1 && n <= DOCK_TABS.length) return DOCK_TABS[n - 1].id;
  if (n === DOCK_TABS.length + 1) return 'indicators';
  return null;
}

/** Lebar panel kiri yang dibuka dari dok, px. */
export const PANEL_W = 300;

/**
 * Kaca HUD dibuat padat (tanpa backdrop blur) saat GPU kepayahan.
 *
 * Blur di atas kanvas WebGL berarti tiap frame lapangan dibaca ulang dan
 * dikaburkan per piksel — murah di GPU diskret, mahal di GPU terintegrasi
 * dan sangat mahal di render perangkat lunak. Tanda yang dipakai:
 *  - kualitas adaptif sudah menurunkan resolusi di bawah 1 (PerfProbe),
 *  - renderer perangkat lunak (SwiftShader, llvmpipe),
 *  - pengguna meminta transparansi dikurangi (prefers-reduced-transparency).
 */
export function glassSolid(perf: { dpr: number; renderer: string }, reducedTransparency = false): boolean {
  if (reducedTransparency) return true;
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(perf.renderer)) return true;
  return perf.dpr > 0 && perf.dpr < 0.95;
}

/**
 * Geser horizontal tampilan kamera (px, untuk camera.setViewOffset) saat
 * panel kiri terbuka: negatif = isi lapangan bergeser ke KANAN, sehingga
 * pusat pandangan tetap di tengah ruang yang tidak tertutup panel.
 */
export function viewShiftPx(open: boolean, width = PANEL_W, gap = 12): number {
  return open ? -(width + gap) / 2 : 0;
}
