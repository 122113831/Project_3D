'use client';

import { create } from 'zustand';
import { tripId, type LiveEvent, type TripEventKind, type YardPosition } from '@/lib/liveEvents';
import type { YardBlock, YardContainer } from '@/lib/types';
import { scheduleDay } from '@/lib/dayReplay';
import { fetchGateDay, fetchGateTrips, type GateTrip } from '@/lib/yardApi';
import { useYard } from './useYard';

export { tripId };
export type { TripEventKind };

/**
 * Lalu lintas truk gate: gate in → ditangani di blok → gate out.
 *
 * Store ini hanya mencatat KEJADIAN. Gerak truknya — rute, posisi per frame —
 * hidup di komponen Traffic, karena dihitung dari graf jalan dan isi lapangan
 * yang memang tinggal di sana, dan karena posisi yang berubah 60 kali sedetik
 * tidak boleh memicu render ulang React.
 *
 * `ingest` adalah SATU-SATUNYA pintu masuk. Pemutar ulang GATE_HIST memakainya
 * sekarang; jembatan HiveMQ kelak memakainya juga, dengan bentuk pesan yang
 * sama. Animasinya tidak perlu tahu kejadian itu datang dari mana.
 */

/** Bentuk kejadian yang masuk — sama persis dengan pesan broker. */
export type TripEvent = LiveEvent;

export type Trip = {
  id: string;
  ctrNo: string;
  truckNo: string;
  flow: 'R' | 'D';
  gateInNo: number | null;
  gateOutNo: number | null;
  /** Kontainer sudah ditumpuk (R) atau sudah diangkat ke truk (D). */
  handled: boolean;
  /** Gate out sudah tercatat; truk berangkat begitu urusannya di blok selesai. */
  leaving: boolean;
  /** Tujuan dari pesan, kalau pesannya membawanya. */
  position: YardPosition | null;
  /** Kode alat penanganan dari PRODUCTION_OPERATOR_NEW (RS01, SL02, …); null = RTG. */
  equipment: string | null;
  /** Saat kejadian terakhir diterima — untuk kartu perjalanan. */
  updatedAt: number;
};

export type RtgJob = {
  /** Sama dengan id perjalanannya; untuk relokasi `SHIFT|<nomor>|<waktu>`. */
  id: string;
  blockId: string;
  /** R = truk → tumpukan · D = tumpukan → truk · S = relokasi tumpukan → tumpukan. */
  flow: 'R' | 'D' | 'S';
  /** Kontainer beserta posisinya di tumpukan — sumber (D, S) atau tujuan (R). */
  container: YardContainer;
  /** Relokasi saja: kontainer yang sama di posisi tujuannya. */
  to?: YardContainer;
  /** Pose truk yang menunggu di lajur layanan. */
  truck: { x: number; z: number; ry: number };
  stage: 'queued' | 'working' | 'done';
  /** Alat yang melayani; null = tidak ada RTG di blok itu, dipindahkan tanpa animasi. */
  rtgId: string | null;
  /**
   * Kode alat penanganan dari data (RS01, SL02, …). Bila ada dan tata letak
   * punya alat bergerak, RsWorks yang mengerjakan — bukan RTG.
   */
  equipment?: string | null;
  lifted: boolean;
  placed: boolean;
  queuedAt: number;
};

export type LiveState = {
  state: 'off' | 'connecting' | 'live' | 'reconnecting';
  /** Status broker menurut server. */
  mqtt: string;
  received: number;
  lastAt: string | null;
  error: string | null;
};

export type TrafficDiag = {
  nodes: number;
  edges: number;
  gatesIn: number;
  gatesOut: number;
  unreachable: string[];
  /** Id gate yang tidak menempel pada jalan mana pun. */
  gatesUnlinked: string[];
};

