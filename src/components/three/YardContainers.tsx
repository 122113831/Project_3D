'use client';

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX } from '@/lib/constants';
import {
  TARGET_LINEAR,
  containerModelFor,
  containerModelPlainFor,
  reeferModelPlainFor,
  tankModelPlainFor,
  CONTAINER_MODEL_URL,
  REEFER_MODEL_URL,
  reeferModelFor,
  TANK_MODEL_URL,
  tankModelFor,
  type InstancedModel,
  type ModelPart,
} from '@/lib/containerModel';
import {
  createContainerGeometry,
  createReeferGeometry,
  createTankGeometry,
} from '@/lib/geometry';
import { writeColors, writeMatrices } from '@/lib/instances';
import { isoFor } from '@/lib/containerCode';
import { useCodedGeometry } from './useCodedGeometry';

import { realisticContainerModel } from '@/lib/realisticContainer';
import { realisticReeferModel } from '@/lib/realisticReefer';
import { realisticTankModel } from '@/lib/realisticTank';
import { marksListeners } from '@/lib/realisticContainer';
import type { Livery } from '@/lib/livery';
import { useLivery } from '@/store/useLivery';
import type { YardBlock, YardContainer } from '@/lib/types';
import { useYard } from '@/store/useYard';
import { useEditor } from '@/store/useEditor';
import { useYardView } from '@/store/useYardView';
import { blockBounds, registerLod, updateLod } from './lodRegistry';
import { registerPickable } from './pickRegistry';

/**
 * Level jauh: geometri prosedural, ~200-320 segitiga per kontainer.
 *
 * Geometri dan material dipakai bersama oleh SEMUA blok, jadi GPU tidak
 * pernah berganti vertex buffer maupun program shader di antara blok —
 * pergantian state inilah yang mahal, bukan jumlah objeknya.
 */
function useFarAssets() {
  return useMemo(() => {
    const material = new THREE.MeshPhongMaterial({
      shininess: 14,
      specular: new THREE.Color('#20242a'),
    });
    // Disamakan dengan tingkat terang map LOD dekat.
    //
    // Map aset dinormalkan ke TARGET_LINEAR saat dimuat, sedangkan material ini
    // dulu dibiarkan putih. Akibatnya instanceColor yang sama menghasilkan
    // kontainer 18% lebih terang di kejauhan daripada di dekat, dan pergantian
    // LOD-nya terlihat berkedip. Dengan disamakan, satu warna berarti satu
    // kecerahan di kedua level detail.
    material.color.setRGB(TARGET_LINEAR, TARGET_LINEAR, TARGET_LINEAR, THREE.LinearSRGBColorSpace);
    const part = (name: string, geometry: THREE.BufferGeometry): ModelPart[] => [
      { name, geometry, material },
    ];
    return {
      gp20: part('box20', createContainerGeometry(BOX.len20)),
      gp40: part('box40', createContainerGeometry(BOX.len40)),
      reefer20: part('reefer20', createReeferGeometry(BOX.len20)),
      reefer40: part('reefer40', createReeferGeometry(BOX.len40)),
      tank20: part('tank20', createTankGeometry()),
    };
  }, []);
}

/**
 * Kelompok render sebuah kontainer.
 *
 * Reefer itu STATUS, bukan jenis — sebuah reefer tetap 20ft atau 40ft dan
 * tetap ikut mode pewarnaan seperti yang lain. Yang berbeda cuma asetnya.
 * Tank diperiksa lebih dulu karena jenisnya lebih menentukan bentuk.
 */
const kindOf = (c: YardContainer) =>
  c.type === 'tank' ? 'tank' : c.status === 'reefer' ? 'reefer' : 'gp';

type DetailSet = {
  container: InstancedModel;
  reefer: InstancedModel;
  tank: InstancedModel;
};

type DetailModels = {
  /** Dinormalkan abu-abu, siap diwarnai menurut line/status/ukuran. */
  tinted: DetailSet;
  /**
   * Cat aslinya apa adanya, dipakai saat pewarnaan dimatikan.
   *
   * null selama belum pernah dibutuhkan. Membangunnya menyalin geometri dan
   * memaksa tekstur asli aset ikut diunggah ke GPU — terukur 31 MB tambahan
   * untuk ketiga aset kontainer. Pengguna yang tidak pernah mematikan
   * pewarnaan tidak perlu membayarnya.
   */
  plain: DetailSet | null;
};

