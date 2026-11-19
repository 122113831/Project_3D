'use client';

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  APRON,
  LANE,
  PITCH,
  ROAD,
  ROAD_KINDS,
  YARD_EXTENT_X,
  YARD_EXTENT_Z,
  type RoadKind,
} from '@/lib/constants';
import {
  createLaneTexture,
  createRoadTileTexture,
  createSlotMarkingTexture,
} from '@/lib/geometry';
import type { LayoutRoad } from '@/lib/layout';
import { roadLen } from '@/lib/roadSnap';
import type { YardBlock } from '@/lib/types';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { aroundBlock, laneSide } from '@/lib/yard';

/**
 * Skala UV di tempat.
 *
 * Repeat tekstur biasanya diatur di material — tapi material dipakai bersama
 * semua blok, sedangkan blok di database depot ukurannya berbeda-beda (A 37x5,
 * B 39x11, C 31x5). Jadi repeat-nya dipanggang ke UV tiap blok, bukan ke
 * material, supaya satu petak marka tetap satu slot di blok mana pun.
 */
function scaleUv(g: THREE.BufferGeometry, u: number, v: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
  uv.needsUpdate = true;
}

/**
 * Sepetak tanah, siap diputar bersama bloknya.
 *
 * Urutannya penting: UV diskalakan saat petak masih sejajar sumbu, LALU
 * diputar, LALU digeser. Kebalikannya akan memutar UV juga, dan marka slotnya
 * ikut miring terhadap petaknya sendiri.
 */
function ground(length: number, width: number, x: number, y: number, z: number, rot = 0) {
  const g = new THREE.PlaneGeometry(length, width);
  g.rotateX(-Math.PI / 2);
  return {
    g,
    place: () => {
      if (rot !== 0) g.rotateY(rot);
      return g.translate(x, y, z);
    },
  };
}

/**
 * Alas blok + marka lorong.
 *
 * Digabung jadi dua geometry, bukan di-instance: begitu tiap blok punya ukuran
 * sendiri, satu geometry bersama tidak lagi cukup — dan menyimpan skala di
 * matriks instance akan ikut meregangkan marka slotnya. Jumlah bloknya puluhan,
 * jadi merge tetap 1 draw call per lapisan dengan vertex yang bisa diabaikan.
 */
function build(blocks: readonly YardBlock[], roads: readonly LayoutRoad[]) {
  const slabs: THREE.BufferGeometry[] = [];
  const lanes: THREE.BufferGeometry[] = [];

  // Ubin jalan dikelompokkan menurut jenisnya, karena tiap jenis punya
  // teksturnya sendiri — lurus, belokan, pertigaan, perempatan. UV bawaan
  // PlaneGeometry sudah 0..1, jadi satu tekstur menutupi tepat satu ubin dan
  // tidak ada skala yang perlu disetel.
  const tiles: Record<RoadKind, THREE.BufferGeometry[]> = {
    straight: [],
    corner: [],
    tee: [],
    cross: [],
  };
  for (const r of roads) {
    // Panjangnya bisa lebih pendek dari satu ubin — itu yang menutup celah di
    // antara blok yang panjangnya berbeda. Lebarnya tetap: badan jalan duduk di
    // tengah ubin dan tidak boleh ikut menyempit.
    const len = roadLen(r);
    const g = new THREE.PlaneGeometry(len, ROAD.tile);
    // UV diulang menurut panjangnya, BUKAN diregangkan: dengan diregangkan,
    // marka putus-putus sebuah potongan 6 m akan sepanjang marka potongan 24 m
    // dan sambungannya langsung terlihat palsu.
    if (len !== ROAD.tile) scaleUv(g, len / ROAD.tile, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(r.ry);
    // Sedikit di atas strip lorong (0,015) supaya ubin yang menimpanya menang
    // tanpa z-fighting.
    g.translate(r.x, 0.017, r.z);
    (tiles[r.kind] ?? tiles.straight).push(g);
  }

  for (const b of blocks) {
    const length = b.slots * PITCH.teu;
    const width = b.rows * PITCH.row;

    const rot = b.rot ?? 0;
    const [scx, scz] = aroundBlock(b, 0, 0);
    const slab = ground(length, width, scx, 0.02, scz, rot);
    // Satu petak marka per posisi slot — seukuran 20ft, sama seperti petak
    // di lapangan sungguhan. 40ft menutupi dua petak.
    scaleUv(slab.g, b.slots, b.rows);
    slabs.push(slab.place());

    // Strip lorong milik blok ini. Ubin marka panjangnya tetap, jadi repeat-nya
    // ikut panjang blok — bukan angka tetap. Lorongnya mengorbit pusat blok
    // saat bloknya diputar, bukan cuma berputar di tempat.
    //
    // Sisinya ditentukan TRUCK_LANE. Saat pindah ke seberang, strip-nya diputar
    // setengah lingkaran juga: tanpa itu pita lajur layanan yang sempit akan
    // berakhir di tepi terjauh, bukan menempel di kaki blok tempat truk
    // sebenarnya berhenti.
    const side = laneSide(b);
    // Blok tanpa jalan bawaan hanya membawa lajur layanan dan rel RTG-nya —
    // 8,2 m pertama dari tepi blok. Jalan dua arah di luarnya ubin terpisah.
    // Tekstur lorong tersusun dari tepi blok (v = 1) ke luar, jadi cukup
    // memotong rentang v-nya, bukan membuat tekstur kedua.
    const stripW = b.ownRoad === false ? LANE.road.from : LANE.width;
    const [lcx, lcz] = aroundBlock(b, 0, (side * (width + stripW)) / 2);
    const lane = ground(
      length,
      stripW,
      lcx,
      0.015,
      lcz,
      rot + (side < 0 ? Math.PI : 0),
    );
    if (stripW !== LANE.width) {
      const uv = lane.g.attributes.uv as THREE.BufferAttribute;
      const k = stripW / LANE.width;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (1 - uv.getY(i)) * k);
    }
    scaleUv(lane.g, length / LANE.tile, 1);
    lanes.push(lane.place());
  }

  const roadGeo = {} as Record<RoadKind, THREE.BufferGeometry | null>;
  for (const k of ROAD_KINDS) {
    roadGeo[k] = tiles[k].length ? mergeGeometries(tiles[k], false)! : null;
  }

  // Daftar KOSONG tidak boleh sampai ke mergeGeometries: ia membaca
  // geometries[0] tanpa memeriksa, dan lemparannya menjatuhkan seluruh kanvas.
  // Kosong itu kejadian biasa, bukan kasus aneh — tata letak dari localStorage
  // sudah ada sejak store dibuat, sementara data lapangan baru tiba setelah
  // kueri database selesai; di sela itu ada jalan tapi belum ada blok.
  return {
    slab: slabs.length ? mergeGeometries(slabs, false)! : null,
    lane: lanes.length ? mergeGeometries(lanes, false)! : null,
    roads: roadGeo,
  };
}

