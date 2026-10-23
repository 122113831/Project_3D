'use client';

import { useMemo, useState } from 'react';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { Panel } from './ui';

/**
 * Cari nomor kontainer, nomor truk, atau nomor job.
 *
 * Kontainer: kamera terbang ke posisinya dan layar inspeksi terbuka. Truk atau
 * job yang sedang berjalan di lapangan: truknya dipilih dan kamera mengikutinya.
 *
 * Sengaja TIDAK ikut memfilter lapangan: kontainer di sekitarnya tetap
 * terlihat sebagai konteks, dan yang dicari ditandai kotak sorot kuning.
 *
 * Saran otomatis (datalist) diisi dari nomor yang memang ada — kontainer di
 * lapangan dan truk yang sedang bergerak — jadi mengetik tiga huruf sudah
 * cukup untuk menemukan nomor lengkapnya.
 */
export function SearchBar() {
  const [text, setText] = useState('');
  const [notFound, setNotFound] = useState(false);
  const select = useYard((s) => s.select);
  const data = useYard((s) => s.data);
  const trips = useTraffic((s) => s.trips);

  const suggestions = useMemo(() => {
    const out = new Set<string>();
    for (const t of Object.values(trips)) {
      if (t.truckNo) out.add(t.truckNo);
    }
    for (const b of data?.blocks ?? []) for (const c of b.containers) out.add(c.no);
    return [...out].slice(0, 2000);
  }, [data, trips]);

  const run = (raw: string) => {
    const q = raw.trim().toUpperCase().replace(/\s+/g, '');
    setNotFound(false);
    if (!q) {
      select(null);
      return;
    }
    // Truk atau job yang sedang berjalan lebih dulu: nomornya pendek dan mudah
    // kebetulan menjadi bagian dari nomor kontainer.
    const { trips: live, selectTrip, setFollow } = useTraffic.getState();
    const trip = Object.values(live).find(
      (t) => t.truckNo.replace(/\s+/g, '').toUpperCase() === q || t.id.split('|')[0] === q,
    );
    if (trip) {
      selectTrip(trip.id);
      setFollow(true);
      return;
    }
    const { data: yard } = useYard.getState();
    for (const b of yard?.blocks ?? []) {
      const hit = b.containers.find((c) => c.no.includes(q));
      if (hit) {
        select(hit, true);
        return;
      }
    }
    setNotFound(true);
  };

  return (
    <Panel className="pointer-events-auto flex items-center gap-2 px-3 py-2">
      <input
        value={text}
        list="yard-search-suggest"
        onChange={(e) => {
          setText(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && run(text)}
        placeholder="Cari kontainer, truk, atau job…"
        spellCheck={false}
        className="w-[230px] bg-transparent text-[12px] uppercase tracking-wide text-slate-100 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none"
      />
      <datalist id="yard-search-suggest">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => run(text)}
        className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-300/60 hover:text-white"
      >
        Cari
      </button>
      {notFound && <span className="text-[11px] text-amber-300">tidak ada</span>}
    </Panel>
  );
}
