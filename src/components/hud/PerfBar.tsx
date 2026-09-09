'use client';

import { useMemo } from 'react';
import { useYard } from '@/store/useYard';
import { nf, Panel, Stat } from './ui';

/**
 * Angka renderer: FPS, draw call, segitiga, dan GPU yang sedang dipakai.
 *
 * Dipisah dari TopBar supaya baris atas bisa menata keduanya sendiri-sendiri —
 * statistik lapangan menempel di kiri bersama kotak pencarian, angka renderer
 * didorong ke tepi kanan. Sebelumnya keduanya satu panel dengan `ml-auto` di
 * tengah, dan lubang di antaranya melar mengikuti lebar jendela.
 */
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

  return (
    <Panel className="pointer-events-auto flex items-center gap-5 px-4 py-2.5">
      <Stat
        label="FPS"
        value={perf.fps ? String(perf.fps) : 'idle'}
        hint={
          perf.frameMs
            ? `${perf.frameMs.toFixed(1)} ms/frame${perf.dpr ? ` · dpr ${perf.dpr.toFixed(2)}` : ''}`
            : 'idle = tidak ada yang berubah'
        }
      />
      <Stat label="Draw call" value={nf(perf.calls)} />
      {/* Kolom yang paling jarang dibaca menghilang lebih dulu di jendela
          sempit. Tanpa ini panel renderer turun ke baris kedua dan mendorong
          seluruh kolom kiri ke bawah — opsi tampilan paling bawah jadi
          terpotong hanya karena jendelanya kurang lebar. */}
      <div className="hidden xl:block">
        <Stat
          label="Triangle"
          value={perf.triangles > 999_999 ? `${(perf.triangles / 1e6).toFixed(1)} jt` : nf(perf.triangles)}
        />
      </div>
      {gpu && (
        <div className="hidden min-w-[74px] 2xl:block" title={gpu.raw}>
          <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">GPU</div>
          <div
            className={`text-[13px] font-semibold ${gpu.software ? 'text-amber-300' : 'text-slate-50'}`}
          >
            {gpu.name}
          </div>
          {gpu.software && <div className="text-[10px] text-amber-400/80">render perangkat lunak</div>}
        </div>
      )}
    </Panel>
  );
}
