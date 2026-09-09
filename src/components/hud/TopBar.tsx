'use client';

import { useMemo } from 'react';
import { matchesFilter } from '@/lib/instances';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { nf, Panel, Stat } from './ui';

/**
 * Identitas aplikasi dan angka isi lapangan.
 *
 * Angka renderer TIDAK ada di sini — itu PerfBar, panel sendiri di ujung kanan
 * baris atas. Keduanya menjawab pertanyaan yang berbeda: yang ini soal isi
 * lapangan, yang itu soal berat tidaknya menggambarnya.
 */
export function TopBar() {
  const data = useYardView();
  const filter = useYard((s) => s.filter);
  const loading = useYard((s) => s.loading);

  const shown = useMemo(() => {
    if (!data) return 0;
    const filtering =
      filter.lines.length || filter.statuses.length || filter.sizes.length;
    if (!filtering) return data.meta.totalContainers;
    let n = 0;
    for (const b of data.blocks) for (const c of b.containers) if (matchesFilter(c, filter)) n++;
    return n;
  }, [data, filter]);

  const occupancy = data ? (data.meta.totalTeu / data.meta.capacityTeu) * 100 : 0;

  return (
    <Panel className="pointer-events-auto flex items-center gap-5 px-4 py-2.5">
      {/* Garis pemisah menempel pada judul, bukan jarak kosong yang melar:
          kelompok statistik harus terbaca sebagai satu deret rapat. */}
      <div className="border-r border-white/10 pr-5">
        <div className="text-[13px] font-semibold tracking-wide text-slate-50">
          Container Yard 3D
        </div>
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">
          {data ? `${data.blocks.length} blok` : loading ? 'memuat…' : '—'}
        </div>
      </div>

      <Stat label="Kontainer" value={data ? nf(data.meta.totalContainers) : '—'} />
      <Stat label="TEU" value={data ? nf(data.meta.totalTeu) : '—'} />
      <Stat
        label="Okupansi"
        value={data ? `${occupancy.toFixed(0)}%` : '—'}
        hint={data ? `dari ${nf(data.meta.capacityTeu)} slot` : undefined}
      />
      <Stat label="Tampil" value={data ? nf(shown) : '—'} />
    </Panel>
  );
}
