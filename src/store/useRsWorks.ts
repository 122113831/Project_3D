'use client';

import { create } from 'zustand';
import { PITCH } from '@/lib/constants';
import { applyLayout } from '@/lib/layout';
import { planRsFor, rsUnits, type RsJobPlan } from '@/lib/rsPlan';
import { useEditor } from './useEditor';
import { useYard } from './useYard';

/**
 * Pekerjaan reach stacker yang sedang berjalan. Satu RS = paling banyak satu
 * pekerjaan; RS yang sibuk disembunyikan dari gambar diamnya (Equipment) dan
 * digambar bergerak oleh RsWorks.
 */
export type RsJob = RsJobPlan & {
  id: string;
  unitKey: string;
  code: string;
  /** Pose diam RS (parkir), tempatnya kembali. */
  home: { x: number; z: number; ry: number };
  /** Sudut blok yang dikerjakan — arah panjang kontainer di spreader. */
  rot: number;
  startedAt: number;
  /**
   * Stack/unstack truk gate: pekerjaan di useTraffic yang dikerjakan RS ini
   * (menurut KODE_ALAT), bukan relokasi contoh.
   */
  truckJob?: { id: string; flow: 'R' | 'D' };
};

type RsWorksState = {
  jobs: Record<string, RsJob>;
  busy: string[];
  start: (job: RsJob) => void;
  finish: (id: string) => void;
  clear: () => void;
};

export const useRsWorks = create<RsWorksState>((set) => ({
  jobs: {},
  busy: [],
  start: (job) =>
    set((s) =>
      s.busy.includes(job.unitKey) ? {} : { jobs: { ...s.jobs, [job.id]: job }, busy: [...s.busy, job.unitKey] },
    ),
  finish: (id) =>
    set((s) => {
      const job = s.jobs[id];
      if (!job) return {};
      const jobs = { ...s.jobs };
      delete jobs[id];
      return { jobs, busy: s.busy.filter((k) => k !== job.unitKey) };
    }),
  clear: () => set({ jobs: {}, busy: [] }),
}));

/**
 * Contoh kerja RS: RS bebas berikutnya keluar dari parkirnya dan merelokasi
 * satu kontainer di baris tepi blok terdekat yang punya relokasi sah, lalu
 * kembali ke lajurnya. Mengembalikan catatan untuk panel.
 */
export function runRsDemo(): string {
  const layout = useEditor.getState().layout;
  const data = useYard.getState().data;
  if (!data) return 'Yard data not loaded yet.';
  const { busy, jobs, start } = useRsWorks.getState();
  const units = rsUnits(layout?.equipment ?? []);
  if (!units.length) return 'No reach stacker in the layout yet — place an RS parking area (Parking tab) or a standalone RS (Equipment tab).';
  const free = units.filter((u) => !busy.includes(u.key));
  if (!free.length) return `All ${units.length} RS units are busy.`;
  const blocks = applyLayout(data, layout).blocks;
  // Satu blok satu RS, supaya dua RS tidak berebut tumpukan yang sama.
  const taken = new Set(Object.values(jobs).map((j) => j.blockId));
  for (const unit of free) {
    const order = blocks
      .filter((b) => !taken.has(b.id))
      .map((b) => {
        const cx = b.originX + (b.slots * PITCH.teu) / 2;
        const cz = b.originZ + (b.rows * PITCH.row) / 2;
        return { b, d: Math.hypot(cx - unit.x, cz - unit.z) };
      })
      .sort((p, q) => p.d - q.d);
    for (const { b } of order) {
      // Sisi blok, kontainer, dan lintasan dipilih dengan memperhitungkan
      // jalan: RS lewat lorong dalam lapangan, tidak menyusuri jalan keliling.
      const plan = planRsFor(unit, b, blocks, layout?.roads ?? []);
      if (!plan) continue;
      const move = { c: plan.container, to: plan.to };
      start({
        ...plan,
        id: `RS|${unit.key}|${Date.now()}`,
        unitKey: unit.key,
        code: unit.code,
        home: { x: unit.x, z: unit.z, ry: unit.ry },
        rot: b.rot ?? 0,
        startedAt: Date.now(),
      });
      const slot = (c: { bay: number; row: number; tier: number }) => `${c.bay * 2 + 1}/${c.row + 1}/${c.tier}`;
      return `${unit.code} relocating ${move.c.no.trim()}: ${b.id}-${slot(move.c)} → ${b.id}-${slot(move.to)}`;
    }
  }
  return 'No relocation within RS reach (edge row, tier ≤ 4) in any block.';
}
