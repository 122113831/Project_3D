'use client';

import { LINES } from '@/lib/constants';
import {
  colorForLine,
  COLOR_MODE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TYPE_LABEL,
} from '@/lib/palette';
import type {
  ColorMode,
  ContainerSize,
  ContainerStatus,
  ContainerType,
} from '@/lib/types';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { Chip, Panel, Section, SubLabel, Toggle } from './ui';

const COLOR_MODES: ColorMode[] = ['line', 'status', 'size', 'tier'];
const STATUSES: ContainerStatus[] = ['full', 'empty', 'reefer', 'dangerous', 'damaged'];
const SIZES: ContainerSize[] = [20, 40];
const TYPES: ContainerType[] = ['gp', 'tank'];
const DENSITIES = [
  { label: 'Ringan', value: 0.3 },
  { label: 'Normal', value: 0.68 },
  { label: 'Padat', value: 0.88 },
  { label: 'Stress', value: 1 },
];

export function ControlPanel() {
  const colorMode = useYard((s) => s.colorMode);
  const setColorMode = useYard((s) => s.setColorMode);
  const filter = useYard((s) => s.filter);
  const toggleLine = useYard((s) => s.toggleLine);
  const toggleStatus = useYard((s) => s.toggleStatus);
  const toggleSize = useYard((s) => s.toggleSize);
  const toggleType = useYard((s) => s.toggleType);
  const resetFilter = useYard((s) => s.resetFilter);
  const options = useYard((s) => s.options);
  const setOption = useYard((s) => s.setOption);
  const fill = useYard((s) => s.fill);
  const load = useYard((s) => s.load);
  const loading = useYard((s) => s.loading);
  const source = useYard((s) => s.source);
  const data = useYardView();

  // Daftar line diambil dari isi lapangan. Data depot memakai kode agennya
  // sendiri (RCL, MSC, HDK) yang tidak ada di konstanta LINES.
  const lines = data?.meta.lines ?? LINES.map((l) => ({ code: l.code, name: l.name }));

  const hasFilter =
    filter.lines.length > 0 ||
    filter.statuses.length > 0 ||
    filter.sizes.length > 0 ||
    filter.types.length > 0;

  return (
    <Panel className="pointer-events-auto w-[248px] overflow-hidden">
      <Section title="Pewarnaan">
        <div className="grid grid-cols-2 gap-1">
          {COLOR_MODES.map((m) => (
            // Menekan pilihan yang sedang aktif akan mematikannya. Sebelumnya
            // salah satu selalu harus terpilih, jadi tidak ada cara melihat
            // lapangan tanpa pewarnaan sama sekali.
            <Chip
              key={m}
              active={colorMode === m}
              onClick={() => setColorMode(colorMode === m ? 'none' : m)}
            >
              {COLOR_MODE_LABEL[m]}
            </Chip>
          ))}
        </div>
      </Section>

      {/* Keempat deret chip ini satu hal yang sama — menyaring apa yang tampil —
          jadi keempatnya satu section dengan label kecil sendiri-sendiri.
          Sebelumnya ukuran dan jenis menumpang di bawah judul "Status" tanpa
          keterangan, dan terbaca seolah status juga. */}
      <Section title="Filter">
        <SubLabel>Shipping line</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {lines.map((l) => (
            <Chip
              key={l.code}
              title={l.name}
              color={colorForLine(l.code)}
              active={filter.lines.includes(l.code)}
              onClick={() => toggleLine(l.code)}
            >
              {l.code}
            </Chip>
          ))}
        </div>

        <SubLabel>Status</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {STATUSES.map((s) => (
            <Chip
              key={s}
              // Label terpanjang ("Dangerous goods") dipotong oleh lebar chip;
              // judulnya menyimpan yang utuh.
              title={STATUS_LABEL[s]}
              color={STATUS_COLOR[s]}
              active={filter.statuses.includes(s)}
              onClick={() => toggleStatus(s)}
            >
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>

        <SubLabel>Ukuran</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {SIZES.map((s) => (
            <Chip key={s} active={filter.sizes.includes(s)} onClick={() => toggleSize(s)}>
              {s} ft
            </Chip>
          ))}
        </div>

        <SubLabel>Jenis</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {TYPES.map((t) => (
            <Chip key={t} active={filter.types.includes(t)} onClick={() => toggleType(t)}>
              {TYPE_LABEL[t]}
            </Chip>
          ))}
        </div>

        {hasFilter && (
          <button
            type="button"
            onClick={resetFilter}
            className="mt-2.5 w-full rounded-md border border-white/10 py-1 text-[11px] text-slate-300 hover:border-white/25 hover:text-slate-100"
          >
            Hapus semua filter
          </button>
        )}
      </Section>

      <Section title="Sumber data">
        <div className="grid grid-cols-2 gap-1">
          <Chip
            active={source === 'depot'}
            title="Baca YARD_ROWTIER + CONTAINER dari Oracle"
            onClick={() => void load({ source: 'depot' })}
          >
            Database
          </Chip>
          <Chip
            active={source === 'demo'}
            title="Lapangan bangkitan untuk menguji renderer pada belasan ribu kontainer"
            onClick={() => void load({ source: 'demo' })}
          >
            Demo
          </Chip>
        </div>

        {source === 'demo' && (
          <>
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              {DENSITIES.map((d) => (
                <Chip
                  key={d.label}
                  active={Math.abs(fill - d.value) < 0.01}
                  onClick={() => void load({ fill: d.value, source: 'demo' })}
                >
                  {d.label}
                </Chip>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {loading ? 'Membangun ulang lapangan…' : 'Tingkat isi lapangan bangkitan.'}
            </div>
          </>
        )}

        {source === 'depot' && (
          <div className="mt-1 text-[10px] text-slate-500">
            {loading
              ? 'Membaca database depot…'
              : `${data?.meta.totalContainers ?? 0} kontainer di ${data?.blocks.length ?? 0} blok`}
          </div>
        )}

        {/*
          Cacat data ditampilkan, bukan disembunyikan. Kalau lapangan menggambar
          lebih sedikit kontainer daripada isi database, alasannya harus terbaca
          di layar — bukan cuma di log server.
        */}
        {source === 'depot' && !loading && (data?.meta.conflicts ?? 0) > 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-amber-400/80">
            {data?.meta.conflicts} kontainer bertindihan posisinya di database dan tidak digambar.
          </div>
        )}
        {source === 'depot' && !loading && (data?.meta.duplicateNumbers ?? 0) > 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-amber-400/80">
            {data?.meta.duplicateNumbers} nomor kontainer dipakai lebih dari satu unit.
          </div>
        )}
      </Section>

      <Section title="Opsi tampilan">
        <Toggle checked={options.labels} onChange={(v) => setOption('labels', v)}>
          Nomor kontainer (saat dekat)
        </Toggle>
        <Toggle checked={options.adaptive} onChange={(v) => setOption('adaptive', v)}>
          Kualitas adaptif <span className="text-slate-500">(kejar 60 fps)</span>
        </Toggle>
        <Toggle checked={options.detail} onChange={(v) => setOption('detail', v)}>
          Model kontainer detail <span className="text-slate-500">(saat dekat)</span>
        </Toggle>
        <Toggle checked={options.rtg} onChange={(v) => setOption('rtg', v)}>
          RTG crane
        </Toggle>
        <Toggle checked={options.lamps} onChange={(v) => setOption('lamps', v)}>
          Tiang lampu
        </Toggle>
        <Toggle checked={options.trucks} onChange={(v) => setOption('trucks', v)}>
          Truk
        </Toggle>
        <Toggle checked={options.shadows} onChange={(v) => setOption('shadows', v)}>
          Bayangan <span className="text-slate-500">(berat)</span>
        </Toggle>
      </Section>
    </Panel>
  );
}
