'use client';

import { useMemo } from 'react';
import { matchesFilter } from '@/lib/instances';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { nf, Panel, Stat } from './ui';

/**
 * Kartu identitas di kiri atas: nama aplikasi, keadaan data, dan pilihan
 * mode Pantau / Sunting (menggantikan tombol "Sunting lapangan" lama).
 *
 * Angka isi lapangan ada di KpiBar (pil di tengah atas), angka renderer di
 * PerfBar — tiga pertanyaan berbeda, tiga tempat.
 */
export function TopBar() {
  const data = useYardView();
  const loading = useYard((s) => s.loading);
  const editing = useEditor((s) => s.open);
  const setOpen = useEditor((s) => s.setOpen);

  return (
    <Panel className="pointer-events-auto flex h-11 items-center gap-2.5 py-1.5 pl-1.5 pr-1.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-amber-400 text-[#1a1203]" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
          <rect x="3" y="10" width="8" height="6" rx="1" />
          <rect x="13" y="10" width="8" height="6" rx="1" />
          <rect x="8" y="4" width="8" height="6" rx="1" />
          <path d="M2 20h20" />
        </svg>
      </span>
      <div className="pr-1 leading-tight">
        <div className="text-[13.5px] font-semibold tracking-tight text-slate-50">Container Yard 3D</div>
        <div className="flex items-center gap-1.5 text-[11.5px] text-slate-400">
          <span className={`h-[7px] w-[7px] rounded-full ${data ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          {data ? `${data.blocks.length} blocks · depot data` : loading ? 'loading…' : '—'}
        </div>
      </div>
      <div role="tablist" aria-label="Mode" className="flex gap-0.5 rounded-[10px] bg-white/[0.06] p-[3px]">
        {(
          [
            ['Monitor', false],
            ['Edit', true],
          ] as const
        ).map(([label, edit]) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={editing === edit}
            onClick={() => setOpen(edit)}
            className={`h-[30px] rounded-[8px] px-3 text-[12.5px] font-semibold transition-colors ${
              editing === edit ? 'bg-[#20242e] text-slate-50 shadow-[0_1px_2px_rgba(0,0,0,0.25)]' : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

/** Pil angka isi lapangan di tengah atas. */
export function KpiBar() {
  const data = useYardView();
  const filter = useYard((s) => s.filter);

  const shown = useMemo(() => {
    if (!data) return 0;
    const filtering = filter.lines.length || filter.statuses.length || filter.sizes.length || filter.types.length;
    if (!filtering) return data.meta.totalContainers;
    let n = 0;
    for (const b of data.blocks) for (const c of b.containers) if (matchesFilter(c, filter)) n++;
    return n;
  }, [data, filter]);

  const occupancy = data ? (data.meta.totalTeu / data.meta.capacityTeu) * 100 : 0;
  const cells: [string, string, string?][] = [
    ['Containers', data ? nf(data.meta.totalContainers) : '—'],
    ['TEU', data ? nf(data.meta.totalTeu) : '—'],
    ['Occupancy', data ? `${occupancy.toFixed(0)}%` : '—', data ? `of ${nf(data.meta.capacityTeu)} slots` : undefined],
    ['Shown', data ? nf(shown) : '—'],
  ];

  return (
    <Panel className="pointer-events-auto flex h-11 items-center px-1.5">
      {cells.map(([label, value, title], i) => (
        <div key={label} title={title} className={`px-3 ${i ? 'border-l border-white/[0.08]' : ''}`}>
          <Stat label={label} value={value} />
        </div>
      ))}
    </Panel>
  );
}
