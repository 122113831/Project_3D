'use client';

import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CAMERA } from '@/lib/constants';
import { useYard } from '@/store/useYard';
import { BlockLabels } from './three/BlockLabels';
import { EditorTools } from './three/EditorTools';
import { CameraRig } from './three/CameraRig';
import { Equipment } from './three/Equipment';
import { Ground } from './three/Ground';
import { Lighting } from './three/Lighting';
import { NearbyLabels } from './three/NearbyLabels';
import { PerfProbe } from './three/PerfProbe';
import { Picking } from './three/Picking';
import { Selection } from './three/Selection';
import { AlertMarkers } from './three/AlertMarkers';
import { BlockInfo } from './three/BlockInfo';
import { EquipmentLabels } from './three/EquipmentLabels';
import { RtgWorks } from './three/RtgWorks';
import { RsWorks } from './three/RsWorks';
import { SlotGrid } from './three/SlotGrid';
import { Traffic } from './three/Traffic';
import { YardContainers } from './three/YardContainers';

/**
 * Mengganti status shadow saat runtime butuh kompilasi ulang shader material.
 * Tanpa ini, mematikan/menyalakan bayangan tidak berpengaruh sampai material
 * berubah karena sebab lain.
 */
function ShadowSync() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  const shadows = useYard((s) => s.options.shadows);

  useEffect(() => {
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.shadowMap.needsUpdate = true;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) m.needsUpdate = true;
    });
    invalidate();
  }, [shadows, gl, scene, invalidate]);

  return null;
}

export default function YardScene() {
  return (
    <Canvas
      // "demand": frame hanya dirender saat ada yang berubah. Untuk aplikasi
      // operasional yang layarnya diam sebagian besar waktu, ini menghemat
      // baterai dan membuat kipas laptop tidak berputar.
      frameloop="demand"
      // Nilai awal saja; PerfProbe menyetelnya sendiri mengikuti waktu frame
      // saat "Kualitas adaptif" menyala.
      dpr={[1, 1.5]}
      gl={{
        // MSAA dimatikan, dan itu keputusan sadar untuk GPU terintegrasi.
        //
        // Dua alasan. Pertama, MSAA 4x melipatgandakan bandwidth color dan
        // depth buffer — dan bandwidth memori justru yang paling langka di
        // GPU yang berbagi RAM dengan CPU seperti Intel Iris. Kedua, MSAA
        // berbenturan dengan resolusi adaptif: tiap kali dpr berubah,
        // framebuffer bermultisample harus dialokasikan ulang, dan itu
        // tersendat justru saat kamera sedang bergerak.
        //
        // Gantinya resolusi: kalau ada kelonggaran, dpr naik sampai 2 dan
        // supersampling memberi tepi yang halus juga. Hidupkan lagi di sini
        // kalau lebih suka tepi mulus daripada frame rate.
        antialias: false,
        powerPreference: 'high-performance',
      }}
      camera={{
        position: CAMERA.position,
        fov: CAMERA.fov,
        near: CAMERA.near,
        far: CAMERA.far,
      }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor('#a7c8e7');
        // Eksposur dinaikkan sedikit, bukan intensitas lampunya: R3F memakai
        // ACES filmic secara default, yang memang menekan midtone.
        gl.toneMappingExposure = 1.1;
        // Kabut sedikit lebih terang dari langit supaya horizon berkabut,
        // bukan menghilang jadi satu warna rata.
        scene.fog = new THREE.Fog('#bcd5ec', 1200, 4600);
      }}
    >
      <ShadowSync />
      <PerfProbe />
      <Picking />
      <CameraRig />

      <Lighting />
      <Ground />
      <BlockLabels />
      {/* Papan kapasitas tiap blok: persen terisi dan sisa box. */}
      <BlockInfo />
      <EquipmentLabels />
      <YardContainers />
      {/* Kisi slot di editor, dan kotak merah slot terkunci di luar editor. */}
      <SlotGrid />
      <Equipment />
      {/* Truk gate yang bergerak mengikuti kejadian gate in / stack / gate out. */}
      <Traffic />
      {/* RTG yang menjemput/menaruh kontainer untuk truk yang menunggu. */}
      <RtgWorks />
      <RsWorks />
      {/* Penanda berdenyut: bahaya, rusak, lewat batas dwell. */}
      <AlertMarkers />
      <Selection />
      <NearbyLabels />
      <EditorTools />
    </Canvas>
  );
}
