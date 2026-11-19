'use client';

import { useEffect, useRef, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMERA } from '@/lib/constants';
import { containerPosition } from '@/lib/yard';
import { useTraffic } from '@/store/useTraffic';
import { findBlock, useYard } from '@/store/useYard';
import { anyRtgPose, setCameraPose, truckPose } from './trafficRegistry';

const _target = new THREE.Vector3();
const _delta = new THREE.Vector3();

type Flight = {
  t: number;
  /** Lama terbang, detik — makin jauh makin lama. */
  duration: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  /** Titik kendali kurva: di atas garis lurus, supaya kamera melengkung naik. */
  ctrl: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
};

/**
 * Penerbangan sinematik: lintasan kamera berupa kurva Bézier kuadrat yang
 * naik di tengah — kamera "melompat" melewati lapangan, bukan meluncur
 * datar menembus tumpukan. Lengkungnya dan lamanya ikut jarak: berpindah ke
 * kontainer sebelah nyaris lurus dan cepat, menyeberang lapangan melambung
 * tinggi dan lebih lama.
 */
function makeFlight(fromPos: THREE.Vector3, toPos: THREE.Vector3, fromTarget: THREE.Vector3, toTarget: THREE.Vector3): Flight {
  const dist = fromPos.distanceTo(toPos);
  const ctrl = fromPos.clone().add(toPos).multiplyScalar(0.5);
  ctrl.y = Math.max(fromPos.y, toPos.y) + Math.min(220, dist * 0.35);
  return {
    t: 0,
    duration: Math.min(2.6, Math.max(0.9, 0.7 + dist / 260)),
    fromPos: fromPos.clone(),
    toPos,
    ctrl,
    fromTarget: fromTarget.clone(),
    toTarget,
  };
}

const _bez = new THREE.Vector3();
/** Titik di kurva Bézier kuadrat. */
function bezier(out: THREE.Vector3, a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number) {
  const u = 1 - t;
  out.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t);
  return out;
}

