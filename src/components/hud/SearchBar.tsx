'use client';

import { useState } from 'react';
import { useYard } from '@/store/useYard';
import { Panel } from './ui';

/**
 * Cari nomor kontainer lalu terbangkan kamera ke posisinya.
 *
 * Sengaja TIDAK ikut memfilter lapangan: kontainer di sekitarnya tetap
 * terlihat sebagai konteks, dan yang dicari ditandai kotak sorot kuning.
 */
export function SearchBar() {
  const [text, setText] = useState('');
  const [notFound, setNotFound] = useState(false);
  const select = useYard((s) => s.select);

  const run = (raw: string) => {
    const q = raw.trim().toUpperCase();
    setNotFound(false);
    if (!q) {
      select(null);
      return;
    }
    const { data } = useYard.getState();
    for (const b of data?.blocks ?? []) {
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
        onChange={(e) => {
          setText(e.target.value);
          setNotFound(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && run(text)}
        placeholder="Cari nomor kontainer…"
        spellCheck={false}
        className="w-[210px] bg-transparent text-[12px] uppercase tracking-wide text-slate-100 placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none"
      />
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
