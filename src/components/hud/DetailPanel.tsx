'use client';

import { Panel } from './ui';

/**
 * Kartu petunjuk saat belum ada kontainer yang dipilih.
 *
 * Detail kontainernya sendiri tidak lagi di sini: begitu ada yang diklik, HUD
 * masuk ke mode inspeksi — informasi tampil di kolom kiri (InspectPanel) dan
 * kontainer fisiknya di kolom kanan (ContainerPreview), menggantikan kartu ini.
 */
export function DetailPanel() {
  return (
    <Panel className="pointer-events-auto w-[248px] px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
      Klik salah satu kontainer untuk melihat detailnya.
      {/* Satu isyarat per baris. Sebagai satu kalimat panjang, pemenggalannya
          jatuh di tempat yang salah pada lebar 248 px. */}
      <div className="mt-1.5 space-y-0.5 text-slate-500">
        <div>Drag — orbit</div>
        <div>Scroll — zoom</div>
        <div>Klik kanan + drag — geser</div>
      </div>
    </Panel>
  );
}
