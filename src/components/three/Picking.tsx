'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { YardContainer } from '@/lib/types';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { pickables } from './pickRegistry';

/**
 * Klik untuk memilih kontainer — raycast manual, hanya saat pointerup.
 *
 * InstancedMesh.raycast menguji setiap instance, jadi ini pekerjaan berat yang
 * TIDAK boleh berjalan tiap pointermove. Karena mesh dipecah per blok dan
 * three memeriksa bounding sphere mesh lebih dulu, blok yang tidak dilewati
 * sinar langsung dibuang tanpa biaya.
 */
export function Picking() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const select = useYard((s) => s.select);

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let downT = 0;

    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
    };

    const onUp = (e: PointerEvent) => {
      // Abaikan kalau ini gerakan orbit/pan, bukan klik.
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;
      if (performance.now() - downT > 700) return;
      // Di editor kontainer disembunyikan, tapi mesh-nya masih ada untuk
      // raycast. Tanpa ini klik pada kisi slot membuka layar inspeksi
      // kontainer yang tidak terlihat.
      if (useEditor.getState().open) return;

      const rect = el.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      let bestDist = Infinity;
      let bestContainer: YardContainer | null = null;

      for (const entry of pickables()) {
        const hit = raycaster.intersectObject(entry.mesh, false)[0];
        if (hit && hit.instanceId !== undefined && hit.distance < bestDist) {
          bestDist = hit.distance;
          bestContainer = entry.items[hit.instanceId] ?? null;
        }
      }

      select(bestContainer);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera, select]);

  return null;
}