type TrafficState = {
  trips: Record<string, Trip>;
  /** Kecepatan animasi: pengali waktu nyata untuk jalan dan jeda. */
  speed: number;
  showNetwork: boolean;
  replaying: boolean;
  /** Pesan terakhir untuk HUD — gagal rute, kontainer tidak ditemukan, dst. */
  note: string | null;
  diag: TrafficDiag | null;
  /** Jumlah perjalanan yang tidak bisa digambar, beserta alasannya. */
  skipped: Record<string, string>;
  live: LiveState;
  /** Perjalanan yang sedang dipilih (klik truk). */
  selectedTrip: string | null;
  /** Kamera mengikuti truk yang dipilih. */
  follow: boolean;
  /** Kamera mengikuti RTG yang sedang bekerja. */
  followRtg: boolean;
  setFollowRtg: (v: boolean) => void;
  /**
   * Posisi X terakhir tiap RTG setelah selesai bekerja. Tanpa ini RTG yang
   * baru menaruh kontainer di bay 18 melompat kembali ke bay asalnya begitu
   * pekerjaannya selesai.
   */
  rtgPark: Record<string, number>;
  parkRtg: (id: string, x: number) => void;
  /**
   * Relokasi di dalam blok: kontainer dipindah RTG dari slotnya ke slot lain,
   * tanpa truk. Mengembalikan alasan kalau tidak bisa dijalankan.
   */
  shift: (ctrNo: string, to: YardPosition) => string | null;
  setLive: (patch: Partial<LiveState>) => void;
  selectTrip: (id: string | null) => void;
  setFollow: (v: boolean) => void;

  // --- pekerjaan RTG --------------------------------------------------------
  //
  // Satu pekerjaan per perjalanan: memindahkan kontainer antara truk yang
  // sedang menunggu dan slotnya di tumpukan. Fleet MENGANTRIKAN pekerjaan
  // begitu truk sampai dan kejadian "ditangani" sudah diterima; RtgWorks
  // MENGKLAIM lalu menganimasikannya; begitu selesai, Fleet melepas truknya.
  rtgJobs: Record<string, RtgJob>;
  /** Id alat RTG yang sedang bekerja — dikeluarkan dari instancing statis. */
  busyRtg: string[];
  queueJob: (job: RtgJob) => void;
  claimJob: (id: string, rtgId: string | null) => void;
  /** Kontainer sudah terangkat dari sumbernya (truk atau tumpukan). */
  markLifted: (id: string) => void;
  /** Kontainer sudah diletakkan di tujuannya. */
  markPlaced: (id: string) => void;
  finishJob: (id: string) => void;
  dropJob: (id: string) => void;

  ingest: (e: TripEvent) => void;
  /** Kejadian gate (bukan relokasi) — membuat/memperbarui perjalanan truk. */
  ingestTrip: (e: TripEvent) => void;
  /** Dipanggil komponen saat truk sudah keluar dari lapangan. */
  finish: (id: string) => void;
  /** Dipanggil komponen saat perjalanan tidak bisa digambar. */
  skip: (id: string, reason: string) => void;
  setSpeed: (v: number) => void;
  setShowNetwork: (v: boolean) => void;
  setDiag: (d: TrafficDiag) => void;
  replay: (limit: number) => Promise<void>;
  /**
   * Memutar ulang satu tanggal dari GATE_HIST sesuai jam aslinya, dipercepat
   * `scale` kali (60 = satu jam jadi satu menit). Lihat scheduleDay.
   */
  replayDay: (day: string, scale: number) => Promise<void>;
  /** Jam rekaman saat memutar ulang satu hari; null kalau tidak sedang. */
  dayClock: { day: string; real: number; startedAt: number; scale: number; done: number; total: number } | null;
  stop: () => void;
};

/** Timer pemutar ulang, supaya bisa dihentikan di tengah jalan. */
let timers: ReturnType<typeof setTimeout>[] = [];

