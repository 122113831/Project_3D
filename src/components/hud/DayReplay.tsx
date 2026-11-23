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

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const WEEKDAYS = ['Sn', 'Sl', 'Rb', 'Km', 'Jm', 'Sb', 'Mg'];
const pad = (n: number) => String(n).padStart(2, '0');
const ymKey = (y: number, m: number) => `${y}-${pad(m + 1)}`;

/**
 * Kalender bulanan: hanya hari yang punya aktivitas yang bisa dipilih, dengan
 * jumlah truknya di bawah angka tanggal. Panah pindah bulan berhenti di bulan
 * tertua/terbaru yang punya data.
 */
function DayCalendar({
  days,
  value,
  onChange,
}: {
  days: { day: string; trips: number }[];
  value: string;
  onChange: (day: string) => void;
}) {
  const trips = new Map(days.map((d) => [d.day, d.trips]));
  const months = [...new Set(days.map((d) => d.day.slice(0, 7)))].sort();
  const [view, setView] = useState('');
  const shown = view || (value ? value.slice(0, 7) : months[months.length - 1]) || '';
  if (!shown) return <div className="py-3 text-center text-[11px] text-slate-400">memuat…</div>;

  const [y, m] = shown.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Senin = kolom pertama
  const count = new Date(y, m, 0).getDate();
  const idx = months.indexOf(shown);
  const go = (step: number) => {
    const d = new Date(y, m - 1 + step, 1);
    setView(ymKey(d.getFullYear(), d.getMonth()));
  };
  const max = Math.max(1, ...days.map((d) => d.trips));
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  return (
    <div className="rounded border border-white/10 bg-black/25 p-1.5">
      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-100">
        <button
          type="button"
          aria-label="Bulan sebelumnya"
          disabled={idx === 0 || (idx < 0 && shown < months[0])}
          onClick={() => go(-1)}
          className="rounded px-1.5 hover:bg-white/10 disabled:opacity-30"
        >
          ‹
        </button>
        <b className="font-semibold">
          {MONTHS[m - 1]} {y}
        </b>
        <button
          type="button"
          aria-label="Bulan berikutnya"
          disabled={idx === months.length - 1 || (idx < 0 && shown > months[months.length - 1])}
          onClick={() => go(1)}
          className="rounded px-1.5 hover:bg-white/10 disabled:opacity-30"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[9px] uppercase text-slate-500">
            {w}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`k${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const key = `${shown}-${pad(i + 1)}`;
          const n = trips.get(key);
          const sel = key === value;
          // Makin ramai, makin pekat latarnya.
          const heat = n ? 0.12 + 0.4 * (n / max) : 0;
          return (
            <button
              key={key}
              type="button"
              disabled={!n}
              onClick={() => onChange(key)}
              title={n ? `${key.split('-').reverse().join('-')} · ${n} truk` : 'Tidak ada aktivitas'}
              style={n && !sel ? { backgroundColor: `rgba(56,189,248,${heat})` } : undefined}
              className={`flex h-8 flex-col items-center justify-center rounded leading-none ${
                sel
                  ? 'bg-sky-400 font-semibold text-slate-950'
                  : n
                    ? 'text-slate-50 hover:ring-1 hover:ring-sky-300/70'
                    : 'cursor-default text-slate-600'
              } ${key === todayKey && !sel ? 'ring-1 ring-white/40' : ''}`}
            >
              <span className="text-[11px] tabular-nums">{i + 1}</span>
              {n ? <span className={`text-[8px] tabular-nums ${sel ? 'text-slate-900' : 'text-sky-200/80'}`}>{n}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Putar ulang satu hari: pilih tanggal di kalender (hanya yang punya
 * aktivitas), pilih kecepatan, lalu kejadian hari itu diputar sesuai jamnya.
 */
export function DayReplay() {
  const replayDay = useTraffic((s) => s.replayDay);
  const [days, setDays] = useState<{ day: string; trips: number }[]>([]);
  const [day, setDay] = useState('');
  const [scale, setScale] = useState(300);
  useEffect(() => {
    let alive = true;
    void fetchGateDays(365).then((d) => {
      if (!alive) return;
      setDays(d);
      if (d[0]) setDay((cur) => cur || d[0].day);
    });
    return () => {
      alive = false;
    };
  }, []);
  const trips = days.find((d) => d.day === day)?.trips;

  return (
    <div className="mt-2">
      <SubLabel>Putar ulang hari</SubLabel>
      <DayCalendar days={days} value={day} onChange={setDay} />
      <div className="mt-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">
          {day ? (
            <>
              {day.split('-').reverse().join('-')} · <b className="text-slate-100">{trips ?? 0} truk</b>
            </>
          ) : (
            'Pilih tanggal'
          )}
        </span>
        <button
          type="button"
          disabled={!day}
          onClick={() => void replayDay(day, scale)}
          className="rounded border border-sky-300/50 bg-sky-400/15 px-2 py-0.5 text-[11px] text-slate-50 disabled:opacity-40"
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
