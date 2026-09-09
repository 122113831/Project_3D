'use client';

import { LINES } from '@/lib/constants';
import { LINE_COLOR, STATUS_COLOR, STATUS_LABEL, TYPE_LABEL } from '@/lib/palette';
import { useYard } from '@/store/useYard';
import { nf, Panel } from './ui';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className="text-[11px] text-slate-400">{label}</span>
      <span className="text-[12px] font-medium tabular-nums text-slate-100">{value}</span>
    </div>
  );
}

export function DetailPanel() {
  const selected = useYard((s) => s.selected);
  const select = useYard((s) => s.select);

  if (!selected) {
    return (
      <Panel className="pointer-events-auto w-[248px] px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
        Klik salah satu kontainer untuk melihat detailnya.
        {/* Satu isyarat per baris. Sebagai satu kalimat panjang, pemenggalannya
            jatuh di tempat yang salah pada lebar 248 px — "klik kanan drag"
            terpisah dari "= geser". */}
        <div className="mt-1.5 space-y-0.5 text-slate-500">
          <div>Drag — orbit</div>
          <div>Scroll — zoom</div>
          <div>Klik kanan + drag — geser</div>
        </div>
      </Panel>
    );
  }

  const line = LINES.find((l) => l.code === selected.line);

  return (
    <Panel className="pointer-events-auto w-[248px] overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 rounded-[3px]"
            style={{ backgroundColor: LINE_COLOR[selected.line] }}
          />
          <span className="text-[13px] font-semibold tracking-wide text-slate-50">
            {selected.no}
          </span>
        </div>
        <button
          type="button"
          onClick={() => select(null)}
          className="text-slate-500 hover:text-slate-200"
          aria-label="Tutup"
        >
          ✕
        </button>
      </div>

      <div className="px-3 py-2">
        <Row label="Posisi" value={`${selected.block}-${String(selected.bay + 1).padStart(2, '0')}-${selected.row + 1}-${selected.tier}`} />
        <Row label="Blok / bay / row / tier" value={`${selected.block} · ${selected.bay + 1} · ${selected.row + 1} · ${selected.tier}`} />
        <Row label="Ukuran" value={`${selected.size} ft`} />
        <Row label="Jenis" value={TYPE_LABEL[selected.type]} />
        <Row label="Status" value={STATUS_LABEL[selected.status]} />
        <Row label="Operator" value={line?.name ?? selected.line} />
        <Row label="Vessel" value={selected.vessel} />
        {/* GROSS kosong di database depot dan TARE sering ikut kosong, jadi
            0 berarti tidak diketahui — bukan nol kilogram. */}
        <Row
          label="Berat"
          value={selected.weightKg > 0 ? `${nf(selected.weightKg)} kg` : '—'}
        />
        <Row label="Masuk lapangan" value={selected.inDate} />
      </div>

      <div
        className="h-1 w-full"
        style={{ backgroundColor: STATUS_COLOR[selected.status] }}
      />
    </Panel>
  );
}