/** Level dekat: aset GLB, dipotong-potong sekali lalu di-instance. */
function useDetailModels(plainNeeded: boolean): DetailModels {
  // Draco/meshopt dimatikan: ketiga file tidak memakainya, dan mengaktifkannya
  // membuat drei menarik decoder dari CDN yang tidak pernah terpakai.
  const [container, reefer, tank] = useGLTF(
    [CONTAINER_MODEL_URL, REEFER_MODEL_URL, TANK_MODEL_URL],
    false,
    false,
  );
  const tinted = useMemo(
    () => ({
      container: containerModelFor(container),
      reefer: reeferModelFor(reefer),
      tank: tankModelFor(tank),
    }),
    [container, reefer, tank],
  );

  // Dibangun saat pertama kali dibutuhkan saja. Hasilnya di-cache di
  // containerModel, jadi menyalakan dan mematikan pewarnaan berulang kali tidak
  // membangunnya lagi.
  const plain = useMemo(
    () =>
      plainNeeded
        ? {
            container: containerModelPlainFor(container),
            reefer: reeferModelPlainFor(reefer),
            tank: tankModelPlainFor(tank),
          }
        : null,
    [plainNeeded, container, reefer, tank],
  );

  return useMemo(() => ({ tinted, plain }), [tinted, plain]);
}

useGLTF.preload([CONTAINER_MODEL_URL, REEFER_MODEL_URL, TANK_MODEL_URL], false, false);

type LayerProps = {
  block: YardBlock;
  items: YardContainer[];
  part: ModelPart;
  /** Hanya satu layer per group yang diraycast saat klik. */
  pickable?: boolean;
  /** Material lapisan ini sudah membawa cat aslinya sendiri. */
  ownColors?: boolean;
  /** Cat badan livery kelompok ini (level jauh, saat pewarnaan mati). */
  bodyPaint?: string;
};

function InstancedLayer({ block, items, part, pickable = false, ownColors = false, bodyPaint }: LayerProps) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  const colorMode = useYard((s) => s.colorMode);
  const filter = useYard((s) => s.filter);
  const selectedNo = useYard((s) => s.selected?.no ?? null);
  const shadows = useYard((s) => s.options.shadows);
  const paintStyle = useYard((s) => (s.options.detail ? s.options.containerStyle : 'asset'));

  // Kontainer realistis: geometri membawa NOMOR ASLI tiap kontainer sebagai
  // atribut instance, digambar shader di badannya. Atribut lain dibagi
  // dengan geometri aslinya, jadi buffer GPU-nya tidak berlipat.
  // (useCodedGeometry: aman terhadap efek ganda StrictMode — lihat di sana.)
  const codes = useMemo(
    () => (part.material.userData.containerCode ? items.map((c) => ({ no: c.no, iso: isoFor(c) })) : null),
    [part, items],
  );
  const geometry = useCodedGeometry(part.geometry, codes);

  // Matriks ditulis sekali. Posisi kontainer tidak pernah berubah, jadi buffer
  // ini di-upload ke GPU satu kali lalu tidak disentuh lagi.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    writeMatrices(mesh, block, items);
    invalidate();
    // geometry: ganti geometri = args berubah = R3F membuat mesh baru, yang
    // matriksnya masih kosong.
  }, [block, items, part, geometry, invalidate]);

  // Warna ditulis ulang saat mode warna / filter / seleksi berubah.
  // Ini buffer terpisah dari matriks, jadi ganti filter tidak menyentuh posisi.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    writeColors(mesh, items, colorMode, filter, selectedNo, ownColors, paintStyle, bodyPaint);
    invalidate();
  }, [items, part, geometry, colorMode, filter, selectedNo, ownColors, paintStyle, bodyPaint, invalidate]);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh || !pickable) return;
    return registerPickable({ mesh, block, items });
  }, [block, items, pickable, geometry]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, part.material, items.length]}
      // JANGAN biarkan R3F membuang geometri/material saat layer dilepas:
      // keduanya milik bersama (model di-cache untuk seluruh lapangan, dan
      // salinan berkode nomor berbagi buffer posisi/normal/UV). Dulu
      // pembuangan otomatis itu menghapus buffer bersama dari GPU setiap kali
      // satu layer dilepas — jendela detail ditutup, pewarnaan diganti, livery
      // dikelompokkan ulang — dan layer lain lalu tergambar HITAM. Salinan
      // berkode dibuang manual oleh disposeCodes di atas.
      dispose={null}
      castShadow={shadows}
      receiveShadow={shadows}
      // frustumCulled dibiarkan aktif: karena mesh dipecah per blok, blok yang
      // di luar layar tidak ikut dikirim ke GPU sama sekali.
    />
  );
}

