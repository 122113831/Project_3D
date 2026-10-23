'use client';

import { create } from 'zustand';
import { blockedCount } from '@/lib/slots';
import type {
  BlockedCell,
  ColorMode,
  ContainerSize,
  ContainerStatus,
  TypeFilter,
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
  /** Penanda berdenyut di atas kontainer berbahaya, rusak, dan lewat batas dwell. */
  alerts: boolean;
  /** Denah dari atas: kamera tegak lurus, tanpa orbit. */
  view2d: boolean;
  /** Kamera berkeliling pelan — untuk layar monitor ruang kontrol. */
  tour: boolean;
  /** Pencahayaan malam, lampu tiang menyala. */
  night: boolean;
  /** Papan kapasitas di atas tiap blok: persen terisi dan sisa box. */
  blockInfo: boolean;
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
  /**
   * Titik sembarang yang diminta untuk disorot kamera — dipakai panel
   * pemeriksaan tata letak. `span` = lebar daerah yang ingin terlihat, meter.
   */
  focus: { x: number; z: number; span: number; token: number } | null;
  flyTo: (x: number, z: number, span?: number) => void;
  options: ViewOptions;
  perf: PerfSample;

  load: (opts?: { fill?: number; source?: YardSource }) => Promise<void>;
  setColorMode: (m: ColorMode) => void;
  toggleLine: (code: string) => void;
  toggleStatus: (s: ContainerStatus) => void;
  toggleSize: (s: ContainerSize) => void;
  toggleType: (t: TypeFilter) => void;
  resetFilter: () => void;
  select: (c: YardContainer | null, fly?: boolean) => void;
  setOption: <K extends keyof ViewOptions>(key: K, value: ViewOptions[K]) => void;
  setPerf: (p: PerfSample) => void;
  /**
   * Menambal lapangan setempat dari aliran langsung, tanpa memuat ulang
   * semuanya: kontainer yang baru ditumpuk ditambahkan ke bloknya, yang baru
   * diangkat dihapus. Identitas objek `data` dan blok yang disentuh diganti,
   * jadi semua yang di-memo di atasnya ikut terhitung ulang.
   */
  addContainer: (c: YardContainer) => void;
  removeContainer: (no: string) => void;
  /**
   * Mengganti daftar slot terkunci satu blok setelah YARD_ROWTIER diubah,
   * tanpa memuat ulang seluruh lapangan.
   */
  setBlocked: (blockId: string, cells: BlockedCell[]) => void;
};

const toggle = <T,>(arr: T[], v: T): T[] =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

export const useYard = create<YardState>((set, get) => ({
  data: null,
  loading: false,
  error: null,
  fill: 0.68,
  source: 'depot',

  colorMode: 'none',
  filter: EMPTY_FILTER,
  selected: null,
  flyToken: 0,
  focus: null,
  options: {
    shadows: false,
    labels: false,
    adaptive: true,
    detail: true,
    rtg: true,
    lamps: true,
    trucks: true,
    alerts: false,
    view2d: false,
    tour: false,
    night: false,
    blockInfo: true,
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
  flyTo: (x, z, span = 60) =>
    set((s) => ({ focus: { x, z, span, token: (s.focus?.token ?? 0) + 1 } })),

  setOption: (key, value) => set((s) => ({ options: { ...s.options, [key]: value } })),
  setPerf: (perf) => set({ perf }),

  addContainer: (c) =>
    set((s) => {
      if (!s.data) return {};
      const no = c.no.trim().toUpperCase();
      const blocks = s.data.blocks.map((b) => {
        const without = b.containers.filter((x) => x.no.trim().toUpperCase() !== no);
        if (b.id !== c.block) {
          return without.length === b.containers.length ? b : { ...b, containers: without };
        }
        return { ...b, containers: [...without, c] };
      });
      const teu = c.size === 40 ? 2 : 1;
      return {
        data: {
          ...s.data,
          blocks,
          meta: {
            ...s.data.meta,
            totalContainers: s.data.meta.totalContainers + 1,
            totalTeu: s.data.meta.totalTeu + teu,
          },
        },
      };
    }),

  removeContainer: (no) =>
    set((s) => {
      if (!s.data) return {};
      const key = no.trim().toUpperCase();
      let removed: YardContainer | null = null;
      const blocks = s.data.blocks.map((b) => {
        const hit = b.containers.find((x) => x.no.trim().toUpperCase() === key);
        if (!hit) return b;
        removed = hit;
        return { ...b, containers: b.containers.filter((x) => x !== hit) };
      });
      if (!removed) return {};
      const teu = (removed as YardContainer).size === 40 ? 2 : 1;
      return {
        data: {
          ...s.data,
          blocks,
          meta: {
            ...s.data.meta,
            totalContainers: Math.max(0, s.data.meta.totalContainers - 1),
            totalTeu: Math.max(0, s.data.meta.totalTeu - teu),
          },
        },
        selected: s.selected?.no.trim().toUpperCase() === key ? null : s.selected,
      };
    }),

  setBlocked: (blockId, cells) =>
    set((s) => {
      if (!s.data) return {};
      const blocks = s.data.blocks.map((b) => (b.id === blockId ? { ...b, blocked: cells } : b));
      // Kapasitas dihitung ulang dengan rumus yang sama seperti fetchDepotYard.
      const capacityTeu = blocks.reduce(
        (n, b) => n + b.slots * b.rows * b.tiers - blockedCount(b.blocked, b),
        0,
      );
      return {
        data: {
          ...s.data,
          blocks,
          meta: {
            ...s.data.meta,
            capacityTeu,
            fill: capacityTeu > 0 ? s.data.meta.totalTeu / capacityTeu : 0,
          },
        },
      };
    }),
}));

/** Blok tempat kontainer terpilih berada. */
export function findBlock(data: YardData | null, id: string | undefined): YardBlock | null {
  if (!data || !id) return null;
  return data.blocks.find((b) => b.id === id) ?? null;
}
