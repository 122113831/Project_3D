'use client';

import { create } from 'zustand';
import type { DockTab } from '@/lib/dock';

/**
 * Keadaan dok menu bawah: panel kiri mana yang terbuka (atau tidak ada), dan
 * apakah kolom indikator di kanan tampil. `last` menyimpan menu terakhir
 * supaya isinya tetap tergambar selama animasi tutup.
 */
type DockState = {
  tab: DockTab | null;
  last: DockTab;
  indicators: boolean;
  toggleTab: (t: DockTab) => void;
  closeTab: () => void;
  toggleIndicators: () => void;
  /** Palet perintah (Ctrl K) dan daftar pintasan. */
  palette: boolean;
  shortcuts: boolean;
  setPalette: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
};

export const useDock = create<DockState>((set) => ({
  tab: null,
  last: 'color',
  indicators: true,
  toggleTab: (t) => set((s) => (s.tab === t ? { tab: null } : { tab: t, last: t })),
  closeTab: () => set({ tab: null }),
  toggleIndicators: () => set((s) => ({ indicators: !s.indicators })),
  palette: false,
  shortcuts: false,
  setPalette: (palette) => set({ palette }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
}));
