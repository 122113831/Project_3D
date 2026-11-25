'use client';

import { useMemo, type ReactNode } from 'react';
import { filterCounts, legendFor, modeSwatches } from '@/lib/hudCounts';
import { LINES } from '@/lib/constants';
import {
  colorForLine,
  COLOR_MODE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TYPE_FILTER_COLOR,
  TYPE_FILTER_LABEL,
} from '@/lib/palette';
import type {
  ColorMode,
  ContainerSize,
  ContainerStatus,
  TypeFilter,
} from '@/lib/types';
import { pickRelocation } from '@/lib/relocate';
import { useYard, type WeatherMode } from '@/store/useYard';
import { useTraffic } from '@/store/useTraffic';
import { useYardView } from '@/store/useYardView';
import { DayReplay } from './DayReplay';
import { runRsDemo, useRsWorks } from '@/store/useRsWorks';
import type { DockTab } from '@/lib/dock';
import { Btn, Chip, Heading, nf, Panel, Section, Seg, SubLabel, Toggle } from './ui';

const COLOR_MODES: ColorMode[] = ['none', 'line', 'status', 'size', 'tier'];
const MODE_HINT: Record<ColorMode, string> = {
  none: 'Original asset & livery colors',
  line: 'By shipping agent',
  status: 'Full · empty · DG · damaged',
  size: '20 ft · 40 ft',
  tier: 'Stack height',
};

// Reefer TIDAK di sini. Ia jenis kontainer, bukan keadaan muatannya — dan
// renderer pun memperlakukannya begitu, dengan model 3D-nya sendiri.
const STATUSES: ContainerStatus[] = ['full', 'empty', 'dangerous', 'damaged'];
const SIZES: ContainerSize[] = [20, 40];
const TYPES: TypeFilter[] = ['gp', 'tank', 'reefer'];

/**
 * Satu bagian panel. Tanpa `only`: bagian biasa berjudul di kartu panjang.
 * Dengan `only`: hanya bagian yang diminta yang tergambar, tanpa judul —
 * judulnya sudah ada di kepala panel dok (DockPanel).
 */
function Part({ id, title, only, children }: { id: DockTab; title: string; only?: DockTab; children: ReactNode }) {
  if (!only) return <Section title={title}>{children}</Section>;
  return only === id ? <div className="px-3 pb-3 pt-1">{children}</div> : null;
}

