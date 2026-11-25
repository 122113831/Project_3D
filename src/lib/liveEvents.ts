/**
 * Kejadian lalu lintas gate yang mengalir ke peramban — dari HiveMQ, dari
 * kiriman HTTP aplikasi lain, atau dari pemutar ulang GATE_HIST.
 *
 * Berkas ini MURNI: tanpa Node, tanpa three, tanpa React. Dipakai server
 * (menormalkan pesan broker) dan peramban (mengurai aliran SSE) dengan bentuk
 * yang persis sama, jadi tidak ada dua definisi yang bisa berselisih.
 */

/**
 * SHIFT = relokasi di dalam blok: RTG memindah kontainer dari slotnya ke
 * `position`, tanpa truk. Wajib membawa posisi tujuan.
 */
export type TripEventKind = 'GATE_IN' | 'HANDLED' | 'GATE_OUT' | 'SHIFT';

/** Posisi di lapangan, seperti kolom YARD_ROWTIER: slot ganjil, row dan tier 1-based. */
export type YardPosition = { block: string; slot: number; row: number; tier: number };

export type LiveEvent = {
  jobNo: string;
  ctrNo: string;
  truckNo: string;
  /** R = bongkar masuk (receiving), D = ambil keluar (delivery). */
  flow: 'R' | 'D';
  kind: TripEventKind;
  /** Nomor gate (GATI_NO / GATO_NO), kalau ada. */
  gateNo?: number | null;
  /** Waktu kejadian menurut sumbernya, ISO. */
  at?: string | null;
  /**
   * Tujuan di lapangan, kalau pesannya membawanya. Tanpa ini peramban bertanya
   * ke database lewat /api/yard/container saat kontainer ditangani.
   */
  position?: YardPosition | null;
  /**
   * Kode alat yang menangani (PRODUCTION_OPERATOR_NEW.KODE_ALAT), mis. RS01 /
   * SL02. Alat bergerak dengan kode ini — atau sejenisnya — yang bekerja;
   * tanpa kode, RTG blok seperti biasa.
   */
  equipment?: string | null;
};

/** Mengambil nilai dari objek dengan beberapa nama kunci, tanpa peduli huruf besar-kecil. */
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  const lower = new Map(Object.keys(o).map((k) => [k.toLowerCase(), o[k]]));
  for (const k of keys) {
    const v = lower.get(k.toLowerCase());
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const KIND_ALIASES: Record<string, TripEventKind> = {
  gate_in: 'GATE_IN',
  gatein: 'GATE_IN',
  gati: 'GATE_IN',
  in: 'GATE_IN',
  handled: 'HANDLED',
  stack: 'HANDLED',
  unstack: 'HANDLED',
  stack_on_yard: 'HANDLED',
  stack_on_trk: 'HANDLED',
  yard: 'HANDLED',
  gate_out: 'GATE_OUT',
  gateout: 'GATE_OUT',
  gato: 'GATE_OUT',
  out: 'GATE_OUT',
  shift: 'SHIFT',
  shifting: 'SHIFT',
  relocate: 'SHIFT',
  relocation: 'SHIFT',
  move: 'SHIFT',
  pindah: 'SHIFT',
};

/**
 * Menormalkan pesan dari bentuk apa pun yang masuk akal menjadi LiveEvent.
 *
 * Dua bentuk didukung sekaligus, karena belum ada kesepakatan format dengan
 * pengirimnya:
 *
 *   1. Pesan RINGKAS: { event: "GATE_IN", jobNo, ctrNo, truckNo, flow, gateNo }
 *   2. Satu baris GATE_HIST apa adanya (kolom huruf besar). Jenis kejadiannya
 *      diturunkan dari kolom waktu yang terisi PALING AKHIR dalam urutan SOP:
 *      GATO_DT → gate out, STACK_ON_YARD / STACK_ON_TRK → ditangani, selain
 *      itu gate in.
 *
 * Mengembalikan null kalau pesan tidak punya nomor kontainer — tanpa itu tidak
 * ada yang bisa digambar.
 */
export function normalizeEvent(raw: unknown): LiveEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const ctrNo = str(pick(o, 'ctrNo', 'ctr_no', 'containerNo', 'container_no'));
  if (!ctrNo) return null;

  const flowRaw = str(pick(o, 'flow', 'receiv_deliv', 'receivDeliv')).toUpperCase();
  const flow: 'R' | 'D' = flowRaw.startsWith('D') ? 'D' : 'R';

  const gateOutAt = pick(o, 'gato_dt', 'gateOutAt', 'gate_out_at');
  const handledAt = pick(o, 'stack_on_yard', 'stack_on_trk', 'handledAt', 'stackedAt');
  const gateInAt = pick(o, 'gati_dt', 'gateInAt', 'gate_in_at');

  const explicit = str(pick(o, 'event', 'kind', 'type', 'stage')).toLowerCase();
  const kind: TripEventKind =
    KIND_ALIASES[explicit] ??
    (gateOutAt ? 'GATE_OUT' : handledAt ? 'HANDLED' : 'GATE_IN');

  const gateNo =
    kind === 'GATE_OUT'
      ? num(pick(o, 'gateNo', 'gato_no', 'gateOutNo'))
      : num(pick(o, 'gateNo', 'gati_no', 'gateInNo'));

  const at = kind === 'GATE_OUT' ? gateOutAt : kind === 'HANDLED' ? handledAt : gateInAt;

  const block = str(pick(o, 'block', 'yard_block', 'yardBlock'));
  const slot = num(pick(o, 'slot', 'yard_slot', 'yardSlot', 'bay'));
  const row = num(pick(o, 'row', 'yard_row', 'yardRow'));
  const tier = num(pick(o, 'tier', 'yard_tier', 'yardTier'));
  const position =
    block && slot !== null && row !== null && tier !== null
      ? { block: block.toUpperCase(), slot, row, tier }
      : null;

  return {
    jobNo: str(pick(o, 'jobNo', 'job_no')),
    ctrNo: ctrNo.toUpperCase(),
    truckNo: str(pick(o, 'truckNo', 'truck_no', 'plate')).toUpperCase(),
    flow,
    kind,
    gateNo,
    at: at ? toIso(at) : null,
    position,
    equipment: str(pick(o, 'equipment', 'kode_alat', 'kodeAlat', 'alat')).toUpperCase() || null,
  };
}

function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export const tripId = (jobNo: string, ctrNo: string) => `${jobNo.trim()}|${ctrNo.trim()}`;
