'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useYard } from '@/store/useYard';
import { YARD_EXTENT_X, YARD_EXTENT_Z } from '@/lib/constants';
import { fixedSky, skyAtHour, withWeather } from '@/lib/sky';

/**
 * Dua lampu saja: hemisphere untuk cahaya langit + satu directional sebagai
 * matahari. Tidak ada point light per tiang lampu — tiap light tambahan
 * menambah biaya di fragment shader untuk SETIAP piksel kontainer.
 *
 * Nilai kedua lampu itu, warna langit, dan kabut datang dari sky.ts: tetap
 * siang/malam, atau mengikuti jam komputer ("Ikuti jam") — matahari terbit di
 * timur, senja jingga, lalu malam dengan lampu tiang menyala. Cuaca (Open-
 * Meteo atau paksa) meredupkan cahaya, memudarkan langit, mendekatkan kabut,
 * dan menurunkan hujan.
 */

type Live = { cloud: number; rain: number; visibility: number | null } | null;

/** Cuaca langsung dari server, diperbarui tiap 10 menit selama dipakai. */
function useLiveWeather(enabled: boolean): Live {
  const [w, setW] = useState<Live>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const pull = () =>
      fetch('/api/yard/weather', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && setW(j && typeof j.cloud === 'number' ? j : null))
        .catch(() => alive && setW(null));
    void pull();
    const t = setInterval(pull, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled]);
  return enabled ? w : null;
}

/**
 * Hujan: ribuan garis pendek jatuh di kotak yang mengikuti sasaran kamera,
 * jadi hujannya selalu di depan mata tanpa mengisi seluruh lapangan. Satu
 * draw call. Selama hujan, frame diminta terus — memang animasi.
 */
function Rain({ intensity }: { intensity: number }) {
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3 } | null;
  const invalidate = useThree((s) => s.invalidate);
  const COUNT = 5000;
  const SIZE = 320;
  const HEIGHT = 140;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const v = new Float32Array(COUNT * 6);
    for (let i = 0; i < COUNT; i++) {
      const x = (Math.random() - 0.5) * SIZE;
      const y = Math.random() * HEIGHT;
      const z = (Math.random() - 0.5) * SIZE;
      v.set([x, y, z, x + 0.15, y + 1.6, z], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(v, 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ref = useRef<THREE.LineSegments>(null);

  useFrame((_, delta) => {
    const attr = geo.getAttribute('position') as THREE.BufferAttribute;
    const a = attr.array as Float32Array;
    const fall = Math.min(delta, 0.05) * 38;
    const n = Math.floor(COUNT * Math.max(0.15, Math.min(1, intensity)));
    for (let i = 0; i < n; i++) {
      const o = i * 6;
      a[o + 1] -= fall;
      a[o + 4] -= fall;
      if (a[o + 1] < 0) {
        a[o + 1] += HEIGHT;
        a[o + 4] += HEIGHT;
      }
    }
    attr.needsUpdate = true;
    geo.setDrawRange(0, n * 2);
    if (ref.current && controls) ref.current.position.set(controls.target.x, 0, controls.target.z);
    invalidate();
  });

  return (
    <lineSegments ref={ref} geometry={geo} frustumCulled={false}>
      <lineBasicMaterial color="#a9bccf" transparent opacity={0.5} depthWrite={false} />
    </lineSegments>
  );
}

export function Lighting() {
  const shadows = useYard((s) => s.options.shadows);
  const night = useYard((s) => s.options.night);
  const autoSky = useYard((s) => s.options.autoSky);
  const weather = useYard((s) => s.options.weather);
  const setOption = useYard((s) => s.setOption);
  const radius = Math.max(YARD_EXTENT_X, YARD_EXTENT_Z) * 0.62;

  // Jam berdetak tiap 30 detik — cukup untuk matahari yang bergerak 0,125°
  // per 30 detik, dan tidak membangunkan kanvas lebih sering dari perlu.
  const [hour, setHour] = useState(() => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60;
  });
  useEffect(() => {
    if (!autoSky) return;
    const tick = () => {
      const d = new Date();
      setHour(d.getHours() + d.getMinutes() / 60);
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, [autoSky]);

  const live = useLiveWeather(weather === 'live');
  const cloud = weather === 'rain' ? 0.9 : weather === 'fog' ? 0.7 : weather === 'live' ? (live?.cloud ?? 0) : 0;
  const rain =
    weather === 'rain' ? 0.85 : weather === 'live' && live && live.rain > 0.05 ? Math.min(1, 0.3 + live.rain / 5) : 0;
  // Kabut: jarak pandang langsung kalau ada, kabut tebal kalau dipaksa.
  const fogFar =
    weather === 'fog'
      ? 520
      : weather === 'rain'
        ? 1600
        : weather === 'live' && live?.visibility
          ? Math.max(300, Math.min(4600, live.visibility * 1.2))
          : 4600;

  const sky = useMemo(
    () => withWeather(autoSky ? skyAtHour(hour) : fixedSky(night), cloud),
    [autoSky, hour, night, cloud],
  );

  // Dengan "Ikuti jam", lampu tiang ikut langit: opsi `night` disetel dari
  // sini supaya Equipment (kepala lampu yang berpendar) tidak perlu tahu jam.
  useEffect(() => {
    if (autoSky && night !== sky.night) setOption('night', sky.night);
  }, [autoSky, sky.night, night, setOption]);

  // Langit dan kabut dipasang sekali saat kanvas dibuat (YardScene); keduanya
  // harus ikut berganti di sini.
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.setClearColor(sky.clear);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.set(sky.fog);
      scene.fog.near = fogFar < 1000 ? 40 : 1200;
      scene.fog.far = fogFar;
    }
    invalidate();
  }, [sky, fogFar, gl, scene, invalidate]);

  const D = 600;
  return (
    <>
      <hemisphereLight args={[sky.hemiSky, sky.hemiGround, sky.hemiIntensity]} />
      <directionalLight
        position={[sky.dir[0] * D, sky.dir[1] * D, sky.dir[2] * D]}
        intensity={sky.sunIntensity}
        color={sky.sunColor}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={50}
        shadow-camera-far={1400}
      />
      {/* Fill lembut dari arah berlawanan supaya sisi bayangan tidak mati total. */}
      <directionalLight position={[-300, 160, 400]} intensity={sky.fillIntensity} color="#c3d6ee" />
      {rain > 0 && <Rain intensity={rain} />}
    </>
  );
}
