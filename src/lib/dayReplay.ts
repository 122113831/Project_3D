import type { LiveEvent } from './liveEvents';

/**
 * Jadwal putar ulang satu hari: setiap kejadian gate in, ditangani, dan gate
 * out mendapat waktu putar sesuai jam aslinya, dipercepat `scale` kali.
 *
 * Jeda kosong yang panjang (tengah malam, istirahat) dipadatkan menjadi
 * paling lama `maxIdleMin` menit waktu asli — tanpa itu menonton satu hari
 * berarti menunggu lama tanpa ada yang bergerak. Jam rekaman yang ditampilkan
 * tetap jam ASLI tiap kejadian, jadi yang dilihat tidak menipu soal kapan
 * kejadiannya terjadi.
 */

export type DayTrip = {
  jobNo: string;
  ctrNo: string;
  truckNo: string;
  flow: 'R' | 'D';
  gateInNo: number | null;
  gateOutNo: number | null;
  gateIn: string | null;
  handled: string | null;
  gateOut: string | null;
};

export type Scheduled = { at: number; real: number; event: LiveEvent };

export function scheduleDay(trips: readonly DayTrip[], scale: number, maxIdleMin = 20): Scheduled[] {
  const raw: { real: number; event: LiveEvent }[] = [];
  for (const t of trips) {
    const base = { jobNo: t.jobNo, ctrNo: t.ctrNo, truckNo: t.truckNo, flow: t.flow };
    const push = (iso: string | null, event: LiveEvent) => {
      const real = iso ? Date.parse(iso) : NaN;
      if (Number.isFinite(real)) raw.push({ real, event });
    };
    push(t.gateIn, { ...base, kind: 'GATE_IN', gateNo: t.gateInNo, at: t.gateIn });
    push(t.handled, { ...base, kind: 'HANDLED', at: t.handled });
    push(t.gateOut, { ...base, kind: 'GATE_OUT', gateNo: t.gateOutNo, at: t.gateOut });
  }
  raw.sort((a, b) => a.real - b.real);

  const k = Math.max(1, scale);
  const maxIdle = maxIdleMin * 60_000;
  const out: Scheduled[] = [];
  let at = 0;
  for (let i = 0; i < raw.length; i++) {
    if (i > 0) at += Math.min(maxIdle, raw[i].real - raw[i - 1].real) / k;
    out.push({ at, real: raw[i].real, event: raw[i].event });
  }
  return out;
}
