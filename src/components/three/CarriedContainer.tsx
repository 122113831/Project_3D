'use client';

import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX } from '@/lib/constants';
import type { ModelPart } from '@/lib/containerModel';
import { isoFor } from '@/lib/containerCode';
import { createContainerGeometry } from '@/lib/geometry';
import { liveryKind } from '@/lib/livery';
import { colorFor } from '@/lib/palette';
import { realisticContainerModel } from '@/lib/realisticContainer';
import { realisticReeferModel } from '@/lib/realisticReefer';
import { realisticTankModel } from '@/lib/realisticTank';
import type { YardContainer } from '@/lib/types';
import { useLivery } from '@/store/useLivery';
import { useYard } from '@/store/useYard';
import { useCodedGeometry } from './useCodedGeometry';

/**
 * Kontainer yang SEDANG DIBAWA — tergantung di spreader RTG, atau di atas
 * chassis truk — digambar dengan aset yang SAMA dengan di tumpukan: model
 * realistis sesuai jenisnya (GP / reefer / tank), livery pemiliknya (prefix
 * → merek), nomor aslinya di badan, dan rona pewarnaan yang sama.
 *
 * Dulu yang tergambar kotak polos berwarna (RTG) atau kotak oranye 40ft yang
 * sama untuk semua truk, jadi kontainer seolah berganti rupa begitu diangkat.
 *
 * Titik nol grup = TENGAH kontainer (sama dengan penempatan di tumpukan);
 * pemanggil yang menggeser grupnya.
 */

/** Satu bagian model sebagai InstancedMesh 1 instance (nomor kontainer per instance). */
function Part({ part, codes, color }: { part: ModelPart; codes: { no: string; iso: string }[] | null; color: THREE.Color }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useCodedGeometry(part.geometry, part.material.userData.containerCode ? codes : null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    m.setMatrixAt(0, new THREE.Matrix4());
    m.instanceMatrix.needsUpdate = true;
    m.setColorAt(0, color);
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [geometry, color, invalidate]);
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, part.material, 1]}
      // Geometri & material milik bersama (cache model lapangan).
      dispose={null}
      frustumCulled={false}
    />
  );
}

/** Pilihan model + rona, aturan yang sama dengan lapisan kontainer lapangan. */
function useCarriedLook(c: YardContainer) {
  const colorMode = useYard((s) => s.colorMode);
  const real = useYard((s) => s.options.detail && s.options.containerStyle === 'real');
  const resolve = useLivery((s) => s.resolve);
  return useMemo(() => {
    const kind = liveryKind(c);
    const found = real ? resolve(c) : null;
    // Tank hanya memakai livery bermodel TANK; selain itu kotak polos.
    const livery = kind === 'TANK' ? (found?.model === 'TANK' ? found : null) : found;
    const plain = colorMode === 'none';
    const variant = plain ? 'plain' : 'tint';
    let parts: ModelPart[] | null = null;
    if (real) {
      if (kind === 'TANK') parts = livery ? realisticTankModel(variant, livery).parts20 : null;
      else {
        const model =
          kind === 'REEFER'
            ? realisticReeferModel(variant, livery ?? undefined)
            : realisticContainerModel(variant, livery ?? undefined);
        parts = c.size === 40 && model.parts40 ? model.parts40 : model.parts20;
      }
    }
    // Varian 'plain' sudah membawa cat aslinya: rona putih (pengali netral).
    const color = new THREE.Color(
      parts && plain ? '#ffffff' : colorFor(c, colorMode, real ? 'real' : 'asset', livery?.bodyColor),
    );
    return { parts, color };
  }, [c, colorMode, real, resolve]);
}

let boxCache: Record<number, THREE.BufferGeometry> | null = null;
const boxFor = (size: number) => {
  boxCache ??= { 20: createContainerGeometry(BOX.len20), 40: createContainerGeometry(BOX.len40) };
  return boxCache[size === 40 ? 40 : 20];
};

export const CarriedContainer = forwardRef<THREE.Group, { c: YardContainer; visible?: boolean }>(
  function CarriedContainer({ c, visible = true }, ref) {
    const { parts, color } = useCarriedLook(c);
    const codes = useMemo(() => [{ no: c.no, iso: isoFor(c) }], [c]);
    const mat = useMemo(() => new THREE.MeshPhongMaterial({ color, shininess: 14 }), [color]);
    useEffect(() => () => mat.dispose(), [mat]);
    return (
      <group ref={ref} visible={visible}>
        {parts ? (
          parts.map((p) => <Part key={p.name} part={p} codes={codes} color={color} />)
        ) : (
          // Gaya aset lama / detail mati: kotak berwarna seperti level jauh lapangan.
          <mesh geometry={boxFor(c.size)} material={mat} dispose={null} />
        )}
      </group>
    );
  },
);
