'use client';

import { Suspense, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import type { GLTF } from 'three-stdlib';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RTG, RTG_ASSET, YARD_EXTENT_X, YARD_EXTENT_Z } from '@/lib/constants';
import {
  craneModelFor,
  itvModelFor,
  ITV_MODEL_URL,
  RTG_CRANE_MODEL_URL,
  STS_MODEL_URL,
  truckModelFor,
  TRUCK_MODEL_URL,
  type ModelPart,
} from '@/lib/containerModel';
import { generateEquipment, rtgAssetScaleAt, rtgScaleAt } from '@/lib/equipment';
import { RTG_DETAIL, rtgDetailModel, rtgDetailRailZAt } from '@/lib/rtgDetail';
import { rtgDetail2Model, setRtgDetail2Night } from '@/lib/rtgDetail2';
import { setWarehouseNight, warehouseModel } from '@/lib/warehouse';
import { parkingModel } from '@/lib/parking';
import { useRsWorks } from '@/store/useRsWorks';
import { createReachStacker, setReachStackerNight } from '@/lib/reachStacker';
import type { LayoutEquipment } from '@/lib/layout';
import {
  createChassisGeometry,
  createChassisLoadGeometry,
  createGateGeometry,
  createGateSignGeometry,
  createLampGeometry,
  createRtgGeometry,
  createRtgSpreaderGeometry,
} from '@/lib/geometry';
import { useEditor } from '@/store/useEditor';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';

type Placement = {
  x: number;
  y: number;
  z: number;
  ry: number;
  /**
   * Skala per sumbu. RTG prosedural hanya memakai sz — portalnya memang dibangun
   * untuk diregangkan. Aset RTG memakai ketiganya sekaligus, karena model
   * bergeometri nyata tidak bisa diregangkan sesumbu tanpa menggepengkan kakinya.
   */
  sx?: number;
  sy?: number;
  sz?: number;
};


const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3(0, 1, 0);
const _s = new THREE.Vector3(1, 1, 1);

/** Satu draw call untuk seluruh unit alat berat sejenis. */
function InstancedProps({
  geometry,
  color,
  material,
  items,
}: {
  geometry: THREE.BufferGeometry;
  /** Dipakai kalau geometrinya prosedural dan belum punya material sendiri. */
  color?: string;
  /** Dipakai kalau geometrinya datang dari aset yang materialnya sudah jadi. */
  material?: THREE.Material;
  items: Placement[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const shadows = useYard((s) => s.options.shadows);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      _p.set(it.x, it.y, it.z);
      _q.setFromAxisAngle(_axis, it.ry);
      // Skala Z dipakai RTG: portalnya harus menaungi blok selebar apa pun.
      _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, invalidate]);

  if (items.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, items.length]}
      castShadow={shadows}
      receiveShadow={shadows}
    >
      {material ? null : <meshPhongMaterial color={color} shininess={20} />}
    </instancedMesh>
  );
}

/**
 * Kepala traktor dari aset GLB — satu instanced mesh per material.
 *
 * Asetnya punya 64 material, jadi ini 64 draw call untuk SELURUH truk berapa
 * pun jumlahnya. Itu murah: draw call biayanya di CPU, sementara hambatan
 * aplikasi ini ada di fill rate.
 */
function TruckHeads({ items }: { items: Placement[] }) {
  const gltf = useGLTF(TRUCK_MODEL_URL, false, false);
  const parts = useMemo(() => truckModelFor(gltf).parts20, [gltf]);
  return (
    <>
      {parts.map((part: ModelPart) => (
        <InstancedProps key={part.name} geometry={part.geometry} material={part.material} items={items} />
      ))}
    </>
  );
}

useGLTF.preload(TRUCK_MODEL_URL, false, false);

/**
 * Alat berat dari aset GLB — satu instanced mesh per material.
 *
 * Ketiganya dimuat lewat satu komponen karena perlakuannya sama persis: skala
 * dan warna asli, diturunkan ke tanah, di-instance per material.
 */
