'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useYard } from '@/store/useYard';
import { isWarming } from '@/lib/modelWarmup';

/**
 * Mengambil angka renderer apa adanya: draw call, triangle, dan FPS nyata.
 *
 * Panel ini sengaja ditampilkan — inti proyek ini adalah menunjukkan bahwa
 * puluhan ribu kontainer tetap berada di kisaran puluhan draw call.
 */
/**
 * Ambang di sekitar anggaran 60 fps (16,7 ms). Sengaja diberi jarak: kalau
 * naik-turun tepat di angka anggaran, dpr akan berubah tiap setengah detik.
 */
const TOO_SLOW_MS = 20;
const FAST_ENOUGH_MS = 12;
const MIN_DPR = 0.6;

export function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const viewport = useThree((s) => s.viewport);
  const setPerf = useYard((s) => s.setPerf);
  const adaptive = useYard((s) => s.options.adaptive);
  const dpr = useRef(0);
  const streak = useRef(0);
  const frames = useRef(0);
  const last = useRef({ calls: 0, triangles: 0, programs: 0 });
  const gaps = useRef<number[]>([]);
  const prev = useRef(0);

  /**
   * Nama GPU. Kalau di sini muncul SwiftShader / llvmpipe / Software, berarti
   * browser merender tanpa akselerasi perangkat keras — dan itu sendirian
   * cukup menjelaskan frame puluhan milidetik betapa pun ringan scene-nya.
   */
  const renderer = useMemo(() => {
    try {
      const ctx = gl.getContext();
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return 'not available';
      return String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch {
      return 'not available';
    }
  }, [gl]);

  useFrame(() => {
    frames.current += 1;

    // Jeda antar frame beruntun saja yang dihitung. Di frameloop="demand",
    // jeda panjang berarti tidak ada yang berubah — bukan frame yang lambat.
    const now = performance.now();
    if (prev.current > 0) {
      const gap = now - prev.current;
      if (gap < 100) gaps.current.push(gap);
    }
    prev.current = now;
    // gl.info.autoReset = true, jadi di awal frame ini isinya statistik frame
    // sebelumnya — persis yang ingin dilaporkan.
    const r = gl.info.render;
    last.current = {
      calls: r.calls,
      triangles: r.triangles,
      programs: gl.info.programs?.length ?? 0,
    };
  });

  useEffect(() => {
    const id = window.setInterval(() => {
      // Median, bukan rata-rata: satu frame tersendat karena garbage collector
      // tidak boleh menutupi biaya frame yang sebenarnya.
      const g = gaps.current;
      let frameMs = 0;
      if (g.length) {
        g.sort((a, b) => a - b);
        frameMs = g[Math.floor(g.length / 2)];
      }
      // Turunkan resolusi kalau frame melewati anggaran, naikkan lagi kalau
      // ada kelonggaran. Yang dikurangi jumlah PIKSEL, bukan isi scene —
      // geometri lapangan tetap utuh.
      //
      // Ini menyerang dua penyebab paling mungkin sekaligus: layar besar
      // dikali dpr, dan render perangkat lunak yang biayanya nyaris seluruhnya
      // per piksel. Kalau hambatannya CPU, angka ini tidak akan bergerak
      // banyak — dan itu sendiri sudah jadi petunjuk.
      if (dpr.current === 0) dpr.current = viewport.dpr;
      if (adaptive && isWarming()) streak.current = 0;
      else if (adaptive && g.length >= 5) {
        const want = frameMs > TOO_SLOW_MS ? -1 : frameMs < FAST_ENOUGH_MS ? 1 : 0;
        // Butuh dua jendela berturut-turut ke arah yang sama sebelum bertindak:
        // mengubah dpr berarti mengalokasi ulang framebuffer, dan kalau
        // bolak-balik tiap setengah detik justru itu yang bikin tersendat.
        streak.current = want === 0 ? 0 : streak.current > 0 === want > 0 ? streak.current + want : want;
        if (Math.abs(streak.current) >= 2) {
          const max = Math.min(2, window.devicePixelRatio || 1.5);
          const next = Math.min(max, Math.max(MIN_DPR, dpr.current * (want < 0 ? 0.85 : 1.1)));
          if (Math.abs(next - dpr.current) > 0.02) {
            dpr.current = next;
            setDpr(next);
          }
          streak.current = 0;
        }
      }

      setPerf({
        fps: frames.current * 2,
        frameMs,
        renderer,
        dpr: dpr.current || viewport.dpr,
        ...last.current,
      });
      frames.current = 0;
      gaps.current = [];
    }, 500);
    return () => window.clearInterval(id);
  }, [setPerf, renderer, adaptive, setDpr, viewport.dpr]);

  return null;
}
