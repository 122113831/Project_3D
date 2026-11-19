import { describe, expect, it } from 'vitest';
import type { YardContainer } from '@/lib/types';
import { useTraffic, type RtgJob } from '@/store/useTraffic';

const c = { no: 'X' } as YardContainer;
const job = (id: string): RtgJob => ({
  id,
  blockId: 'D',
  flow: 'S',
  container: c,
  truck: { x: 0, z: 0, ry: 0 },
  stage: 'queued',
  rtgId: null,
  lifted: false,
  placed: false,
  queuedAt: 0,
});

describe('antrean RTG', () => {
  it('finishJob kedua kali tidak mencoret RTG yang sudah dipakai pekerjaan berikutnya', () => {
    const t = useTraffic.getState();
    t.stop();
    t.queueJob(job('a'));
    t.queueJob(job('b'));
    t.claimJob('a', 'rtg-D');
    expect(useTraffic.getState().busyRtg).toEqual(['rtg-D']);

    t.finishJob('a');
    expect(useTraffic.getState().busyRtg).toEqual([]);

    // Pekerjaan berikutnya memakai RTG yang sama…
    t.claimJob('b', 'rtg-D');
    expect(useTraffic.getState().busyRtg).toEqual(['rtg-D']);

    // …lalu panggilan finishJob yang terlambat untuk pekerjaan lama tidak
    // boleh membebaskannya (dulu terjadi tiap frame → RTG tergambar dua).
    t.finishJob('a');
    expect(useTraffic.getState().busyRtg).toEqual(['rtg-D']);
    expect(useTraffic.getState().rtgJobs.b.stage).toBe('working');
  });
});
