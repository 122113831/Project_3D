import { create } from 'zustand';
import { FALLBACK_LIVERIES, makeResolver, type LiveryResolver, type LiverySet } from '@/lib/livery';

type LiveryState = {
  set: LiverySet;
  resolve: LiveryResolver;
  /** true setelah master dari server diterima (atau gagal dan tetap bawaan). */
  loaded: boolean;
  load: () => Promise<void>;
};

let inflight: Promise<void> | null = null;

/**
 * Master livery di klien. Dimuat sekali per sesi; sebelum datang, set bawaan
 * dipakai — isinya sama dengan data awal master, jadi tidak ada lompatan
 * tampilan yang berarti saat master tiba.
 */
export const useLivery = create<LiveryState>((set) => ({
  set: FALLBACK_LIVERIES,
  resolve: makeResolver(FALLBACK_LIVERIES),
  loaded: false,
  load: () => {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const res = await fetch('/api/yard/livery', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LiverySet;
        set({ set: data, resolve: makeResolver(data), loaded: true });
      } catch (e) {
        console.warn('[livery] master tidak termuat, pakai bawaan:', e);
        set({ loaded: true });
      }
    })();
    return inflight;
  },
}));
