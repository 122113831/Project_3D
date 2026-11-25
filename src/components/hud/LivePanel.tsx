'use client';

import { useEffect, useState } from 'react';
import { blockOccupancy } from '@/lib/yard';
import { fetchKpi, type YardKpi } from '@/lib/yardApi';
import { truckPose } from '@/components/three/trafficRegistry';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { useDock } from '@/store/useDock';
import { Chip, nf, Panel, Section } from './ui';

/**
 * Panel operasional di kolom kanan: status aliran langsung, kartu truk yang
 * dipilih, dan indikator KPI.
 *
 * Ketiganya soal "apa yang terjadi SEKARANG", berbeda dari panel kendali di
 * kiri yang soal "bagaimana lapangan ditampilkan". Itu sebabnya mereka
 * berkumpul di sini dan bukan di ControlPanel.
 */

const FLOW_LABEL = { R: 'Receiving', D: 'Delivery' } as const;
const PHASE_LABEL = {
  in: 'heading to block',
  hold: 'waiting inside gate',
  wait: 'at bay, waiting for RTG',
  out: 'heading to gate out',
} as const;

function LiveStatus() {
  const live = useTraffic((s) => s.live);
  const source = useYard((s) => s.source);
  if (source !== 'depot') return null;
  const tone =
    live.state === 'live'
      ? 'bg-emerald-400'
      : live.state === 'reconnecting' || live.state === 'connecting'
        ? 'bg-amber-400'
        : 'bg-slate-500';
  const label =
    live.state === 'live'
      ? 'Live feed connected'
      : live.state === 'connecting'
        ? 'Connecting…'
        : live.state === 'reconnecting'
          ? 'Disconnected — reconnecting'
          : 'Live feed off';
  const broker =
    live.mqtt === 'off'
      ? 'broker not configured (MQTT_URL) · receiving via POST'
      : `broker ${live.mqtt}`;
  return (
    <div className="px-3.5 pb-1 pt-1">
      <div
        className={`flex items-start gap-2.5 rounded-[11px] border px-3 py-2.5 text-[12.5px] ${
          live.state === 'live' ? 'border-emerald-400/25 bg-emerald-400/[0.08]' : 'border-white/10 bg-white/[0.04]'
        }`}
      >
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone} ${live.state === 'live' ? 'animate-pulse' : ''}`} />
        <span className="min-w-0">
          <b className="font-semibold text-slate-100">{label}</b>
          <span className="block text-[11.5px] text-slate-400">
            {broker} · {live.received} events
          </span>
          {live.error && <span className="block text-[11px] text-amber-400/80">{live.error}</span>}
        </span>
      </div>
    </div>
  );
}

function TripCard() {
  const id = useTraffic((s) => s.selectedTrip);
  const trip = useTraffic((s) => (s.selectedTrip ? s.trips[s.selectedTrip] : null));
  const job = useTraffic((s) => (s.selectedTrip ? s.rtgJobs[s.selectedTrip] : null));
  const follow = useTraffic((s) => s.follow);
  const setFollow = useTraffic((s) => s.setFollow);
  const selectTrip = useTraffic((s) => s.selectTrip);
  const data = useYardView();

  // Pose truk hidup di luar React; diintip 4x sedetik, cukup untuk teks.
  const [phase, setPhase] = useState<string>('');
  useEffect(() => {
    if (!id) return;
    const t = setInterval(() => setPhase(truckPose(id)?.phase ?? ''), 250);
    return () => clearInterval(t);
  }, [id]);

  if (!id || !trip) return null;
  const c = data?.blocks.flatMap((b) => b.containers).find((x) => x.no === trip.ctrNo);
  const stage = job
    ? job.stage === 'done'
      ? 'RTG done'
      : job.stage === 'working'
        ? job.lifted
          ? 'RTG carrying container'
          : 'RTG picking up'
        : 'waiting for RTG turn'
    : null;

  return (
    <Section title="Selected truck">
      <div className="text-[14px] font-semibold text-slate-50">{trip.truckNo || '(no number)'}</div>
      <div className="text-[11px] text-slate-400">{FLOW_LABEL[trip.flow]}</div>
      <div className="mt-1.5 space-y-0.5 text-[11px]">
        <Row k="Container" v={trip.ctrNo} />
        <Row k="Destination" v={c ? `${c.block} · bay ${c.bay + 1} · row ${c.row + 1} · tier ${c.tier}` : trip.position ? `${trip.position.block} · slot ${trip.position.slot}` : 'unknown yet'} />
        <Row k="Phase" v={(PHASE_LABEL as Record<string, string>)[phase] ?? '—'} />
        {stage && <Row k="RTG" v={stage} />}
        {/* Perjalanan selalu diawali gate in — tanpa itu truknya tidak ada. */}
        <Row k="Events" v={['gate in', trip.handled ? 'handled' : '', trip.leaving ? 'gate out' : ''].filter(Boolean).join(' → ')} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <Chip active={follow} onClick={() => setFollow(!follow)}>
          {follow ? 'Stop following' : 'Follow with camera'}
        </Chip>
        <Chip active={false} onClick={() => selectTrip(null)}>
          Release
        </Chip>
      </div>
    </Section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-slate-400">{k}</span>
      <span className="text-right text-slate-100">{v}</span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[11px] bg-white/[0.06] px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-[17px] font-semibold tabular-nums tracking-tight text-slate-50">{value}</div>
      {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

/** Grafik batang mini: arus masuk di atas garis, keluar di bawah. */
function Bars({ rows }: { rows: { in: number; out: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.in, r.out)));
  return (
    <div className="flex h-10 items-center gap-[2px]">
      {rows.map((r, i) => (
        <div key={i} className="flex h-full w-full flex-col justify-center">
          <div className="flex h-1/2 items-end">
            <div className="w-full rounded-t-[1px] bg-emerald-400/80" style={{ height: `${(r.in / max) * 100}%` }} />
          </div>
          <div className="flex h-1/2 items-start">
            <div className="w-full rounded-b-[1px] bg-sky-400/70" style={{ height: `${(r.out / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Kpi() {
  const source = useYard((s) => s.source);
  const data = useYardView();
  const active = useTraffic((s) => Object.keys(s.trips).length);
  const [kpi, setKpi] = useState<YardKpi | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'depot') return;
    let alive = true;
    const tick = () =>
      fetchKpi()
        .then((k) => alive && (setKpi(k), setErr(null)))
        .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    tick();
    const t = setInterval(tick, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [source]);

  if (source !== 'depot') return null;

  // Okupansi per blok dihitung dari lapangan yang sedang tampil — sudah ada di
  // peramban, tidak perlu ditanya ke server.
  const occ =
    data?.blocks.map((b) => ({ id: b.id, ...blockOccupancy(b) })) ?? [];

  return (
    <div className="px-3.5 pb-3.5 pt-2">
      {(
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="Trucks in yard" value={String(Math.max(active, kpi?.trucksInside ?? 0))} hint={`${active} animated`} />
            <Stat label="Gate today" value={kpi ? `${kpi.gateToday.in} / ${kpi.gateToday.out}` : '—'} hint="in / out" />
            <Stat label="Turnaround" value={kpi?.turnaroundMin != null ? `${kpi.turnaroundMin.toFixed(0)} min` : '—'} hint="gate in → out, 7 days" />
            <Stat label="Dwell time" value={kpi?.dwellDays != null ? `${kpi.dwellDays.toFixed(1)} days` : '—'} hint="departed, 30 days" />
            <Stat label="Yard age" value={kpi?.ageDays != null ? `${kpi.ageDays.toFixed(0)} days` : '—'} hint="current average" />
            <Stat label={`Over ${kpi?.overdueDays ?? 30} days`} value={kpi ? nf(kpi.overdue) : '—'} hint="containers" />
            <Stat label="Open job orders" value={kpi ? nf(kpi.jobsOpen) : '—'} />
            <Stat label="Containers" value={data ? nf(data.meta.totalContainers) : '—'} hint={data ? `${nf(data.meta.totalTeu)} TEU` : undefined} />
          </div>
          {kpi && (
            <>
              <div className="mb-1.5 mt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">Gate flow (24 h)</div>
              <Bars rows={kpi.perHour} />
              <div className="mb-1.5 mt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">7 days</div>
              <Bars rows={kpi.perDay} />
            </>
          )}
          <div className="mb-1.5 mt-3.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">Occupancy by block</div>
          <div className="mt-1 space-y-1">
            {occ.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-[11.5px]">
                <span className="w-5 font-semibold text-slate-200">{o.id}</span>
                <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded ${o.pct >= 90 ? 'bg-amber-400' : 'bg-sky-400/80'}`}
                    style={{ width: `${o.pct}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-slate-400">{o.pct.toFixed(0)}%</span>
                <span className="w-14 text-right tabular-nums text-slate-500" title="Free 20 ft positions">free {nf(o.free)}</span>
              </div>
            ))}
          </div>
          {/* Cacat data ditampilkan, bukan disembunyikan (dulu di menu Data):
              kalau lapangan menggambar lebih sedikit kontainer daripada isi
              database, alasannya harus terbaca di layar. */}
          {(data?.meta.conflicts ?? 0) > 0 && (
            <div className="mt-2 text-[11.5px] leading-relaxed text-amber-400/90">
              {data?.meta.conflicts} containers have overlapping positions in the database and are not drawn.
            </div>
          )}
          {(data?.meta.duplicateNumbers ?? 0) > 0 && (
            <div className="mt-1 text-[11.5px] leading-relaxed text-amber-400/90">
              {data?.meta.duplicateNumbers} container numbers are used by more than one unit.
            </div>
          )}
          {err && <div className="mt-1 text-[10px] text-amber-400/80">{err}</div>}
          {kpi && <div className="mt-1 text-[9px] text-slate-600">updated {new Date(kpi.at).toLocaleTimeString('en-GB')}</div>}
        </>
      )}
    </div>
  );
}

export function LivePanel() {
  const toggleIndicators = useDock((s) => s.toggleIndicators);
  return (
    <Panel className="pointer-events-auto w-[300px] overflow-hidden">
      <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-amber-400/15 text-amber-400" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
            <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
          </svg>
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-slate-50">Indicators</div>
          <div className="text-[11.5px] text-slate-400">Live updates</div>
        </div>
        <button
          type="button"
          onClick={toggleIndicators}
          aria-label="Hide indicators (5)"
          title="Hide · 5"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <LiveStatus />
      <TripCard />
      <Kpi />
    </Panel>
  );
}
