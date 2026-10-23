'use client';

import { useEffect, useRef, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMERA } from '@/lib/constants';
import { containerPosition } from '@/lib/yard';
import { useTraffic } from '@/store/useTraffic';
import { findBlock, useYard } from '@/store/useYard';
import { setCameraPose, truckPose } from './trafficRegistry';

const _target = new THREE.Vector3();
const _delta = new THREE.Vector3();

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
  const view2d = useYard((s) => s.options.view2d);
  const tour = useYard((s) => s.options.tour);

  // Denah 2D: kamera dipindah tegak lurus di atas sasaran orbit, pada jarak
  // yang sama dengan sebelumnya — jadi yang dilihat user tidak melompat, cuma
  // "ditegakkan". Kembali ke 3D menurunkannya lagi ke sudut pandang semula.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const d = camera.position.distanceTo(c.target);
    if (view2d) {
      camera.position.set(c.target.x, c.target.y + d, c.target.z + 0.001);
    } else {
      camera.position.set(c.target.x + d * 0.56, c.target.y + d * 0.62, c.target.z + d * 0.55);
    }
    c.update();
    invalidate();
  }, [view2d, camera, invalidate]);

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

  // Terbang ke titik sembarang (panel pemeriksaan): jarak kamera mengikuti
  // lebar daerah yang diminta, dari sudut pandang yang sama dengan bingkai awal.
  const focus = useYard((s) => s.focus);
  useEffect(() => {
    if (!focus || !controls.current) return;
    const target = new THREE.Vector3(focus.x, 0, focus.z);
    const d = Math.max(30, focus.span * 1.4);
    flight.current = {
      t: 0,
      fromPos: camera.position.clone(),
      toPos: target.clone().add(new THREE.Vector3(d * 0.56, d * 0.62, d * 0.55)),
      fromTarget: controls.current.target.clone(),
      toTarget: target,
    };
    invalidate();
  }, [focus, camera, invalidate]);

  useFrame((_, dt) => {
    // Pose kamera untuk minimap, tiap frame yang digambar.
    if (controls.current) {
      const t = controls.current.target;
      setCameraPose({
        x: camera.position.x,
        z: camera.position.z,
        tx: t.x,
        tz: t.z,
        yaw: Math.atan2(t.x - camera.position.x, t.z - camera.position.z),
      });
    }
    // Mode tur memutar kamera sendiri; frameloop="demand" perlu diminta terus.
    if (tour && !view2d) invalidate();

    // Mode mengikuti truk: sasaran orbit dipindahkan ke truk tiap frame, dan
    // kamera digeser sebesar yang sama supaya sudut pandang user tidak berubah
    // — user tetap bisa memutar dan mendekat sambil mengikuti.
    const { follow, selectedTrip } = useTraffic.getState();
    if (follow && selectedTrip && controls.current) {
      const p = truckPose(selectedTrip);
      if (p) {
        _target.set(p.x, 1.5, p.z);
        _delta.copy(_target).sub(controls.current.target);
        controls.current.target.copy(_target);
        camera.position.add(_delta);
        controls.current.update();
        flight.current = null;
        invalidate();
        return;
      }
    }

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
      // Denah 2D mengunci kamera tegak lurus: tanpa orbit, hanya geser dan zoom.
      minPolarAngle={0}
      maxPolarAngle={view2d ? 0.0001 : Math.PI / 2 - 0.035}
      enableRotate={!view2d}
      // Mode tur: berkeliling pelan — satu putaran sekitar 3 menit.
      autoRotate={tour && !view2d}
      autoRotateSpeed={0.35}
      panSpeed={1.1}
    />
  );
}
