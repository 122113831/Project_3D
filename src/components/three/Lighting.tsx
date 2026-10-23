'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useYard } from '@/store/useYard';
import { YARD_EXTENT_X, YARD_EXTENT_Z } from '@/lib/constants';

/**
 * Dua lampu saja: hemisphere untuk cahaya langit + satu directional sebagai
 * matahari. Tidak ada point light per tiang lampu — tiap light tambahan
 * menambah biaya di fragment shader untuk SETIAP piksel kontainer.
 *
 * MALAM memakai dua lampu yang sama dengan nilai lain: langit biru gelap,
 * "bulan" rendah dan dingin, fill nyaris mati. Cahaya tiang lampu TIDAK
 * dibuat sebagai point light (alasan di atas); yang menyala adalah kepala
 * tiangnya sendiri lewat material tanpa pencahayaan (lihat Equipment), dan
 * kesan terangnya ditambah oleh hemisphere yang sedikit kekuningan dari
 * bawah — seolah aspal memantulkan lampu sodium.
 */
export function Lighting() {
  const shadows = useYard((s) => s.options.shadows);
  const night = useYard((s) => s.options.night);
  const radius = Math.max(YARD_EXTENT_X, YARD_EXTENT_Z) * 0.62;

  // Langit dan kabut dipasang sekali saat kanvas dibuat (YardScene); keduanya
  // harus ikut berganti di sini, kalau tidak malam datang dengan langit biru
  // siang yang terang.
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.setClearColor(night ? '#0b1220' : '#a7c8e7');
    if (scene.fog instanceof THREE.Fog) scene.fog.color.set(night ? '#0e1626' : '#bcd5ec');
    invalidate();
  }, [night, gl, scene, invalidate]);

  return (
    <>
      {night ? (
        <hemisphereLight args={['#1a2742', '#3a3320', 0.55]} />
      ) : (
        // Warna bawah bukan lagi hampir hitam: di siang hari beton apron
        // memantulkan cahaya hangat ke sisi bawah kontainer.
        <hemisphereLight args={['#dbeaff', '#b6ad97', 1.25]} />
      )}
      <directionalLight
        // Siang: matahari pagi, elevasi ~37°. Malam: bulan rendah dari arah lain.
        position={night ? [-YARD_EXTENT_X * 0.4, 220, YARD_EXTENT_Z * 0.7] : [YARD_EXTENT_X * 0.5, 400, -YARD_EXTENT_Z * 0.85]}
        intensity={night ? 0.35 : 1.95}
        color={night ? '#9fb4e6' : '#fff2de'}
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
      <directionalLight position={[-300, 160, 400]} intensity={night ? 0.08 : 0.42} color="#c3d6ee" />
    </>
  );
}