export function Ground() {
  const data = useYardView();
  const shadows = useYard((s) => s.options.shadows);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const textures = useMemo(() => {
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    // Tanpa .repeat: skalanya sudah ada di UV tiap blok.
    const roads = {} as Record<RoadKind, THREE.Texture>;
    for (const k of ROAD_KINDS) roads[k] = createRoadTileTexture(k, anisotropy);
    return {
      marking: createSlotMarkingTexture(anisotropy),
      lane: createLaneTexture(anisotropy),
      roads,
    };
  }, [gl]);

  const blocks = useMemo(() => data?.blocks ?? [], [data]);

  const roads = useEditor((s) => s.layout?.roads);
  const built = useMemo(
    () => (blocks.length || roads?.length ? build(blocks, roads ?? []) : null),
    [blocks, roads],
  );

  useEffect(() => {
    if (!built) return;
    invalidate();
    return () => {
      built.slab?.dispose();
      built.lane?.dispose();
      for (const k of ROAD_KINDS) built.roads[k]?.dispose();
    };
  }, [built, invalidate]);

  useEffect(() => {
    return () => {
      textures.marking.dispose();
      textures.lane.dispose();
    };
  }, [textures]);

  // Apron mengikuti luas lapangan yang sebenarnya. Lapangan depot jauh lebih
  // kecil daripada grid demo, dan apron sebesar konstanta lama akan membuatnya
  // tampak seperti tiga blok yang hilang di tengah aspal kosong.
  const extentX = data?.meta.extentX ?? YARD_EXTENT_X;
  const extentZ = data?.meta.extentZ ?? YARD_EXTENT_Z;
  // Lapangan dari database duduk di koordinat peta yang sebenarnya, jadi tidak
  // selalu di sekitar origin. Aspalnya mengikuti, bukan sebaliknya.
  const cx = data?.meta.centerX ?? 0;
  const cz = data?.meta.centerZ ?? 0;

  return (
    <group>
      {/* Aspal dasar */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, 0, cz]} receiveShadow={shadows}>
        <planeGeometry args={[extentX + APRON * 2, extentZ + APRON * 2]} />
        <meshLambertMaterial color="#8e9089" />
      </mesh>

      {/* Tanah di luar terminal, supaya horizon tidak kosong */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.4, cz]}>
        <planeGeometry args={[6000, 6000]} />
        <meshLambertMaterial color="#9a9079" />
      </mesh>

      {built && (
        <>
          {built.slab && (
            <mesh geometry={built.slab} receiveShadow={shadows}>
              <meshLambertMaterial map={textures.marking} />
            </mesh>
          )}
          {built.lane && (
            <mesh geometry={built.lane} receiveShadow={shadows}>
              <meshLambertMaterial map={textures.lane} />
            </mesh>
          )}
          {ROAD_KINDS.map((k) =>
            built.roads[k] ? (
              <mesh key={k} geometry={built.roads[k]!} receiveShadow={shadows}>
                <meshLambertMaterial
                  map={textures.roads[k]}
                  transparent
                  depthWrite={false}
                />
              </mesh>
            ) : null,
          )}
        </>
      )}
    </group>
  );
}
