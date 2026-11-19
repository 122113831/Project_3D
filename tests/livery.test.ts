import { describe, expect, it } from 'vitest';
import { FALLBACK_LIVERIES, makeResolver, type LiverySet } from '@/lib/livery';

const ctr = (no: string, line = 'RCL', status = 'empty', type = 'gp') => ({ no, line, status, type });

describe('pemilihan livery', () => {
  const resolve = makeResolver(FALLBACK_LIVERIES);

  it('prefix menentukan pemilik, apa pun agennya', () => {
    expect(resolve(ctr('MRTU1234567', 'RCL'))?.code).toBe('MERATUS_GP');
    expect(resolve(ctr('MSKU1234542', 'MRT'))?.code).toBe('MAERSK_GP');
  });

  it('prefix yang sama bisa beda tampilan per jenis: tank Seaco vs GP Seaco', () => {
    expect(resolve(ctr('SEGU8081862', 'RCL', 'empty', 'tank'))?.code).toBe('SEACO_TANK');
    expect(resolve(ctr('SEGU8081862', 'RCL', 'empty', 'tank'))?.model).toBe('TANK');
    expect(resolve(ctr('SEGU2706649'))?.code).toBe('SEACO_GP');
    expect(resolve(ctr('SEGU9342615', 'RCL', 'reefer'))?.code).toBe('SEACO_REEFER');
    // Tank bermerek lain juga punya livery tank sendiri.
    expect(resolve(ctr('MSKU1234542', 'RCL', 'empty', 'tank'))?.code).toBe('MAERSK_TANK');
    // Tank tanpa aturan TANK tidak mendapat livery (renderer memakai aset lama).
    expect(resolve(ctr('DEMU0000009', 'RCL', 'empty', 'tank'))).toBeNull();
  });

  it('data dummy jatuh ke default per jenis', () => {
    expect(resolve(ctr('DEMU0000007'))?.code).toBe('GENERIC_GP');
    expect(resolve(ctr('DEMU0000006', 'RCL', 'reefer'))?.code).toBe('GENERIC_REEFER');
    // Reefer bermerek punya livery sendiri (badan putih, logo merek).
    expect(resolve(ctr('MSKU1234542', 'RCL', 'reefer'))?.code).toBe('MAERSK_REEFER');
    expect(resolve(ctr('RCLU1234567', 'RCL', 'reefer'))?.code).toBe('RCL_REEFER');
    expect(resolve(ctr('MSKU1234542'))?.code).toBe('MAERSK_GP');
  });

  it('urutan: prefix+jenis > prefix ANY > agen > default; prioritas kecil menang', () => {
    const set: LiverySet = {
      source: 'db',
      liveries: FALLBACK_LIVERIES.liveries,
      rules: [
        ...FALLBACK_LIVERIES.rules,
        { type: 'AGENT', value: 'MRT', kind: 'ANY', livery: 'MERATUS_GP', priority: 50 },
        { type: 'PREFIX', value: 'TCLU', kind: 'ANY', livery: 'GENERIC_GP', priority: 20 },
        { type: 'PREFIX', value: 'TCLU', kind: 'ANY', livery: 'MAERSK_GP', priority: 10 },
      ],
    };
    const r = makeResolver(set);
    expect(r(ctr('DEMU0000001', 'MRT'))?.code).toBe('MERATUS_GP');
    expect(r(ctr('MSKU0000001', 'MRT'))?.code).toBe('MAERSK_GP');
    expect(r(ctr('TCLU0000001', 'MRT'))?.code).toBe('MAERSK_GP');
  });

  it('aturan ke livery yang tidak ada dilewati', () => {
    const r = makeResolver({
      source: 'db',
      liveries: FALLBACK_LIVERIES.liveries.filter((l) => l.code !== 'MERATUS_GP'),
      rules: FALLBACK_LIVERIES.rules,
    });
    expect(r(ctr('MRTU1234567'))?.code).toBe('GENERIC_GP');
  });
});