/**
 * RTG detail yang diam: rangka (dibangun per lebar blok), trolley + kabin di
 * tengah bentang, dan spreader kosong menggantung pada tinggi jelajah — posisi
 * yang sama dengan awal animasi RtgWorks, jadi tidak melompat saat mulai kerja.
 * Jumlahnya hanya beberapa unit, jadi mesh biasa (tanpa instancing) cukup.
 */
function RtgDetailProps({ items }: { items: (Placement & { railZ: number; variant: 1 | 2 })[] }) {
  // Lampu sorot RTG detail 2 ikut mode malam (juga yang sedang bekerja di
  // RtgWorks — materialnya sama).
  const night = useYard((s) => s.options.night);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    setRtgDetail2Night(night);
    invalidate();
  }, [night, invalidate]);
  return (
    <>
      {items.map((it, i) => {
        const m = (it.variant === 2 ? rtgDetail2Model : rtgDetailModel)(it.railZ);
        return (
          <group key={i} position={[it.x, 0, it.z]} rotation-y={it.ry}>
            {[...m.frame, ...m.trolley, ...m.ropes].map((p) => (
              <mesh key={p.name} geometry={p.geometry} material={p.material} dispose={null} />
            ))}
            <group position-y={RTG_DETAIL.restUnder}>
              {m.spreader.map((p) => (
                <mesh key={p.name} geometry={p.geometry} material={p.material} dispose={null} />
              ))}
            </group>
          </group>
        );
      })}
    </>
  );
}

/** Gudang: model prosedural per spesifikasi (di-cache per isian), lampu ikut mode malam. */
function WarehouseProps({ items }: { items: LayoutEquipment[] }) {
  const night = useYard((s) => s.options.night);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    setWarehouseNight(night);
    invalidate();
  }, [night, invalidate]);
  return (
    <>
      {items.map((it) => (
        <group key={it.id} position={[it.x, 0, it.z]} rotation-y={it.ry}>
          {warehouseModel(it.building).map((p) => (
            <mesh key={p.name} geometry={p.geometry} material={p.material} castShadow receiveShadow dispose={null} />
          ))}
        </group>
      ))}
    </>
  );
}

/** Pelat parkir alat (lajur kosong; alatnya ditaruh sendiri). */
function ParkingPads({ items }: { items: LayoutEquipment[] }) {
  return (
    <>
      {items.map((it) => (
        <group key={it.id} position={[it.x, 0, it.z]} rotation-y={it.ry}>
          {parkingModel(it.parking).map((p) => (
            <mesh key={p.name} geometry={p.geometry} material={p.material} castShadow={p.shadow !== false} receiveShadow dispose={null} />
          ))}
        </group>
      ))}
    </>
  );
}

/** Reach stacker: satu objek per unit (beberapa saja), boom dalam pose diam. */
function ReachStackerProps({ items }: { items: LayoutEquipment[] }) {
  const night = useYard((s) => s.options.night);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    setReachStackerNight(night);
    invalidate();
  }, [night, invalidate]);
  const objects = useMemo(
    () => items.map((it, i) => ({ it, obj: createReachStacker(it.code ?? `RS${String(i + 1).padStart(2, '0')}`) })),
    [items],
  );
  return (
    <>
      {objects.map(({ it, obj }) => (
        <primitive key={it.id} object={obj} position={[it.x, 0, it.z]} rotation-y={it.ry} dispose={null} />
      ))}
    </>
  );
}

