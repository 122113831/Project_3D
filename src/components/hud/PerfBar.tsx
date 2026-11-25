'use client';

import { useMemo } from 'react';
import { useYard } from '@/store/useYard';
import { nf } from './ui';

/**
 * Angka renderer: FPS, draw call, segitiga, dan GPU yang sedang dipakai.
 *
 * Dipisah dari TopBar supaya baris atas bisa menata keduanya sendiri-sendiri —
 * statistik lapangan menempel di kiri bersama kotak pencarian, angka renderer
 * didorong ke tepi kanan. Sebelumnya keduanya satu panel dengan `ml-auto` di
 * tengah, dan lubang di antaranya melar mengikuti lebar jendela.
 */
/** Chip kinerja di kartu kanan atas (tanpa kartunya sendiri). */
export function PerfBar() {
  const perf = useYard((s) => s.perf);

  /**
   * Nama GPU dipendekkan. String aslinya panjang, mis.
   * "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)".
   */
  const gpu = useMemo(() => {
    const raw = perf.renderer;
    if (!raw) return null;
    const software = /swiftshader|llvmpipe|software|microsoft basic/i.test(raw);
    const inner = raw.match(/(([^)]*))/)?.[1] ?? raw;
    const name = inner.split(',').pop()!.replace(/Direct3D.*|OpenGL.*|vs_d.*/i, '').trim();
    return { name: name.slice(0, 22) || raw.slice(0, 22), software, raw };
  }, [perf.renderer]);

  // Ringkas seperti chip di mockup; rincian lengkap di tooltip.
  const tri = perf.triangles > 999_999 ? `${(perf.triangles / 1e6).toFixed(1)} M` : nf(perf.triangles);
  const detail = [
    perf.frameMs ? `${perf.frameMs.toFixed(1)} ms/frame` : 'idle = nothing changing',
    perf.dpr ? `dpr ${perf.dpr.toFixed(2)}` : '',
    `${nf(perf.calls)} draw calls`,
    `${tri} triangles`,
    gpu ? `GPU: ${gpu.raw}` : '',
    gpu?.software ? 'software rendering' : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <>
      <span
        title={detail}
        className={`flex h-8 items-center gap-2 rounded-[9px] bg-white/[0.06] px-2.5 font-mono text-[11.5px] ${
          gpu?.software ? 'text-amber-300' : 'text-slate-300'
        }`}
      >
        <i className={`h-[7px] w-[7px] rounded-full ${gpu?.software ? 'bg-amber-400' : 'bg-emerald-400'}`} />
        {perf.fps ? `${perf.fps} fps` : 'idle'} · {nf(perf.calls)} draw
        <span className="hidden text-slate-500 2xl:inline">· {tri}</span>
      </span>
    </>
  );
}