export const useTraffic = create<TrafficState>((set, get) => ({
  trips: {},
  speed: 2,
  showNetwork: false,
  replaying: false,
  note: null,
  diag: null,
  skipped: {},
  live: { state: 'off', mqtt: 'off', received: 0, lastAt: null, error: null },
  selectedTrip: null,
  follow: false,
  setLive: (patch) => set((s) => ({ live: { ...s.live, ...patch } })),
  selectTrip: (selectedTrip) => set({ selectedTrip, follow: selectedTrip ? get().follow : false }),
  setFollow: (follow) => set({ follow, followRtg: follow ? false : get().followRtg }),
  followRtg: false,
  setFollowRtg: (followRtg) => set({ followRtg, follow: followRtg ? false : get().follow }),
  rtgPark: {},
  parkRtg: (id, x) => set((s) => ({ rtgPark: { ...s.rtgPark, [id]: x } })),

  shift: (ctrNo, to) => {
    const data = useYard.getState().data;
    const key = ctrNo.trim().toUpperCase();
    let found: { block: YardBlock; c: YardContainer } | null = null;
    for (const b of data?.blocks ?? []) {
      const c = b.containers.find((x) => x.no.trim().toUpperCase() === key);
      if (c) found = { block: b, c };
    }
    if (!found) return `${key} is not in the yard`;
    if (found.block.id !== to.block.toUpperCase()) {
      // Antar blok berarti truk (atau ITV) di antaranya — itu perjalanan, bukan relokasi.
      return `relocating ${key} to another block needs a truck — send it as gate/handled`;
    }
    const dest: YardContainer = {
      ...found.c,
      bay: Math.max(0, (to.slot - 1) / 2),
      row: Math.max(0, to.row - 1),
      tier: Math.max(1, to.tier),
    };
    const id = `SHIFT|${key}|${Date.now()}`;
    get().queueJob({
      id,
      blockId: found.block.id,
      flow: 'S',
      container: found.c,
      to: dest,
      truck: { x: 0, z: 0, ry: 0 },
      stage: 'queued',
      rtgId: null,
      lifted: false,
      placed: false,
      queuedAt: Date.now(),
    });
    set({ note: `Relocation ${key}: ${found.block.id}-${found.c.bay * 2 + 1}/${found.c.row + 1}/${found.c.tier} → ${to.slot}/${to.row}/${to.tier}` });
    return null;
  },

  rtgJobs: {},
  busyRtg: [],
  queueJob: (job) =>
    set((s) => (s.rtgJobs[job.id] ? {} : { rtgJobs: { ...s.rtgJobs, [job.id]: job } })),
  claimJob: (id, rtgId) =>
    set((s) => {
      const job = s.rtgJobs[id];
      if (!job || job.stage !== 'queued') return {};
      return {
        rtgJobs: { ...s.rtgJobs, [id]: { ...job, stage: 'working', rtgId } },
        busyRtg: rtgId && !s.busyRtg.includes(rtgId) ? [...s.busyRtg, rtgId] : s.busyRtg,
      };
    }),
  markLifted: (id) =>
    set((s) => (s.rtgJobs[id] ? { rtgJobs: { ...s.rtgJobs, [id]: { ...s.rtgJobs[id], lifted: true } } } : {})),
  markPlaced: (id) =>
    set((s) => (s.rtgJobs[id] ? { rtgJobs: { ...s.rtgJobs, [id]: { ...s.rtgJobs[id], placed: true } } } : {})),
  finishJob: (id) =>
    set((s) => {
      const job = s.rtgJobs[id];
      // Sudah selesai: jangan sentuh daftar RTG sibuk lagi — RTG-nya mungkin
      // sudah dipakai pekerjaan berikutnya.
      if (!job || job.stage === 'done') return {};
      return {
        rtgJobs: { ...s.rtgJobs, [id]: { ...job, stage: 'done', lifted: true, placed: true } },
        busyRtg: s.busyRtg.filter((r) => r !== job.rtgId),
      };
    }),
  dropJob: (id) =>
    set((s) => {
      const job = s.rtgJobs[id];
      if (!job) return {};
      const rtgJobs = { ...s.rtgJobs };
      delete rtgJobs[id];
      return { rtgJobs, busyRtg: s.busyRtg.filter((r) => r !== job.rtgId) };
    }),

  ingest: (e) => {
    // Relokasi tidak punya truk: langsung jadi pekerjaan RTG.
    if (e.kind === 'SHIFT') {
      if (!e.position) {
        set({ note: `Relocation ${e.ctrNo} has no target position — ignored` });
        return;
      }
      const why = get().shift(e.ctrNo, e.position);
      if (why) set({ note: why });
      return;
    }
    get().ingestTrip(e);
  },

  ingestTrip: (e) =>
    set((s) => {
      const id = tripId(e.jobNo, e.ctrNo);
      if (s.skipped[id]) return {};
      const cur = s.trips[id];

      // Kejadian boleh datang tidak berurutan dan boleh datang dua kali — itu
      // sifat biasa aliran pesan. Perjalanan yang belum dikenal tetap dibuat
      // dari kejadian APA PUN: kalau HANDLED datang lebih dulu dari GATE_IN,
      // truknya muncul dan langsung menuju bloknya.
      const trip: Trip = cur ?? {
        id,
        ctrNo: e.ctrNo.trim(),
        truckNo: e.truckNo.trim(),
        flow: e.flow,
        gateInNo: null,
        gateOutNo: null,
        handled: false,
        leaving: false,
        position: null,
        equipment: null,
        updatedAt: Date.now(),
      };
      const next: Trip = { ...trip, updatedAt: Date.now() };
      if (e.position) next.position = e.position;
      if (e.equipment) next.equipment = e.equipment.trim().toUpperCase();
      if (!next.truckNo && e.truckNo) next.truckNo = e.truckNo.trim();
      if (e.kind === 'GATE_IN') next.gateInNo = e.gateNo ?? next.gateInNo;
      if (e.kind === 'HANDLED') next.handled = true;
      if (e.kind === 'GATE_OUT') {
        next.gateOutNo = e.gateNo ?? next.gateOutNo;
        next.leaving = true;
        // Gate out tanpa catatan penanganan masih berarti kontainernya sudah
        // ditangani — truk tidak mungkin keluar membawa muatan yang salah.
        next.handled = true;
      }
      if (
        cur &&
        cur.handled === next.handled &&
        cur.leaving === next.leaving &&
        cur.gateInNo === next.gateInNo &&
        cur.gateOutNo === next.gateOutNo &&
        cur.position === next.position &&
        cur.equipment === next.equipment &&
        cur.truckNo === next.truckNo
      ) {
        return {};
      }
      return { trips: { ...s.trips, [id]: next } };
    }),

  finish: (id) =>
    set((s) => {
      if (!s.trips[id]) return {};
      const trips = { ...s.trips };
      delete trips[id];
      return { trips, selectedTrip: s.selectedTrip === id ? null : s.selectedTrip };
    }),

  skip: (id, reason) =>
    set((s) => {
      const trips = { ...s.trips };
      delete trips[id];
      return { trips, skipped: { ...s.skipped, [id]: reason } };
    }),

  setSpeed: (speed) => set({ speed }),
  setShowNetwork: (showNetwork) => set({ showNetwork }),
  setDiag: (diag) => set({ diag }),

  /**
   * Memutar ulang perjalanan terakhir dari GATE_HIST sebagai aliran kejadian.
   *
   * Ini MQTT tiruan: tiap kejadian dikirim lewat `ingest` pada waktunya, persis
   * seperti pesan broker kelak. Jarak antar-kejadian diambil dari selisih waktu
   * aslinya, dibatasi 2–20 detik dan dibagi kecepatan — selisih di database
   * dev cuma belasan detik, tapi di lapangan sungguhan bisa berjam-jam.
   */
  dayClock: null,
  replayDay: async (day, scale) => {
    get().stop();
    set({ replaying: true, note: `Reading GATE_HIST ${day}…`, skipped: {} });
    let rows: GateTrip[];
    try {
      rows = await fetchGateDay(day);
    } catch (e) {
      set({ replaying: false, note: e instanceof Error ? e.message : String(e) });
      return;
    }
    const plan = scheduleDay(rows, scale);
    if (plan.length === 0) {
      set({ replaying: false, note: `No trips on ${day}.` });
      return;
    }
    const total = plan.length;
    set({
      dayClock: { day, real: plan[0].real, startedAt: performance.now(), scale, done: 0, total },
      note: `Replaying ${day}: ${rows.length} trips, ${scale}× faster.`,
    });
    plan.forEach((p, i) =>
      timers.push(
        setTimeout(() => {
          get().ingest(p.event);
          // Jam rekaman dipaku ke jam asli kejadian ini, lalu berjalan
          // `scale` kali lebih cepat sampai kejadian berikutnya.
          set({ dayClock: { day, real: p.real, startedAt: performance.now(), scale, done: i + 1, total } });
        }, p.at),
      ),
    );
    timers.push(setTimeout(() => set({ replaying: false }), plan[plan.length - 1].at + 1000));
  },

  replay: async (limit) => {
    get().stop();
    set({ replaying: true, note: 'Reading GATE_HIST…', skipped: {} });
    let rows: GateTrip[];
    try {
      rows = await fetchGateTrips(limit);
    } catch (e) {
      set({ replaying: false, note: e instanceof Error ? e.message : String(e) });
      return;
    }
    // Terlama lebih dulu, supaya urutan kedatangannya sama dengan aslinya.
    rows = rows.filter((r) => r.gateIn).reverse();
    if (rows.length === 0) {
      set({ replaying: false, note: 'GATE_HIST contains no trips.' });
      return;
    }

    const speed = get().speed;
    const gap = (a: string | null, b: string | null, fallback: number) => {
      const real = a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : fallback;
      return (Math.max(2, Math.min(20, real || fallback)) * 1000) / speed;
    };
    const after = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    let t = 0;
    for (const r of rows) {
      const base: Omit<TripEvent, 'kind'> = {
        jobNo: r.jobNo,
        ctrNo: r.ctrNo,
        truckNo: r.truckNo,
        flow: r.flow,
        equipment: r.equipment,
      };
      const tIn = t;
      const tHandled = tIn + gap(r.gateIn, r.handled, 8);
      const tOut = tHandled + gap(r.handled, r.gateOut, 8);
      after(tIn, () => get().ingest({ ...base, kind: 'GATE_IN', gateNo: r.gateInNo }));
      if (r.handled || r.gateOut) after(tHandled, () => get().ingest({ ...base, kind: 'HANDLED' }));
      if (r.gateOut) after(tOut, () => get().ingest({ ...base, kind: 'GATE_OUT', gateNo: r.gateOutNo }));
      // Truk berikutnya masuk beberapa detik kemudian, bukan berbarengan.
      t += 6000 / speed;
    }
    after(t, () => set({ replaying: false }));
    set({ note: `Replaying ${rows.length} trips from GATE_HIST.` });
  },

  stop: () => {
    for (const h of timers) clearTimeout(h);
    timers = [];
    set({
      trips: {},
      replaying: false,
      skipped: {},
      selectedTrip: null,
      follow: false,
      followRtg: false,
      rtgPark: {},
      dayClock: null,
      rtgJobs: {},
      busyRtg: [],
    });
  },
}));