export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  const flyToken = useYard((s) => s.flyToken);
  const flight = useRef<Flight | null>(null);
  const view2d = useYard((s) => s.options.view2d);
  // Mode kiosk selalu berkeliling, seperti mode tur.
  const tour = useYard((s) => s.options.tour || s.options.kiosk);

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
    // Bingkai awal: lapangan UTUH terlihat di sela panel HUD, sedekat mungkin.
    // Rumus lama `max(x, z * 2,2)` memundurkan kamera ±445 m untuk lapangan
    // depot 157 × 159 m (lapangan tampak kecil di tengah). Perkiraan dengan
    // rumus pun meleset karena perspektif: blok terdekat tampak lebih besar.
    // Jadi kedelapan sudut kotak lapangan diproyeksikan ke layar dan jarak
    // kamera dicari (bisection) sampai semuanya masuk area aman.
    const persp = camera as THREE.PerspectiveCamera;
    const dir = new THREE.Vector3(0.56, 0.78, 0.84).normalize();
    const top = 14; // tumpukan + RTG
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sz) => [0, top].map((y) => new THREE.Vector3(cx + (sx * x) / 2, y, cz + (sz * z) / 2))),
    );
    // Area aman di NDC: panel HUD menutup ±18% kiri & kanan, baris atas ±12%.
    const SAFE_X = 0.62;
    const SAFE_TOP = 0.76;
    const SAFE_BOTTOM = -0.92;
    const tgt = new THREE.Vector3(cx, 0, cz);
    const p = new THREE.Vector3();
    const fits = (d: number) => {
      persp.position.copy(tgt).addScaledVector(dir, d);
      persp.lookAt(tgt);
      persp.updateMatrixWorld();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of corners) {
        p.copy(c).project(persp);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      return { ok: maxX - minX <= 2 * SAFE_X && maxY - minY <= SAFE_TOP - SAFE_BOTTOM, minX, maxX, minY, maxY };
    };
    let lo = 10;
    let hi = 4000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid).ok) hi = mid;
      else lo = mid;
    }
    // Geser sasaran supaya kotak terproyeksi berada di tengah area aman.
    for (let i = 0; i < 3; i++) {
      const r = fits(hi);
      const offX = (r.minX + r.maxX) / 2;
      const offY = (r.minY + r.maxY) / 2 - (SAFE_TOP + SAFE_BOTTOM) / 2;
      const right = new THREE.Vector3().setFromMatrixColumn(persp.matrixWorld, 0);
      const fwd = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();
      const halfW = hi * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)) * persp.aspect;
      const halfH = hi * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2));
      tgt.addScaledVector(right, offX * halfW).addScaledVector(fwd, (offY * halfH) / Math.sin(Math.asin(dir.y)));
    }
    camera.position.copy(tgt).addScaledVector(dir, hi);
    controls.current.target.copy(tgt);
    controls.current.update();
    flight.current = null;
    invalidate();
  }, [extent, camera, invalidate]);

  useEffect(() => {
    if (flyToken === 0) return;
    const { selected, located, data } = useYard.getState();
    // Yang dipilih (klik) lebih dulu; tanpa itu, hasil pencarian.
    const c = selected ?? located;
    const block = findBlock(data, c?.block);
    if (!c || !block || !controls.current) return;

    const [x, y, z] = containerPosition(block, c);
    const target = new THREE.Vector3(x, y, z);

    // Hasil pencarian dilihat lebih dekat (±40 m): cukup untuk membaca
    // tumpukan di sekitarnya, dan model detail blok itu ikut menyala.
    const offset = selected ? new THREE.Vector3(34, 28, 42) : new THREE.Vector3(22, 20, 28);
    flight.current = makeFlight(
      camera.position,
      target.clone().add(offset),
      controls.current.target,
      target,
    );
    invalidate();
  }, [flyToken, camera, invalidate]);

  // Terbang ke titik sembarang (panel pemeriksaan): jarak kamera mengikuti
  // lebar daerah yang diminta, dari sudut pandang yang sama dengan bingkai awal.
  const focus = useYard((s) => s.focus);
  useEffect(() => {
    if (!focus || !controls.current) return;
    const target = new THREE.Vector3(focus.x, 0, focus.z);
    const d = Math.max(30, focus.span * 1.4);
    flight.current = makeFlight(
      camera.position,
      target.clone().add(new THREE.Vector3(d * 0.56, d * 0.62, d * 0.55)),
      controls.current.target,
      target,
    );
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
    const { follow, selectedTrip, followRtg } = useTraffic.getState();

    // Mode mengikuti RTG: sasaran orbit DIDEKATKAN pelan ke spreader RTG yang
    // sedang bekerja (bukan dipaku), jadi kamera mengalun mengikuti portal dan
    // trolley tanpa menyentak saat spreader turun-naik.
    if (followRtg && controls.current) {
      const p = anyRtgPose();
      if (p) {
        _target.set(p.x, Math.max(4, p.y * 0.6), p.z);
        _delta.copy(_target).sub(controls.current.target).multiplyScalar(Math.min(1, dt * 3));
        controls.current.target.add(_delta);
        camera.position.add(_delta);
        // Dari pandangan lebar, kamera juga mendekat pelan sampai ±70 m —
        // tanpa itu yang "diikuti" cuma titik kecil di tengah layar. Pengguna
        // yang sengaja mendekat lebih rapat tidak ditarik mundur.
        const dist = camera.position.distanceTo(controls.current.target);
        if (dist > 75) {
          _delta.copy(camera.position).sub(controls.current.target).setLength(dist - (dist - 70) * Math.min(1, dt * 1.5));
          camera.position.copy(controls.current.target).add(_delta);
        }
        controls.current.update();
        flight.current = null;
        invalidate();
        return;
      }
    }
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
    f.t = Math.min(1, f.t + dt / f.duration);
    const k = f.t * f.t * (3 - 2 * f.t); // smoothstep
    camera.position.copy(bezier(_bez, f.fromPos, f.ctrl, f.toPos, k));
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