type StackProps = {
  block: YardBlock;
  items: YardContainer[];
  far: ModelPart[];
  near: ModelPart[] | null;
  /** Material level dekat sudah membawa cat aslinya sendiri. */
  nearOwnColors?: boolean;
  /** Cat badan livery kelompok ini — level jauh memakainya saat pewarnaan mati. */
  bodyPaint?: string;
};

/**
 * Satu kelompok kontainer sejenis dalam satu blok, dengan dua level detail.
 *
 * Keduanya dibangun sekaligus dan hanya `visible`-nya yang ditukar. Alternatif
 * "ganti geometry saat kamera dekat" memaksa InstancedMesh dibuat ulang dan
 * seluruh matriks ditulis + di-upload lagi — persis saat kamera sedang
 * bergerak, yaitu saat frame budget paling sempit.
 */
function ContainerStack({ block, items, far, near, nearOwnColors = false, bodyPaint }: StackProps) {
  const farRef = useRef<THREE.Group>(null);
  const nearRef = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const farGroup = farRef.current;
    const nearGroup = nearRef.current;
    if (!farGroup || !nearGroup) return;
    invalidate();
    return registerLod({
      key: block.id,
      far: farGroup,
      near: nearGroup,
      bounds: blockBounds(block),
    });
  }, [block, near, invalidate]);

  if (items.length === 0) return null;

  // Model detail belum termuat, atau dimatikan user: satu level saja.
  if (!near) {
    return (
      <>
        {far.map((part) => (
          <InstancedLayer key={part.name} block={block} items={items} part={part} pickable bodyPaint={bodyPaint} />
        ))}
      </>
    );
  }

  return (
    <>
      {/* Layer jauh selalu ada di scene graph — picking meraycast mesh ini apa
          pun level yang sedang tampak, dan kotak sederhana jauh lebih murah
          diraycast daripada puluhan ribu segitiga per instance. */}
      <group ref={farRef}>
        {far.map((part) => (
          <InstancedLayer key={part.name} block={block} items={items} part={part} pickable bodyPaint={bodyPaint} />
        ))}
      </group>
      <group ref={nearRef} visible={false}>
        {near.map((part) => (
          <InstancedLayer
            key={part.name}
            block={block}
            items={items}
            part={part}
            ownColors={nearOwnColors}
          />
        ))}
      </group>
    </>
  );
}

/** Satu useFrame untuk seluruh lapangan, bukan satu per blok. */
function LodDriver() {
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ camera }) => {
    // frameloop="demand": kalau ada blok yang berganti level, minta satu
    // frame lagi supaya perubahannya benar-benar tergambar.
    if (updateLod(camera)) invalidate();
  });
  return null;
}

type Kind = 'gp' | 'reefer' | 'tank';
type Group = { key: string; kind: Kind; size: 20 | 40; livery: Livery | null; items: YardContainer[] };

