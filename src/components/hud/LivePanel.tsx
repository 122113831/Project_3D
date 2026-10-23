'use client';

import { useEffect, useState } from 'react';
import { blockOccupancy } from '@/lib/yard';
import { fetchKpi, type YardKpi } from '@/lib/yardApi';
import { truckPose } from '@/components/three/trafficRegistry';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { Chip, nf, Panel, Section } from './ui';

/**
 * Panel operasional di kolom kanan: status aliran langsung, kartu truk yang
 * dipilih, dan indikator KPI.
 *
 * Ketiganya soal "apa yang terjadi SEKARANG", berbeda dari panel kendali di
 * kiri yang soal "bagaimana lapangan ditampilkan". Itu sebabnya mereka
 * berkumpul di sini dan bukan di ControlPanel.
 */

const FLOW_LABEL = { R: 'Bongkar (receiving)', D: 'Ambil (delivery)' } as const;
const PHASE_LABEL = {
  in: 'menuju blok',
  hold: 'menunggu di dalam gerbang',
  wait: 'di bay, menunggu RTG',
  out: 'menuju gate out',
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
      ? 'Aliran langsung tersambung'
      : live.state === 'connecting'
        ? 'Menyambung…'
        : live.state === 'reconnecting'
          ? 'Terputus — menyambung ulang'
          : 'Aliran langsung mati';
  const broker =
    live.mqtt === 'off'
      ? 'broker belum diatur (MQTT_URL) · menerima lewat POST'
      : `broker ${live.mqtt}`;
  return (
    <div className="px-3 py-2 text-[11px]">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${tone} ${live.state === 'live' ? 'animate-pulse' : ''}`} />
        <span className="text-slate-200">{label}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-slate-500">
        {broker} · {live.received} kejadian
      </div>
      {live.error && <div className="mt-0.5 text-[10px] text-amber-400/80">{live.error}</div>}
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
      ? 'RTG selesai'
      : job.stage === 'working'
        ? job.lifted
          ? 'RTG membawa kontainer'
          : 'RTG menjemput'
        : 'menunggu giliran RTG'
    : null;

  return (
    <Section title="Truk terpilih">
      <div className="text-[14px] font-semibold text-slate-50">{trip.truckNo || '(tanpa nomor)'}</div>
      <div className="text-[11px] text-slate-400">{FLOW_LABEL[trip.flow]}</div>
      <div className="mt-1.5 space-y-0.5 text-[11px]">
        <Row k="Kontainer" v={trip.ctrNo} />
        <Row k="Tujuan" v={c ? `${c.block} · bay ${c.bay + 1} · row ${c.row + 1} · tier ${c.tier}` : trip.position ? `${trip.position.block} · slot ${trip.position.slot}` : 'belum diketahui'} />
        <Row k="Fase" v={(PHASE_LABEL as Record<string, string>)[phase] ?? '—'} />
        {stage && <Row k="RTG" v={stage} />}
        {/* Perjalanan selalu diawali gate in — tanpa itu truknya tidak ada. */}
        <Row k="Kejadian" v={['gate in', trip.handled ? 'ditangani' : '', trip.leaving ? 'gate out' : ''].filter(Boolean).join(' → ')} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <Chip active={follow} onClick={() => setFollow(!follow)}>
          {follow ? 'Berhenti mengikuti' : 'Ikuti dengan kamera'}
        </Chip>
        <Chip active={false} onClick={() => selectTrip(null)}>
          Lepas
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
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums text-slate-50">{value}</div>
      {hint && <div className="text-[9px] text-slate-500">{hint}</div>}
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
  const [open, setOpen] = useState(true);

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
    <Section title="Indikator">
      <button type="button" onClick={() => setOpen(!open)} className="mb-1 text-[10px] text-slate-500 hover:text-slate-300">
        {open ? 'sembunyikan' : 'tampilkan'}
      </button>
      {open && (
        <>
          <div className="grid grid-cols-2 gap-1">
            <Stat label="Truk di lapangan" value={String(Math.max(active, kpi?.trucksInside ?? 0))} hint={`${active} dianimasikan`} />
            <Stat label="Gate hari ini" value={kpi ? `${kpi.gateToday.in} / ${kpi.gateToday.out}` : '—'} hint="masuk / keluar" />
            <Stat label="Turnaround" value={kpi?.turnaroundMin != null ? `${kpi.turnaroundMin.toFixed(0)} mnt` : '—'} hint="gate in → out, 7 hari" />
            <Stat label="Dwell time" value={kpi?.dwellDays != null ? `${kpi.dwellDays.toFixed(1)} hari` : '—'} hint="yang keluar, 30 hari" />
            <Stat label="Umur di lapangan" value={kpi?.ageDays != null ? `${kpi.ageDays.toFixed(0)} hari` : '—'} hint="rata-rata sekarang" />
            <Stat label={`Lewat ${kpi?.overdueDays ?? 30} hari`} value={kpi ? nf(kpi.overdue) : '—'} hint="kontainer" />
            <Stat label="Job order terbuka" value={kpi ? nf(kpi.jobsOpen) : '—'} />
            <Stat label="Kontainer" value={data ? nf(data.meta.totalContainers) : '—'} hint={data ? `${nf(data.meta.totalTeu)} TEU` : undefined} />
          </div>
          {kpi && (
            <>
              <div className="mt-2 text-[9px] uppercase tracking-[0.12em] text-slate-500">Arus gerbang 24 jam</div>
              <Bars rows={kpi.perHour} />
              <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-slate-500">7 hari</div>
              <Bars rows={kpi.perDay} />
            </>
          )}
          <div className="mt-2 text-[9px] uppercase tracking-[0.12em] text-slate-500">Okupansi per blok</div>
          <div className="mt-1 space-y-1">
            {occ.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-[10px]">
                <span className="w-5 font-semibold text-slate-200">{o.id}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-white/10">
                  <div
                    className={`h-full rounded ${o.pct >= 90 ? 'bg-amber-400' : 'bg-sky-400/80'}`}
                    style={{ width: `${o.pct}%` }}
                  />
                </div>
                <span className="w-8 text-right tabular-nums text-slate-400">{o.pct.toFixed(0)}%</span>
                <span className="w-14 text-right tabular-nums text-slate-500" title="Sisa posisi 20ft">sisa {nf(o.free)}</span>
              </div>
            ))}
          </div>
          {err && <div className="mt-1 text-[10px] text-amber-400/80">{err}</div>}
          {kpi && <div className="mt-1 text-[9px] text-slate-600">diperbarui {new Date(kpi.at).toLocaleTimeString('id-ID')}</div>}
        </>
      )}
    </Section>
  );
}

export function LivePanel() {
  return (
    <Panel className="pointer-events-auto w-[248px] overflow-hidden">
      <LiveStatus />
      <TripCard />
      <Kpi />
    </Panel>
  );
}
