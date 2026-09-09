'use client';

import { ControlPanel } from './ControlPanel';
import { EditorPanel } from './EditorPanel';
import { EditorPalette } from './EditorPalette';
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
 */
export function Hud() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <TopBar />
        <SearchBar />
        <div className="ml-auto">
          <PerfBar />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-start justify-between gap-3">
        <div className="flex max-h-full flex-col gap-3 overflow-y-auto pr-1">
          <ControlPanel />
        </div>
        <div className="flex max-h-full flex-col items-end gap-3 overflow-y-auto pl-1">
          <EditorPanel />
          <DetailPanel />
        </div>
      </div>

      <EditorPalette />
      <NewBlockDialog />
    </div>
  );
}