function Blocks({ models, real }: { models: DetailModels | null; real: boolean }) {
  const data = useYardView();
  const far = useFarAssets();
  const resolve = useLivery((s) => s.resolve);

  // Saat pewarnaan dimatikan, level dekat memakai varian TANPA normalisasi:
  // cat asli asetnya sendiri, termasuk aset yang catnya lebih dari satu warna
  // seperti tank bertabung putih berangka biru. Level jauh tetap prosedural,
  // jadi ia menerima warna cat itu lewat instanceColor (lihat ASSET_COLOR).
  const apaAdanya = useYard((s) => s.colorMode) === 'none';
  // Kalau varian apa-adanya belum sempat dibangun, pakai yang bertint dulu —
  // lebih baik warnanya meleset satu frame daripada kontainernya hilang.
  const detail = models ? (apaAdanya ? (models.plain ?? models.tinted) : models.tinted) : null;
  const pakaiWarnaAset = apaAdanya && models?.plain != null;
  const useLiveries = real && models != null;

  // Kontainer dipisah per (jenis, ukuran) karena tiap kelompok punya geometri
  // sendiri, dan — untuk kontainer realistis — per LIVERY dari master
  // YARD_LIVERY (prefix nomor kontainer → merek), karena tiap merek punya
  // atlas marka dan cat sendiri. Tank tetap aset lamanya, tanpa livery.
  const split = useMemo(
    () =>
      (data?.blocks ?? []).map((block) => {
        const groups = new Map<string, Group>();
        for (const c of block.containers) {
          const kind = kindOf(c) as Kind;
          const size: 20 | 40 = kind === 'tank' ? 20 : c.size === 40 ? 40 : 20;
          // Tank hanya memakai livery bermodel TANK (tank realistis); tank
          // lain tetap aset GLB lamanya.
          const found = useLiveries ? resolve(c) : null;
          const livery = kind === 'tank' ? (found?.model === 'TANK' ? found : null) : found;
          const key = `${kind}${size}|${livery?.code ?? ''}`;
          const g = groups.get(key);
          if (g) g.items.push(c);
          else groups.set(key, { key, kind, size, livery, items: [c] });
        }
        return { block, groups: [...groups.values()] };
      }),
    [data, resolve, useLiveries],
  );

  const nearFor = (g: Group): ModelPart[] | null => {
    if (!detail) return null;
    if (useLiveries && g.kind === 'tank' && g.livery) {
      return realisticTankModel(apaAdanya ? 'plain' : 'tint', g.livery).parts20;
    }
    if (useLiveries && g.kind !== 'tank') {
      const variant = apaAdanya ? 'plain' : 'tint';
      const model =
        g.kind === 'gp'
          ? realisticContainerModel(variant, g.livery ?? undefined)
          : realisticReeferModel(variant, g.livery ?? undefined);
      return g.size === 40 ? model.parts40! : model.parts20;
    }
    const set = g.kind === 'gp' ? detail.container : g.kind === 'reefer' ? detail.reefer : detail.tank;
    return (g.size === 40 && set.parts40) || set.parts20;
  };

  return (
    <group>
      {split.map(({ block, groups }) => (
        <group key={block.id}>
          {groups.map((g) => {
            const realistic = useLiveries && (g.kind !== 'tank' || g.livery != null);
            return (
              <ContainerStack
                key={g.key}
                block={block}
                items={g.items}
                far={far[`${g.kind}${g.size}` as keyof typeof far]}
                near={nearFor(g)}
                nearOwnColors={realistic ? apaAdanya : pakaiWarnaAset}
                bodyPaint={realistic ? g.livery?.bodyColor : undefined}
              />
            );
          })}
        </group>
      ))}
    </group>
  );
}

function DetailedBlocks() {
  const plainNeeded = useYard((s) => s.colorMode) === 'none';
  const real = useYard((s) => s.options.containerStyle) === 'real';
  return <Blocks models={useDetailModels(plainNeeded)} real={real} />;
}

export function YardContainers() {
  const detail = useYard((s) => s.options.detail);
  // Editor terbuka: kontainer disembunyikan supaya kisi slot dan alat
  // terlihat. Disembunyikan lewat `visible`, bukan dilepas dari scene —
  // melepasnya berarti mengunggah ulang seluruh matriks instance saat editor
  // ditutup, dan di lapangan demo itu terasa.
  const editing = useEditor((s) => s.open);
  const invalidate = useThree((s) => s.invalidate);

  // Master livery (prefix → merek) dimuat sekali; logo berkas yang selesai
  // dimuat belakangan meminta satu frame baru (frameloop "demand").
  useEffect(() => {
    void useLivery.getState().load();
    marksListeners.add(invalidate);
    return () => {
      marksListeners.delete(invalidate);
    };
  }, [invalidate]);

  return (
    <group visible={!editing}>
      <LodDriver />
      {detail ? (
        // Selama kedua GLB masih diunduh, lapangan sudah tampil penuh dengan
        // geometri prosedural — tidak ada layar kosong.
        <Suspense fallback={<Blocks models={null} real={false} />}>
          <DetailedBlocks />
        </Suspense>
      ) : (
        <Blocks models={null} real={false} />
      )}
    </group>
  );
}
