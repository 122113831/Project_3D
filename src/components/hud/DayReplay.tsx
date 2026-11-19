'use client';

import { useEffect, useState } from 'react';
import { fetchGateDays } from '@/lib/yardApi';
import { useTraffic } from '@/store/useTraffic';
import { Chip, SubLabel } from './ui';

const SCALES = [
  { v: 60, label: '60×', title: '1 jam rekaman = 1 menit' },
  { v: 300, label: '300×', title: '1 jam rekaman = 12 detik' },
  { v: 900, label: '900×', title: '1 jam rekaman = 4 detik' },
];

/** Jam rekaman, berjalan `scale` kali lebih cepat dari kejadian terakhir. */
export function DayClock() {
  const clock = useTraffic((s) => s.dayClock);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!clock) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [clock]);
  if (!clock) return null;
  const now = new Date(clock.real + (performance.now() - clock.startedAt) * clock.scale);
  const hh = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <div className="mt-1 flex items-center justify-between rounded bg-sky-400/10 px-2 py-1 text-[11px] text-sky-100">
      <span>
        Rekaman {clock.day.split('-').reverse().join('-')} · <b className="tabular-nums">{hh}</b>
      </span>
      <span className="tabular-nums text-sky-300/80">
        {clock.done}/{clock.total}
      </span>
    </div>
  );
}

/**
 * Putar ulang satu hari: pilih tanggal (hanya yang punya aktivitas), pilih
 * kecepatan, lalu kejadian hari itu diputar sesuai urutan jamnya.
 */
export function DayReplay() {
  const replayDay = useTraffic((s) => s.replayDay);
  const [days, setDays] = useState<{ day: string; trips: number }[]>([]);
  const [day, setDay] = useState('');
  const [scale, setScale] = useState(300);
  useEffect(() => {
    let alive = true;
    void fetchGateDays().then((d) => {
      if (!alive) return;
      setDays(d);
      if (d[0]) setDay((cur) => cur || d[0].day);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mt-2">
      <SubLabel>Putar ulang hari</SubLabel>
      <div className="flex gap-1">
        <select
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[11px] text-slate-100 outline-none focus:border-sky-400/60"
        >
          {days.length === 0 && <option value="">memuat…</option>}
          {days.map((d) => (
            <option key={d.day} value={d.day}>
              {d.day.split('-').reverse().join('-')} · {d.trips} truk
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!day}
          onClick={() => void replayDay(day, scale)}
          className="rounded border border-sky-300/50 bg-sky-400/15 px-2 text-[11px] text-slate-50 disabled:opacity-40"
        >
          Putar
        </button>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {SCALES.map((s) => (
          <Chip key={s.v} active={scale === s.v} onClick={() => setScale(s.v)} title={s.title}>
            {s.label}
          </Chip>
        ))}
      </div>
      <DayClock />
    </div>
  );
}
