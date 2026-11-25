'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { viewShiftPx } from '@/lib/dock';
import { useDock } from '@/store/useDock';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';

/**
 * Menggeser GAMBAR kamera — bukan kameranya — saat panel kiri dok terbuka,
 * supaya pusat lapangan tetap di tengah ruang yang tidak tertutup panel.
 *
 * Pakai camera.setViewOffset: posisi, orbit, dan "ikuti alat" tidak
 * tersentuh sama sekali; raycast klik dan label Html ikut benar karena
 * semuanya membaca projectionMatrix yang sama. Pergeseran dihaluskan per
 * frame, dan karena frameloop "demand", tiap langkah meminta frame berikutnya
 * sendiri sampai sampai di tujuan.
 */
export function PanelViewOffset() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const open = useDock((s) => s.tab !== null);
  const editing = useEditor((s) => s.open);
  const inspecting = useYard((s) => s.selected !== null);
  const kiosk = useYard((s) => s.options.kiosk);
  const target = viewShiftPx(open && !editing && !inspecting && !kiosk);
  const cur = useRef(0);

  const apply = (x: number) => {
    if (Math.abs(x) < 0.5) camera.clearViewOffset();
    else camera.setViewOffset(size.width, size.height, x, 0, size.width, size.height);
  };

  // Ukuran kanvas berubah: offset lama memakai lebar lama, pasang ulang.
  useEffect(() => {
    apply(cur.current);
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, camera]);

  useEffect(() => {
    invalidate();
  }, [target, invalidate]);

  useEffect(() => () => camera.clearViewOffset(), [camera]);

  useFrame((_, dt) => {
    const d = target - cur.current;
    if (Math.abs(d) < 0.5) {
      if (cur.current !== target) {
        cur.current = target;
        apply(target);
      }
      return;
    }
    // Pegas sederhana: ±90 % jarak tertutup dalam ~0,35 detik.
    cur.current += d * Math.min(1, dt * 7);
    apply(cur.current);
    invalidate();
  });

  return null;
}