function PropAsset({
  url,
  items,
  build,
}: {
  url: string;
  items: Placement[];
  build: (gltf: GLTF) => { parts20: ModelPart[] };
}) {
  // useGLTF bertipe union (bisa mengembalikan array untuk masukan array);
  // di sini url-nya selalu tunggal.
  const gltf = useGLTF(url, false, false) as unknown as GLTF;
  const parts = useMemo(() => build(gltf).parts20, [gltf, build]);
  if (items.length === 0) return null;
  return (
    <>
      {parts.map((part) => (
        <InstancedProps key={part.name} geometry={part.geometry} material={part.material} items={items} />
      ))}
    </>
  );
}

useGLTF.preload(ITV_MODEL_URL, false, false);
useGLTF.preload(RTG_CRANE_MODEL_URL, false, false);
useGLTF.preload(STS_MODEL_URL, false, false);

export function Equipment() {
  const data = useYardView();
  const { rtg, lamps, trucks, night } = useYard((s) => s.options);
  const layoutEquipment = useEditor((s) => s.layout?.equipment);
  // RTG yang sedang bekerja digambar RtgWorks dengan transform per frame;
  // di sini ia dikeluarkan supaya tidak tergambar dua kali.
  const busyRtg = useTraffic((s) => s.busyRtg);
  // RS yang sedang bekerja digambar bergerak oleh RsWorks, bukan di parkirnya.
  const busyRs = useRsWorks((s) => s.busy);
  // RTG yang selesai bekerja berdiri di bay terakhirnya (lihat RtgWorks).
  const rtgPark = useTraffic((s) => s.rtgPark);

  const geo = useMemo(
    () => ({
      rtg: createRtgGeometry(),
      spreader: createRtgSpreaderGeometry(),
      lamp: createLampGeometry(),
      // Kepala lampu yang menyala di malam hari: bola kecil tepat di bawah
      // dudukan lampu (puncak tiang 34,6 m). Material tanpa pencahayaan membuat
      // bolanya tampak berpendar sendiri tanpa menambah light ke scene.
      lampGlow: (() => {
        const g = new THREE.SphereGeometry(1.1, 10, 8);
        g.translate(0, 33.9, 0);
        return g;
      })(),
      chassis: createChassisGeometry(),
      load: createChassisLoadGeometry(),
      gate: createGateGeometry(),
      // Gate dua arus hanya memakai pos pemisah di tengah.
      gateMid: createGateGeometry('center'),
      gateSign: createGateSignGeometry('full'),
      gateSignIn: createGateSignGeometry('in'),
      gateSignOut: createGateSignGeometry('out'),
      lampGlowMat: new THREE.MeshBasicMaterial({ color: '#ffe3a1' }),
    }),
    [],
  );

  /**
   * Daftar alat: dari tata letak editor kalau ada, kalau tidak dibangkitkan.
   *
   * Keduanya berbentuk `LayoutEquipment` yang sama, jadi renderer tidak perlu
   * tahu mana yang sedang dipakai — dan tata letak awal editor bisa diisi
   * dengan pembangkit yang sama persis.
   */
  const placement = useMemo(() => {
    const blocks = data?.blocks ?? [];
    const items =
      layoutEquipment ??
      generateEquipment(
        blocks,
        data?.meta.extentX ?? YARD_EXTENT_X,
        data?.meta.extentZ ?? YARD_EXTENT_Z,
      );

    const rtgs: Placement[] = [];
    const spreaders: Placement[] = [];
    const truckList: Placement[] = [];
    const loadedList: Placement[] = [];
    const lampList: Placement[] = [];
    const itvList: Placement[] = [];
    const rtgAssetList: Placement[] = [];
    const rtgDetailList: (Placement & { railZ: number; variant: 1 | 2 })[] = [];
    const warehouseList: LayoutEquipment[] = [];
    const reachStackerList: LayoutEquipment[] = [];
    const parkingList: LayoutEquipment[] = [];
    const stsList: Placement[] = [];
    // Rangka gate sama untuk masuk dan keluar; yang membedakan cuma warna papan
    // namanya, jadi rangkanya satu daftar dan papan namanya dua.
    const gateList: Placement[] = [];
    const gateInSigns: Placement[] = [];
    const gateOutSigns: Placement[] = [];
    const gateMidList: Placement[] = [];
    const gateHalfIn: Placement[] = [];
    const gateHalfOut: Placement[] = [];

    for (const raw of items) {
      if ((raw.kind === 'rtg' || raw.kind === 'rtgAsset' || raw.kind === 'rtgDetail' || raw.kind === 'rtgDetail2') && busyRtg.includes(raw.id)) continue;
      const parked = rtgPark[raw.id];
      const it = parked !== undefined ? { ...raw, x: parked } : raw;
      if (it.kind === 'rtg') {
        // Bentang portal diambil dari blok terdekat, jadi RTG yang digeser ke
        // blok lain langsung menyesuaikan lebarnya sendiri.
        const sz = rtgScaleAt(blocks, it.z);
        rtgs.push({ x: it.x, y: 0, z: it.z, ry: it.ry, sz });
        // Spreader menggantung di bawah trolley, dan trolley ikut bergeser saat
        // portal melebar. Offsetnya diputar mengikuti rotasi RTG.
        const off = -RTG.offsetZ * sz;
        spreaders.push({
          x: it.x + Math.sin(it.ry) * off,
          y: 0,
          z: it.z + Math.cos(it.ry) * off,
          ry: it.ry,
        });
      } else if (it.kind === 'truck') {
        const place = { x: it.x, y: 0, z: it.z, ry: it.ry };
        truckList.push(place);
        if (it.loaded) loadedList.push(place);
      } else if (it.kind === 'itv') {
        itvList.push({ x: it.x, y: 0, z: it.z, ry: it.ry });
      } else if (it.kind === 'rtgAsset') {
        // Diperlakukan persis seperti RTG prosedural: bentangnya diambil dari
        // blok terdekat, jadi aset yang digeser ke blok lain langsung
        // menyesuaikan diri.
        const s = rtgAssetScaleAt(blocks, it.z);
        // Titik nol aset ada di sudut modelnya, bukan di sumbu portal. Tanpa
        // koreksi ini cranenya berdiri sembilan meter di samping titik yang
        // diklik. Offsetnya lokal, jadi ikut diputar oleh sudut asetnya sendiri.
        const lx = -RTG_ASSET.midX * s;
        const lz = -RTG_ASSET.midZ * s;
        const c = Math.cos(it.ry);
        const sn = Math.sin(it.ry);
        rtgAssetList.push({
          x: it.x + lx * c + lz * sn,
          y: 0,
          z: it.z - lx * sn + lz * c,
          ry: it.ry,
          sx: s,
          sy: s,
          sz: s,
        });
      } else if (it.kind === 'reachStacker') {
        if (!busyRs.includes(it.id)) reachStackerList.push(it);
      } else if (it.kind === 'warehouse') {
        warehouseList.push(it);
      } else if (it.kind === 'parking') {
        // Pelat lajur saja; alat yang diparkir ditaruh sendiri (tab Alat).
        parkingList.push(it);
      } else if (it.kind === 'rtgDetail' || it.kind === 'rtgDetail2') {
        // Bentang dari blok terdekat, seperti RTG lain.
        rtgDetailList.push({
          x: it.x,
          y: 0,
          z: it.z,
          ry: it.ry,
          railZ: rtgDetailRailZAt(blocks, it.z),
          variant: it.kind === 'rtgDetail2' ? 2 : 1,
        });
      } else if (it.kind === 'sts') {
        stsList.push({ x: it.x, y: 0, z: it.z, ry: it.ry });
      } else if (it.kind === 'gate') {
        // Dua arus di satu gate: papan hijau di separuh masuk, merah di separuh
        // keluar, dua-duanya di rangka yang sama.
        const place = { x: it.x, y: 0, z: it.z, ry: it.ry };
        gateMidList.push(place);
        gateHalfIn.push(place);
        gateHalfOut.push(place);
      } else if (it.kind === 'gateIn' || it.kind === 'gateOut') {
        const place = { x: it.x, y: 0, z: it.z, ry: it.ry };
        gateList.push(place);
        (it.kind === 'gateIn' ? gateInSigns : gateOutSigns).push(place);
      } else {
        lampList.push({ x: it.x, y: 0, z: it.z, ry: it.ry });
      }
    }

    return {
      rtgs,
      spreaders,
      lampList,
      truckList,
      loadedList,
      itvList,
      rtgAssetList,
      rtgDetailList,
      warehouseList,
      reachStackerList,
      parkingList,
      stsList,
      gateList,
      gateMidList,
      gateInSigns,
      gateOutSigns,
      gateHalfIn,
      gateHalfOut,
    };
  }, [data, layoutEquipment, busyRtg, rtgPark, busyRs]);

  return (
    <group>
      {rtg && (
        <>
          <InstancedProps geometry={geo.rtg} color="#3a6ea5" items={placement.rtgs} />
          {/* Spreader dipisah semata-mata karena warnanya beda — satu
              instanced mesh cuma bisa punya satu material. */}
          <InstancedProps geometry={geo.spreader} color="#d9741f" items={placement.spreaders} />
        </>
      )}
      {lamps && <InstancedProps geometry={geo.lamp} color="#6f7681" items={placement.lampList} />}
      {lamps && night && (
        <InstancedProps geometry={geo.lampGlow} material={geo.lampGlowMat} items={placement.lampList} />
      )}

      {/* Gate: rangka abu-abu bersama, papan nama hijau untuk masuk dan merah
          untuk keluar — dua-duanya terbaca dari pandangan atas. */}
      <InstancedProps geometry={geo.gate} color="#9aa3ad" items={placement.gateList} />
      <InstancedProps geometry={geo.gateMid} color="#9aa3ad" items={placement.gateMidList} />
      <InstancedProps geometry={geo.gateSign} color="#2f8f5b" items={placement.gateInSigns} />
      <InstancedProps geometry={geo.gateSign} color="#c0392b" items={placement.gateOutSigns} />
      <InstancedProps geometry={geo.gateSignIn} color="#2f8f5b" items={placement.gateHalfIn} />
      <InstancedProps geometry={geo.gateSignOut} color="#c0392b" items={placement.gateHalfOut} />
      {trucks && (
        <>
          {/* Chassis dan muatannya prosedural; kepala traktornya aset GLB.
              Ketiganya memakai daftar penempatan yang SAMA, jadi selalu
              menyatu tanpa perlu menyimpan offset di mana pun. */}
          <InstancedProps geometry={geo.chassis} color="#5b636e" items={placement.truckList} />
          <InstancedProps geometry={geo.load} color="#8c98a6" items={placement.loadedList} />
          <Suspense fallback={null}>
            <TruckHeads items={placement.truckList} />
          </Suspense>
        </>
      )}

      {/* Alat berat dari folder aset. Masing-masing dibungkus Suspense sendiri
          supaya satu unduhan yang lambat tidak menahan yang lain. */}
      <Suspense fallback={null}>
        <PropAsset url={ITV_MODEL_URL} items={placement.itvList} build={itvModelFor} />
      </Suspense>
      <Suspense fallback={null}>
        <PropAsset url={RTG_CRANE_MODEL_URL} items={placement.rtgAssetList} build={craneModelFor} />
      </Suspense>
      <Suspense fallback={null}>
        <PropAsset url={STS_MODEL_URL} items={placement.stsList} build={craneModelFor} />
      </Suspense>
      <RtgDetailProps items={placement.rtgDetailList} />
      <WarehouseProps items={placement.warehouseList} />
      <ParkingPads items={placement.parkingList} />
      <ReachStackerProps items={placement.reachStackerList} />
    </group>
  );
}
