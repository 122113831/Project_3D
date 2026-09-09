'use client';

import { create } from 'zustand';
import type {
  ColorMode,
  ContainerSize,
  ContainerStatus,
  ContainerType,
  YardSource,
  YardBlock,
  YardContainer,
  YardData,
  YardFilter,
} from '@/lib/types';

export type PerfSample = {
  fps: number;
  /**
   * Lama satu frame, dalam milidetik.
   *
   * Angka ini yang menjawab "berat atau tidak", bukan FPS. Dengan
   * frameloop="demand" frame cuma dirender saat ada yang berubah, jadi FPS
   * rendah bisa berarti dua hal yang sangat berbeda: frame-nya lambat, atau
   * memang tidak ada yang perlu digambar. Jeda antar frame yang lebih dari
   * 100 ms dianggap diam dan tidak ikut dihitung.
   */
  frameMs: number;
  calls: number;
  triangles: number;
  programs: number;
  /** Nama GPU dari WEBGL_debug_renderer_info; menandai render perangkat lunak. */
  renderer: string;
  /** Device pixel ratio yang sedang dipakai — turun sendiri kalau frame berat. */
  dpr: number;
};

export type ViewOptions = {
  /** Shadow map dimatikan secara default — lihat README bagian performa. */
  shadows: boolean;
  /** Nomor kontainer tier teratas di sekitar kamera */
  labels: boolean;
  /** Turunkan resolusi render otomatis supaya frame tetap di anggaran 60 fps. */
  adaptive: boolean;
  /** Model GLB kontainer untuk blok di dekat kamera (lihat lodRegistry). */
  detail: boolean;
  rtg: boolean;
  lamps: boolean;
  trucks: boolean;
};

const EMPTY_FILTER: YardFilter = { lines: [], statuses: [], sizes: [], types: [] };

type YardState = {
  data: YardData | null;
  loading: boolean;
  error: string | null;
  fill: number;
  /** Sumber yang diminta. Bisa beda dari data.meta.source saat masih memuat. */
  source: YardSource;

  colorMode: ColorMode;
  filter: YardFilter;
  selected: YardContainer | null;
  /** Naik setiap kali user minta kamera terbang ke kontainer terpilih. */
  flyToken: number;
  options: ViewOptions;
  perf: PerfSample;

  load: (opts?: { fill?: number; source?: YardSource }) => Promise<void>;
  setColorMode: (m: ColorMode) => void;
  toggleLine: (code: string) => void;
  toggleStatus: (s: ContainerStatus) => void;
  toggleSize: (s: ContainerSize) => void;
  toggleType: (t: ContainerType) => void;
  resetFilter: () => void;
  select: (c: YardContainer | null, fly?: boolean) => void;
  setOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;
  setPerf: (p: PerfSample) => void;
};

const toggle = <T,>(arr: T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export const useYard = create<YardState>((set, get) => ({
  data: null,
  loading: false,
  error: null,
  fill: 0.68,
  source: 'depot',

  colorMode: 'line',
  filter: EMPTY_FILTER,
  selected: null,
  flyToken: 0,
  options: {
    shadows: false,
    labels: false,
    adaptive: true,
    detail: true,
    rtg: true,
    lamps: true,
    trucks: true,
  },
  perf: { fps: 0, frameMs: 0, calls: 0, triangles: 0, programs: 0, renderer: '', dpr: 0 },

  async load(opts) {
    const fill = opts?.fill ?? get().fill;
    const source = opts?.source ?? get().source;
    set({ loading: true, error: null, fill, source, selected: null });
    try {
      const url =
        source === 'demo' ? `/api/yard?source=demo&fill=${fill.toFixed(2)}` : '/api/yard';
      const res = await fetch(url, { cache: 'no-store' });
      const body = await res.json();
      // Route mengirim { error } pada 503 — pesannya jauh lebih berguna
      // daripada sekadar kode status.
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      set({ data: body as YardData, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false, data: null });
    }
  },

  setColorMode: (colorMode) => set({ colorMode }),
  toggleLine: (code) =>
    set((s) => ({ filter: { ...s.filter, lines: toggle(s.filter.lines, code) } })),
  toggleStatus: (v) =>
    set((s) => ({ filter: { ...s.filter, statuses: toggle(s.filter.statuses, v) } })),
  toggleSize: (v) =>
    set((s) => ({ filter: { ...s.filter, sizes: toggle(s.filter.sizes, v) } })),
  toggleType: (v) =>
    set((s) => ({ filter: { ...s.filter, types: toggle(s.filter.types, v) } })),
  resetFilter: () => set({ filter: EMPTY_FILTER }),

  select: (c, fly = false) =>
    set((s) => ({ selected: c, flyToken: fly ? s.flyToken + 1 : s.flyToken })),

  setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),
  setPerf: (perf) => set({ perf }),
}));

/** Blok tempat kontainer terpilih berada. */
export function findBlock(data: YardData | null, id: string | undefined): YardBlock | null {
  if (!data || !id) return null;
  return data.blocks.find((b) => b.id === id) ?? null;
}
