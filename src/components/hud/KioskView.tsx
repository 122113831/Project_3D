'use client';

import { useEffect, useState } from 'react';
import { PITCH } from '@/lib/constants';
import { blockOccupancy } from '@/lib/yard';
import { fetchKpi, type YardKpi } from '@/lib/yardApi';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { DayClock } from './DayReplay';
import { nf } from './ui';

/** Lama kamera menetap di satu blok sebelum terbang ke blok berikutnya. */
const DWELL_MS = 25_000;

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="hud-panel min-w-[150px] flex-1 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className={`mt-1 text-[34px] font-semibold leading-none tabular-nums ${tone ?? 'text-slate-50'}`}>{value}</div>
      {hint && <div className="mt-1 text-[12px] text-slate-400">{hint}</div>}
    </div>
  );
}

/**
 * Mode layar monitor: untuk TV di ruang kontrol atau lobi.
 *
 * Panel kendali disembunyikan; yang tersisa jam besar, KPI yang terbaca dari
 * seberang ruangan, dan okupansi tiap blok. Kamera berkeliling pelan (lihat
 * CameraRig) dan tiap 25 detik terbang melengkung ke blok berikutnya.
 * Truk dan RTG tetap bergerak mengikuti kejadian langsung.
 *
 * Keluar dengan Esc atau tombol kecil di pojok. Bisa dibuka langsung dengan
 * ?kiosk=1 di alamat halaman.
 */
export function KioskView() {
  const data = useYardView();
  const setOption = useYard((s) => s.setOption);
  const flyTo = useYard((s) => s.flyTo);
  const trips = useTraffic((s) => Object.keys(s.trips).length);
  const [kpi, setKpi] = useState<YardKpi | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // KPI tiap menit — angka yang sama dengan panel Indikator.
  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetchKpi()
        .then((k) => alive && setKpi(k))
        .catch(() => {});
    void pull();
    const t = setInterval(pull, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Berpindah blok: kamera terbang melengkung ke pusat blok berikutnya.
  const blocks = data?.blocks ?? [];
  useEffect(() => {
    if (blocks.length === 0) return;
    const b = blocks[focus % blocks.length];
    const length = b.slots * PITCH.teu;
    const width = b.rows * PITCH.row;
    flyTo(b.originX + length / 2, b.originZ + width / 2, length * 0.9);
    const t = setTimeout(() => setFocus((f) => f + 1), DWELL_MS);
    return () => clearTimeout(t);
    // blocks.length, bukan blocks: tambalan isi lapangan dari truk tidak boleh
    // mereset giliran blok.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, blocks.length, flyTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOption('kiosk', false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOption]);

  const occ = blocks.map((b) => ({ id: b.id, ...blockOccupancy(b) }));
  const current = blocks.length ? blocks[focus % blocks.length].id : null;
  const capacity = data?.meta.capacityTeu ?? 0;
  const pct = capacity ? ((data?.meta.totalTeu ?? 0) / capacity) * 100 : 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col justify-between p-6">
      <div className="flex items-start justify-between">
        <div className="hud-panel px-5 py-3">
          <div className="text-[13px] uppercase tracking-[0.3em] text-sky-300">Container Yard 3D</div>
          <div className="mt-1 text-[44px] font-semibold leading-none tabular-nums text-white">
            {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="mt-1 text-[14px] text-slate-300">
            {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          <div className="pointer-events-auto">
            <DayClock />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOption('kiosk', false)}
          className="hud-panel pointer-events-auto px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-100"
        >
          Exit (Esc)
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <Tile label="Containers" value={nf(data?.meta.totalContainers ?? 0)} hint={`${nf(data?.meta.totalTeu ?? 0)} TEU`} />
          <Tile
            label="Occupancy"
            value={`${pct.toFixed(0)}%`}
            hint={`of ${nf(capacity)} slots`}
            tone={pct >= 90 ? 'text-red-300' : pct >= 80 ? 'text-amber-300' : undefined}
          />
          <Tile label="Trucks in yard" value={String(Math.max(trips, kpi?.trucksInside ?? 0))} hint={`${trips} animated`} />
          <Tile label="Gate today" value={kpi ? `${kpi.gateToday.in} / ${kpi.gateToday.out}` : '—'} hint="in / out" />
          <Tile
            label="Turnaround"
            value={kpi?.turnaroundMin != null ? `${kpi.turnaroundMin.toFixed(0)} min` : '—'}
            hint="gate in → out, 7 days"
          />
          <Tile
            label={`Over ${kpi?.overdueDays ?? 30} days`}
            value={kpi ? nf(kpi.overdue) : '—'}
            hint="containers"
            tone={kpi && kpi.overdue > 0 ? 'text-amber-300' : undefined}
          />
        </div>
        <div className="hud-panel flex flex-wrap gap-x-6 gap-y-2 px-4 py-3">
          {occ.map((o) => (
            <div key={o.id} className={`flex min-w-[200px] flex-1 items-center gap-2 ${o.id === current ? 'text-white' : 'text-slate-300'}`}>
              <span className={`w-8 text-[18px] font-bold ${o.id === current ? 'text-sky-300' : ''}`}>{o.id}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded bg-white/10">
                <div
                  className={`h-full rounded ${o.pct >= 95 ? 'bg-red-400' : o.pct >= 80 ? 'bg-amber-400' : 'bg-sky-400'}`}
                  style={{ width: `${o.pct}%` }}
                />
              </div>
              <span className="w-12 text-right text-[16px] tabular-nums">{o.pct.toFixed(0)}%</span>
              <span className="w-24 text-right text-[12px] tabular-nums text-slate-400">free {nf(o.free)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
