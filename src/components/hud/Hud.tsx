'use client';

import { useEffect, useState } from 'react';
import { glassSolid } from '@/lib/dock';
import { useDock } from '@/store/useDock';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { Dock } from './Dock';
import { DockPanel } from './DockPanel';
import { EditorPanel } from './EditorPanel';
import { EditorPalette } from './EditorPalette';
import { InspectView } from './InspectView';
import { KioskView } from './KioskView';
import { LivePanel } from './LivePanel';
import { Minimap } from './Minimap';
import { NewBlockDialog } from './NewBlockDialog';
import { PerfBar } from './PerfBar';
import { SearchBar } from './SearchBar';
import { TopMenu } from './TopMenu';
import { CommandPalette } from './CommandPalette';
import { KpiBar, TopBar } from './TopBar';
import { EditorToolbar } from './EditorToolbar';

/**
 * Overlay HUD. `pointer-events-none` di lapisan luar supaya drag orbit tetap
 * tembus ke canvas; hanya panel yang mengaktifkan kembali pointer event.
 *
 * Tiga jalur tetap: baris atas (identitas + cari, angka renderer di ujung
 * kanan), kolom kiri untuk kendali tampilan, kolom kanan untuk editor dan
 * detail. `flex-wrap` di baris atas membuat PerfBar turun sendiri ke baris
 * berikutnya di jendela sempit, bukan menggencet kotak pencarian.
 *
 * MODE INSPEKSI. Begitu sebuah kontainer dipilih, seluruh HUD diganti layar
 * terbelah: separuh kiri informasinya, separuh kanan kontainer fisiknya,
 * lapangan di belakangnya diredupkan. Esc atau tombol tutup mengembalikan
 * HUD biasa; pencarian yang menemukan kontainer juga membuka layar ini.
 */
/** prefers-reduced-transparency: pengguna yang minta transparansi dikurangi
 *  mendapat kaca padat. */
function useReducedTransparency() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-transparency: reduce)');
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return on;
}

export function Hud() {
  const selected = useYard((s) => s.selected);
  const editing = useEditor((s) => s.open);
  // Mode layar monitor menggantikan seluruh HUD (lihat KioskView).
  const kiosk = useYard((s) => s.options.kiosk);
  const indicators = useDock((s) => s.indicators);
  // Saat menyunting, kolom kanan milik panel editor; indikator disembunyikan
  // supaya panel editor tidak tergencet.
  const showIndicators = indicators && !editing;
  const reducedTransparency = useReducedTransparency();
  // Boolean, bukan seluruh `perf`: PerfProbe menulis perf tiap 500 ms, dan
  // HUD cukup digambar ulang saat kacanya berganti padat / tembus.
  const solidGlass = useYard((s) => glassSolid(s.perf, reducedTransparency));
  // Layar inspeksi tetap terpasang setelah pertama kali dibuka dan hanya
  // disembunyikan saat ditutup: kanvas 3D-nya mahal dibuat (konteks WebGL +
  // kompilasi shader kontainer realistis, ±1,5 dtk per klik di GPU
  // terintegrasi). Kontainer terakhir disimpan supaya isinya tetap ada.
  const [lastSelected, setLastSelected] = useState(selected);
  if (selected && selected !== lastSelected) setLastSelected(selected);
  if (kiosk && !editing) return <KioskView />;

  // Di editor tidak ada layar inspeksi: kontainer sedang disembunyikan, dan
  // klik di lapangan berarti memilih objek atau mengunci slot. Dijaga di sini
  // juga — bukan hanya di Picking — supaya jalur mana pun yang sempat mengisi
  // `selected` tidak membuka popup di tengah penyuntingan.
  const inspecting = !!selected && !editing;
  const inspectC = selected ?? lastSelected;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex flex-col gap-3 p-3"
      data-glass={solidGlass ? 'solid' : 'glass'}
    >
      <div className="relative flex flex-wrap items-start gap-3">
        <TopBar />
        {/*
          Pil angka di tengah RUANG YANG TERSISA antara kartu kiri dan kanan,
          bukan di tengah layar: kartu kanan (cari · kinerja · Ctrl K · ⋯)
          cukup lebar sehingga pil yang dipatok di tengah layar menimpanya di
          jendela 1400-an px. Di jendela sempit baris ini membungkus.
        */}
        <div className="flex min-w-0 flex-1 justify-center">
          {/* Saat Sunting, tengah atas berisi bilah alat editor (urungkan,
              ulangi, hapus, …) seperti mockup; saat Pantau, pil angka. */}
          {editing ? <EditorToolbar /> : <KpiBar />}
        </div>
        <div className="flex items-start gap-2">
          <SearchBar>
            <PerfBar />
            <TopMenu />
          </SearchBar>
        </div>
      </div>

      {/* Ruang bawah dikosongkan untuk dok, kecuali di editor (palet editor
          memakai tempat yang sama dan dok disembunyikan). */}
      <div className={`flex min-h-0 flex-1 items-start justify-between gap-3 ${editing ? '' : 'pb-[76px]'}`}>
        {/* Panel dari dok sendiri yang menggulir, bukan kolom ini: kolomnya
            pointer-events-none, jadi roda tetikus dan bilah gulirnya harus ada
            di kartu yang menerima pointer. */}
        <div className="flex max-h-full min-h-0 flex-col gap-3">{!editing && <DockPanel />}</div>
        {/* Kolom kanan setinggi ruang yang ada: peta mini selalu di dasar dan
            selalu terlihat; editor dan indikator menggulir sendiri di sisa
            ruangnya, bukan mendorong peta mini keluar layar. */}
        <div className="flex min-h-0 flex-col items-end gap-3 self-stretch pl-1">
          <EditorPanel />
          <div
            className={`hud-slide-right hud-scroll min-h-0 overflow-y-auto overscroll-contain rounded-2xl ${showIndicators ? '' : 'is-closed'} ${editing ? 'hidden' : ''}`}
            inert={!showIndicators}
          >
            <LivePanel />
          </div>
          <div className="mt-auto shrink-0">
            <Minimap />
          </div>
        </div>
      </div>

      {!editing && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
          <Dock />
        </div>
      )}

      {inspectC && !editing && <InspectView c={inspectC} open={inspecting} />}
      <CommandPalette />
      <EditorPalette />
      <NewBlockDialog />
    </div>
  );
}
