import { describe, expect, it } from 'vitest';
import { normalizeEvent, tripId } from '@/lib/liveEvents';

describe('normalizeEvent — bentuk pesan broker', () => {
  it('pesan ringkas dengan event eksplisit', () => {
    const e = normalizeEvent({ event: 'gate_in', jobNo: '26003277', ctrNo: 'pask3928749', truckNo: 'bk0394kk', flow: 'R', gateNo: 1 });
    expect(e).toMatchObject({ kind: 'GATE_IN', ctrNo: 'PASK3928749', truckNo: 'BK0394KK', flow: 'R', gateNo: 1 });
  });

  it('baris GATE_HIST: jenis kejadian dari kolom waktu yang terisi paling akhir', () => {
    const base = { JOB_NO: '1', CTR_NO: 'ABCU1234567', TRUCK_NO: 'B 1', RECEIV_DELIV: 'R', GATI_NO: 1, GATO_NO: 2 };
    expect(normalizeEvent({ ...base, GATI_DT: '2026-10-21T08:00:00Z' })!.kind).toBe('GATE_IN');
    expect(normalizeEvent({ ...base, GATI_DT: '2026-10-21T08:00:00Z', STACK_ON_YARD: '2026-10-21T08:05:00Z' })!.kind).toBe('HANDLED');
    const out = normalizeEvent({ ...base, GATI_DT: '2026-10-21T08:00:00Z', STACK_ON_YARD: '2026-10-21T08:05:00Z', GATO_DT: '2026-10-21T08:09:00Z' })!;
    expect(out.kind).toBe('GATE_OUT');
    // Nomor gate mengikuti jenis kejadiannya: gate out memakai GATO_NO.
    expect(out.gateNo).toBe(2);
    expect(out.at).toBe('2026-10-21T08:09:00.000Z');
  });

  it('delivery: STACK_ON_TRK juga berarti ditangani', () => {
    const e = normalizeEvent({ CTR_NO: 'ABCU1234567', RECEIV_DELIV: 'D', GATI_DT: '2026-10-21T08:00:00Z', STACK_ON_TRK: '2026-10-21T08:03:00Z' })!;
    expect(e.flow).toBe('D');
    expect(e.kind).toBe('HANDLED');
  });

  it('posisi ikut terbawa kalau lengkap, diabaikan kalau tidak', () => {
    const ok = normalizeEvent({ ctrNo: 'X', yard_block: 'd', yard_slot: 45, yard_row: 1, yard_tier: 2 })!;
    expect(ok.position).toEqual({ block: 'D', slot: 45, row: 1, tier: 2 });
    const no = normalizeEvent({ ctrNo: 'X', yard_block: 'D', yard_slot: 45 })!;
    expect(no.position).toBeNull();
  });

  it('tanpa nomor kontainer tidak ada kejadian', () => {
    expect(normalizeEvent({ jobNo: '1', truckNo: 'B 1' })).toBeNull();
    expect(normalizeEvent(null)).toBeNull();
    expect(normalizeEvent('teks')).toBeNull();
  });

  it('tripId stabil terhadap spasi', () => {
    expect(tripId(' 26003277 ', 'PASK3928749  ')).toBe('26003277|PASK3928749');
  });
});
