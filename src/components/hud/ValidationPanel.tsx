'use client';

import { useMemo } from 'react';
import { validateLayout, type Issue } from '@/lib/validate';
import { useEditor } from '@/store/useEditor';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { Section } from './ui';

/**
 * Daftar masalah tata letak, diperbarui tiap tata letak berubah. Mengklik
 * satu baris menerbangkan kamera ke lokasinya.
 */
export function ValidationPanel() {
  const layout = useEditor((s) => s.layout);
  const select = useEditor((s) => s.select);
  const setTool = useEditor((s) => s.setTool);
  const selected = useEditor((s) => s.selected);
  const diag = useTraffic((s) => s.diag);
  const flyTo = useYard((s) => s.flyTo);

  // Terbang KE SANA dan PILIH objeknya: kotak sorot kuning di lapangan lalu
  // menunjukkan persis mana yang dimaksud, dan panel properti langsung
  // membukanya. Temuan tanpa objek (belum ada gate) hanya diterbangi.
  const go = (i: Issue) => {
    flyTo(i.x, i.z, i.span);
    setTool('select');
    select(i.target ?? null);
  };

  const issues = useMemo(
    () =>
      layout
        ? validateLayout({
            blocks: layout.blocks,
            roads: layout.roads,
            equipment: layout.equipment,
            diag: diag
              ? {
                  gatesIn: diag.gatesIn,
                  gatesOut: diag.gatesOut,
                  unreachable: diag.unreachable,
                  gatesUnlinked: diag.gatesUnlinked ?? [],
                }
              : null,
          })
        : [],
    [layout, diag],
  );

  const errors = issues.filter((i) => i.level === 'error').length;
  return (
    <Section title={`Pemeriksaan${issues.length ? ` · ${issues.length}` : ''}`}>
      {issues.length === 0 ? (
        <div className="text-[11px] text-emerald-300/90">Tidak ada masalah: semua blok tersambung ke gate.</div>
      ) : (
        <>
          <div className="mb-1 text-[10px] text-slate-500">
            {errors} harus dibetulkan{issues.length - errors > 0 ? ` · ${issues.length - errors} perlu dilihat` : ''}.
            Klik untuk terbang ke lokasinya.
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
            {issues.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => go(i)}
                className={`flex w-full items-start gap-1.5 rounded px-1 py-0.5 text-left text-[11px] leading-snug hover:bg-white/10 ${
                  i.target && selected?.type === i.target.type && selected.id === i.target.id
                    ? 'bg-amber-400/15 text-amber-100'
                    : 'text-slate-200'
                }`}
              >
                <span className={`mt-[3px] h-2 w-2 shrink-0 rounded-full ${i.level === 'error' ? 'bg-red-400' : 'bg-amber-400'}`} />
                <span>{i.text}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
