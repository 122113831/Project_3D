'use client';

import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { ControlPanel } from './ControlPanel';
import { EditorPanel } from './EditorPanel';
import { EditorPalette } from './EditorPalette';
import { InspectView } from './InspectView';
import { LivePanel } from './LivePanel';
import { Minimap } from './Minimap';
import { NewBlockDialog } from './NewBlockDialog';
import { DetailPanel } from './DetailPanel';
import { PerfBar } from './PerfBar';
import { SearchBar } from './SearchBar';
import { TopBar } from './TopBar';

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
export function Hud() {
  const selected = useYard((s) => s.selected);
  const editing = useEditor((s) => s.open);

  // Di editor tidak ada layar inspeksi: kontainer sedang disembunyikan, dan
  // klik di lapangan berarti memilih objek atau mengunci slot. Dijaga di sini
  // juga — bukan hanya di Picking — supaya jalur mana pun yang sempat mengisi
  // `selected` tidak membuka popup di tengah penyuntingan.
  if (selected && !editing) return <InspectView c={selected} />;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col gap-3 p-3">
      <div className="relative flex flex-wrap items-start gap-3">
        <TopBar />
        {/*
          Kotak pencarian dipusatkan terhadap LAYAR, bukan terhadap sisa ruang
          di antara kedua panel. Panel statistik dan panel renderer berbeda
          lebar — dan lebar panel renderer sendiri berubah mengikuti jendela —
          jadi mx-auto akan menaruhnya di tengah yang meleset, dan melesetnya
          berpindah-pindah.

          Pemusatannya baru menyala di xl ke atas. Di bawah itu ketiganya tidak
          muat berdampingan, dan kotak yang dipatok di tengah akan menimpa
          panel statistik; jadi di jendela sempit ia kembali mengalir biasa di
          samping panel itu. `pointer-events-none` hanya perlu saat melayang —
          tanpa itu, pita tak terlihat selebar layar akan menelan drag orbit.
        */}
        <div className="xl:pointer-events-none xl:absolute xl:inset-x-0 xl:top-0 xl:flex xl:justify-center">
          <SearchBar />
        </div>
        <div className="ml-auto">
          <PerfBar />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-between gap-3">
        {/* Kartu kontrol sendiri yang menggulir (lihat ControlPanel), bukan
            kolom ini: kolomnya pointer-events-none, jadi roda tetikus dan
            bilah gulirnya harus ada di kartu yang menerima pointer. */}
        <div className="flex max-h-full min-h-0 flex-col gap-3">
          <ControlPanel />
        </div>
        <div className="flex max-h-full flex-col items-end gap-3 overflow-y-auto pl-1">
          <EditorPanel />
          <DetailPanel />
          <LivePanel />
          <Minimap />
        </div>
      </div>

      <EditorPalette />
      <NewBlockDialog />
    </div>
  );
}