export function ControlPanel({ only }: { only?: DockTab } = {}) {
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
  const data = useYardView();

  // Daftar line diambil dari isi lapangan. Data depot memakai kode agennya
  // sendiri (RCL, MSC, HDK) yang tidak ada di konstanta LINES.
  const lines = data?.meta.lines ?? LINES.map((l) => ({ code: l.code, name: l.name }));

  const lineCodes = useMemo(() => lines.map((l) => l.code), [lines]);
  const items = useMemo(() => data?.blocks.flatMap((b) => b.containers) ?? [], [data]);
  const counts = useMemo(() => filterCounts(items), [items]);
  const legend = useMemo(() => legendFor(colorMode, items, lineCodes), [colorMode, items, lineCodes]);
  const legendMax = Math.max(1, ...legend.map((r) => r.n));

  const hasFilter =
    filter.lines.length > 0 ||
    filter.statuses.length > 0 ||
    filter.sizes.length > 0 ||
    filter.types.length > 0;

  return (
    <Wrap only={only}>
      <Part id="color" title="Color by" only={only}>
        <Heading className="mb-2">Color containers by</Heading>
        <div className="grid grid-cols-2 gap-1.5">
          {COLOR_MODES.map((m) => (
            // "Tanpa warna" punya kartunya sendiri; menekan mode yang sedang
            // aktif juga mematikannya, seperti dulu.
            <button
              key={m}
              type="button"
              aria-pressed={colorMode === m}
              onClick={() => setColorMode(colorMode === m && m !== 'none' ? 'none' : m)}
              className={`flex flex-col items-start gap-1.5 rounded-[11px] border px-2.5 py-2 text-left text-[12.5px] font-semibold transition-colors ${
                colorMode === m
                  ? 'border-amber-400/80 bg-amber-400/10 text-slate-50 shadow-[0_0_0_3px_rgba(245,165,36,0.12)]'
                  : 'border-white/[0.08] bg-white/[0.04] text-slate-200 hover:border-white/20'
              }`}
            >
              <span className="flex gap-[3px]">
                {modeSwatches(m, lineCodes).map((c, i) => (
                  <i key={i} className="h-3 w-3 rounded-[3px] ring-1 ring-white/10" style={{ backgroundColor: c }} />
                ))}
              </span>
              {COLOR_MODE_LABEL[m]}
              <small className="text-[11px] font-normal leading-tight text-slate-500">{MODE_HINT[m]}</small>
            </button>
          ))}
        </div>
        <Heading className="mb-1 mt-3.5">Legend · {data ? nf(items.length) : '—'} containers</Heading>
        <div>
          {legend.map((r) => (
            <div key={r.key} className="flex h-8 items-center gap-2.5 px-1 text-[12.5px] text-slate-200">
              <span className="h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-white/10" style={{ backgroundColor: r.color }} />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="h-[5px] w-[52px] overflow-hidden rounded-full bg-white/10">
                <span className="block h-full rounded-full" style={{ width: `${(r.n / legendMax) * 100}%`, backgroundColor: r.color }} />
              </span>
              <span className="w-10 text-right font-mono text-[11.5px] tabular-nums text-slate-400">{nf(r.n)}</span>
            </div>
          ))}
        </div>
      </Part>

      {/* Keempat deret chip ini satu hal yang sama — menyaring apa yang tampil —
          jadi keempatnya satu section dengan label kecil sendiri-sendiri.
          Sebelumnya ukuran dan jenis menumpang di bawah judul "Status" tanpa
          keterangan, dan terbaca seolah status juga. */}
      <Part id="filter" title="Filter" only={only}>
        <p className="mb-2 text-[11.5px] leading-snug text-slate-400">
          Pick what to show; the rest is dimmed. No selection = show all.
        </p>
        <SubLabel>Shipping line</SubLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {lines.map((l) => (
            <Chip
              key={l.code}
              title={l.name}
              color={colorForLine(l.code)}
              count={counts.lines[l.code] ?? 0}
              active={filter.lines.includes(l.code)}
              onClick={() => toggleLine(l.code)}
            >
              {l.code}
            </Chip>
          ))}
        </div>

        <SubLabel>Status</SubLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {STATUSES.map((s) => (
            <Chip
              key={s}
              // Label terpanjang ("Dangerous goods") dipotong oleh lebar chip;
              // judulnya menyimpan yang utuh.
              title={STATUS_LABEL[s]}
              color={STATUS_COLOR[s]}
              count={counts.statuses[s]}
              active={filter.statuses.includes(s)}
              onClick={() => toggleStatus(s)}
            >
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>

        <SubLabel>Size</SubLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {SIZES.map((s) => (
            <Chip key={s} count={counts.sizes[s]} active={filter.sizes.includes(s)} onClick={() => toggleSize(s)}>
              {s} ft
            </Chip>
          ))}
        </div>

        <SubLabel>Type</SubLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPES.map((t) => (
            <Chip
              key={t}
              color={TYPE_FILTER_COLOR[t]}
              count={counts.types[t]}
              active={filter.types.includes(t)}
              onClick={() => toggleType(t)}
            >
              {TYPE_FILTER_LABEL[t]}
            </Chip>
          ))}
        </div>

        {hasFilter && (
          <Btn onClick={resetFilter} className="mt-3 w-full">
            Clear all filters
          </Btn>
        )}
      </Part>

      {(!only || only === 'traffic') && <TrafficSection only={only} />}

      <Part id="options" title="Display options" only={only}>
        <Toggle checked={options.labels} onChange={(v) => setOption('labels', v)}>
          Container numbers (when close)
        </Toggle>
        <Toggle checked={options.adaptive} onChange={(v) => setOption('adaptive', v)}>
          Adaptive quality <span className="text-slate-500">(aim for 60 fps)</span>
        </Toggle>
        <Toggle checked={options.detail} onChange={(v) => setOption('detail', v)}>
          Detailed container models <span className="text-slate-500">(when close)</span>
        </Toggle>
        {options.detail && (
          <Toggle
            checked={options.containerStyle === 'real'}
            onChange={(v) => setOption('containerStyle', v ? 'real' : 'asset')}
          >
            Realistic containers <span className="text-slate-500">(Maersk GP + reefer · off = old assets)</span>
          </Toggle>
        )}
        <Toggle checked={options.shadows} onChange={(v) => setOption('shadows', v)}>
          Shadows <span className="text-slate-500">(heavy)</span>
        </Toggle>
        <Toggle checked={options.blockInfo} onChange={(v) => setOption('blockInfo', v)}>
          Block capacity <span className="text-slate-500">(% full · free boxes)</span>
        </Toggle>
        <Toggle checked={options.equipLabels} onChange={(v) => setOption('equipLabels', v)}>
          Equipment names <span className="text-slate-500">(labels above RTG, RS, …)</span>
        </Toggle>
        <Toggle checked={options.alerts} onChange={(v) => setOption('alerts', v)}>
          Alerts <span className="text-slate-500">(dangerous · damaged · overdue)</span>
        </Toggle>
        <Toggle checked={options.view2d} onChange={(v) => setOption('view2d', v)}>
          2D plan <span className="text-slate-500">(top-down)</span>
        </Toggle>
        <Toggle checked={options.tour} onChange={(v) => setOption('tour', v)}>
          Tour mode <span className="text-slate-500">(camera circles the yard)</span>
        </Toggle>
        <Toggle checked={options.kiosk} onChange={(v) => setOption('kiosk', v)}>
          Monitor screen <span className="text-slate-500">(kiosk · Esc to exit)</span>
        </Toggle>
        <Toggle checked={options.autoSky} onChange={(v) => setOption('autoSky', v)}>
          Follow clock <span className="text-slate-500">(day · dusk · night)</span>
        </Toggle>
        {/* Dengan "Ikuti jam", malam ditentukan matahari — saklarnya dikunci. */}
        <div className={options.autoSky ? 'pointer-events-none opacity-40' : ''}>
          <Toggle checked={options.night} onChange={(v) => setOption('night', v)}>
            Night <span className="text-slate-500">(pole lights on)</span>
          </Toggle>
        </div>
        <SubLabel>Weather</SubLabel>
        <Seg value={options.weather} options={WEATHER} onChange={(v) => setOption('weather', v)} />
      </Part>
    </Wrap>
  );
}

function Wrap({ only, children }: { only?: DockTab; children: ReactNode }) {
  if (only) return <>{children}</>;
  return (
    <Panel className="hud-scroll pointer-events-auto min-h-0 w-[248px] overflow-y-auto overscroll-contain">{children}</Panel>
  );
}

const SPEEDS = [1, 2, 4, 8];

const WEATHER: { v: WeatherMode; label: string; title: string }[] = [
  { v: 'off', label: 'Clear', title: 'No weather effects' },
  { v: 'live', label: 'Live', title: 'Current weather at the depot location (Open-Meteo, every 10 minutes)' },
  { v: 'rain', label: 'Rain', title: 'Force rain — for demos' },
  { v: 'fog', label: 'Fog', title: 'Force thick fog — for demos' },
];

/**
 * Kendali lalu lintas truk gate.
 *
 * Untuk sementara kejadiannya datang dari pemutar ulang GATE_HIST. Saat
 * jembatan HiveMQ tersambung, kejadian yang sama masuk lewat pintu yang sama
 * (useTraffic.ingest) dan bagian ini cukup menampilkan keadaannya.
 */
function TrafficSection({ only }: { only?: DockTab }) {
  const trips = useTraffic((s) => s.trips);
  const replaying = useTraffic((s) => s.replaying);
  const speed = useTraffic((s) => s.speed);
  const setSpeed = useTraffic((s) => s.setSpeed);
  const showNetwork = useTraffic((s) => s.showNetwork);
  const setShowNetwork = useTraffic((s) => s.setShowNetwork);
  const replay = useTraffic((s) => s.replay);
  const stop = useTraffic((s) => s.stop);
  const note = useTraffic((s) => s.note);
  const diag = useTraffic((s) => s.diag);
  const skipped = useTraffic((s) => s.skipped);
  const followRtg = useTraffic((s) => s.followRtg);
  const setFollowRtg = useTraffic((s) => s.setFollowRtg);
  const rtgBusy = useTraffic((s) => s.busyRtg.length);
  const rsBusy = useRsWorks((s) => s.busy.length);

  /**
   * Relokasi contoh: satu kontainer teratas dipindah RTG ke tumpukan lain di
   * blok yang sama — lewat pintu yang sama dengan kejadian SHIFT dari broker.
   */
  const demoShift = () => {
    const data = useYard.getState().data;
    const blocks = [...(data?.blocks ?? [])].sort(() => Math.random() - 0.5);
    for (const b of blocks) {
      const r = pickRelocation(b);
      if (!r) continue;
      useTraffic.getState().ingest({
        kind: 'SHIFT',
        jobNo: '',
        ctrNo: r.c.no,
        truckNo: '',
        flow: 'R',
        position: { block: b.id, slot: r.to.bay * 2 + 1, row: r.to.row + 1, tier: r.to.tier },
      });
      return;
    }
    useTraffic.setState({ note: 'No valid relocation in this yard.' });
  };

  const active = Object.keys(trips).length;
  const skippedList = Object.values(skipped);
  // Alasan dikelompokkan, supaya sepuluh kontainer yang sudah keluar terbaca
  // sebagai satu baris, bukan sepuluh.
  const reasons = new Map<string, number>();
  for (const r of skippedList) {
    const key = /(tidak ada di lapangan|not in (the )?yard)$/.test(r) ? 'container no longer in yard' : r;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  return (
    <Part id="traffic" title="Gate traffic" only={only}>
      <div className="grid grid-cols-2 gap-1.5">
        <Btn active={replaying} onClick={() => void replay(20)} title="Replay the last 20 trips from GATE_HIST">
          {replaying ? '● Replaying' : 'Replay'}
        </Btn>
        <Btn onClick={stop}>Stop</Btn>
      </div>
      <div className="mt-2">
        <Seg value={speed} options={SPEEDS.map((v) => ({ v, label: `${v}×` }))} onChange={setSpeed} mono />
      </div>
      <DayReplay />
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        <Btn onClick={demoShift} title="An RTG moves one container to another stack in the same block">
          Sample relocation
        </Btn>
        <Btn
          active={rsBusy > 0}
          onClick={() => useTraffic.setState({ note: runRsDemo() })}
          title="The next free RS leaves its parking spot, relocates one container in the edge row of the nearest block, then returns"
        >
          Run RS{rsBusy ? ` · ${rsBusy}` : ''}
        </Btn>
        <Btn
          className="col-span-2"
          active={followRtg}
          onClick={() => setFollowRtg(!followRtg)}
          title="Camera follows an RTG or RS that is working"
        >
          Follow equipment{rtgBusy + rsBusy ? ` · ${rtgBusy + rsBusy}` : ''}
        </Btn>
      </div>
      <div className="mt-1.5">
        <Toggle checked={showNetwork} onChange={setShowNetwork}>
          Road network
        </Toggle>
      </div>

      <div className="mt-1 space-y-0.5 text-[11.5px] leading-relaxed text-slate-400">
        <div>
          {active} trucks in yard
          {diag && ` · ${diag.gatesIn} gates in · ${diag.gatesOut} gates out`}
        </div>
        {note && <div>{note}</div>}
        {diag && diag.gatesIn === 0 && (
          <div className="text-amber-400/80">
            The layout has no gate yet — place a gate on a road via Edit yard.
          </div>
        )}
        {diag && diag.unreachable.length > 0 && diag.gatesIn > 0 && (
          <div className="text-amber-400/80">
            No road connection to a gate: block {diag.unreachable.join(', ')}
          </div>
        )}
        {[...reasons].map(([r, n]) => (
          <div key={r} className="text-amber-400/70">
            {n} skipped: {r}
          </div>
        ))}
      </div>
    </Part>
  );
}
