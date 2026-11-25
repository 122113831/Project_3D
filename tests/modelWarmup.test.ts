import { describe, expect, it } from 'vitest';
import { isWarming, trackCompile } from '@/lib/modelWarmup';

describe('modelWarmup.isWarming', () => {
  it('true selama kompilasi shader latar belakang berjalan, false sesudahnya', async () => {
    expect(isWarming()).toBe(false);
    let done!: () => void;
    const p = trackCompile(new Promise<void>((r) => (done = r)));
    expect(isWarming()).toBe(true);
    done();
    await p;
    expect(isWarming()).toBe(false);
  });

  it('kompilasi yang gagal tetap dilepas dari hitungan', async () => {
    await trackCompile(Promise.reject(new Error('x'))).catch(() => undefined);
    expect(isWarming()).toBe(false);
  });
});
