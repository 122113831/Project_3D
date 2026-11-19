import { describe, expect, it } from 'vitest';
import { scheduleDay, type DayTrip } from '@/lib/dayReplay';

const trip = (no: string, gin: string, handled: string | null, gout: string | null): DayTrip => ({
  jobNo: 'J' + no,
  ctrNo: no,
  truckNo: 'B 1',
  flow: 'R',
  gateInNo: 1,
  gateOutNo: 1,
  gateIn: gin,
  handled,
  gateOut: gout,
});

describe('scheduleDay', () => {
  it('urut jam asli dan dipercepat', () => {
    const plan = scheduleDay(
      [
        trip('B', '2026-11-03T09:00:00Z', '2026-11-03T09:10:00Z', '2026-11-03T09:20:00Z'),
        trip('A', '2026-11-03T08:00:00Z', null, null),
      ],
      60,
    );
    expect(plan.map((p) => `${p.event.ctrNo}:${p.event.kind}`)).toEqual([
      'A:GATE_IN',
      'B:GATE_IN',
      'B:HANDLED',
      'B:GATE_OUT',
    ]);
    expect(plan[0].at).toBe(0);
    // Jeda 08:00 → 09:00 dipadatkan ke 20 menit, lalu dibagi 60: 20 detik.
    expect(plan[1].at).toBe(20_000);
    // 10 menit asli / 60 = 10 detik.
    expect(plan[2].at - plan[1].at).toBe(10_000);
    // Jam rekaman tetap jam asli kejadian.
    expect(new Date(plan[1].real).toISOString()).toBe('2026-11-03T09:00:00.000Z');
  });

  it('hari kosong menghasilkan jadwal kosong', () => {
    expect(scheduleDay([], 60)).toEqual([]);
  });
});
