'use client';

import { useEffect, useRef, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMERA } from '@/lib/constants';
import { containerPosition } from '@/lib/yard';
import { findBlock, useYard } from '@/store/useYard';

type Flight = {
  t: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};

const DURATION = 0.9;

export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  const flyToken = useYard((s) => s.flyToken);
  const flight = useRef<Flight | null>(null);

  // Bingkai ulang kamera saat luas lapangan berubah.
  //
  // Lapangan depot 250 x 113 m, sementara grid demo 816 x 408 m. Posisi kamera
  // awal yang dihitung dari konstanta demo membuat lapangan depot tampak
  // sebagai titik di kejauhan. Dikunci pada ukurannya supaya tidak melawan
  // kamera yang sedang digerakkan user.
  // Kunci ini ikut memuat PUSAT lapangan: sejak lapangan database duduk di
  // koordinat peta yang sebenarnya, pusatnya tidak lagi selalu (0,0), dan
  // membingkai ulang harus terjadi kalau pusatnya pindah.
  const extent = useYard((s) =>
    s.data
      ? [
          s.data.meta.extentX.toFixed(1),
          s.data.meta.extentZ.toFixed(1),
          (s.data.meta.centerX ?? 0).toFixed(1),
          (s.data.meta.centerZ ?? 0).toFixed(1),
        ].join('x')
      : null,
  );
  const framed = useRef<string | null>(null);

  useEffect(() => {
    if (!extent || !controls.current || framed.current === extent) return;
    framed.current = extent;
    const [x, z, cx, cz] = extent.split('x').map(Number);
    const span = Math.max(x, z * 2.2);
    camera.position.set(cx + span * 0.56, span * 0.78, cz + span * 0.84);
    controls.current.target.set(cx, 0, cz);
    controls.current.update();
    flight.current = null;
    invalidate();
  }, [extent, camera, invalidate]);

  useEffect(() => {
    if (flyToken === 0) return;
    const { selected, data } = useYard.getState();
    const block = findBlock(data, selected?.block);
    if (!selected || !block || !controls.current) return;

    const [x, y, z] = containerPosition(block, selected);
    const target = new THREE.Vector3(x, y, z);

    flight.current = {
      t: 0,
      fromPos: camera.position.clone(),
      toPos: target.clone().add(new THREE.Vector3(34, 28, 42)),
      fromTarget: controls.current.target.clone(),
      toTarget: target,
    };
    invalidate();
  }, [flyToken, camera, invalidate]);

  useFrame((_, dt) => {
    const f = flight.current;
    if (!f || !controls.current) return;
    f.t = Math.min(1, f.t + dt / DURATION);
    const k = f.t * f.t * (3 - 2 * f.t); // smoothstep
    camera.position.lerpVectors(f.fromPos, f.toPos, k);
    controls.current.target.lerpVectors(f.fromTarget, f.toTarget, k);
    controls.current.update();
    if (f.t >= 1) flight.current = null;
    // frameloop="demand": minta frame berikutnya selama animasi masih jalan.
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      target={CAMERA.target}
      minDistance={14}
      maxDistance={2400}
      maxPolarAngle={Math.PI / 2 - 0.035}
      panSpeed={1.1}
    />
  );
}
