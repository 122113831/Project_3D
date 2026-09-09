'use client';

import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { BOX } from '@/lib/constants';
import { containerPosition } from '@/lib/yard';
import { findBlock, useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';

/** Kotak sorot + tiang penanda supaya kontainer terpilih kelihatan dari jauh. */
export function Selection() {
  const selected = useYard((s) => s.selected);
  const data = useYardView();

  // Hanya dua ukuran kontainer, jadi dua geometri outline dibuat sekali saja.
  const outlines = useMemo(() => {
    const make = (len: number) =>
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(len + 0.35, BOX.height + 0.35, BOX.width + 0.35),
      );
    return { 20: make(BOX.len20), 40: make(BOX.len40) } as Record<number, THREE.EdgesGeometry>;
  }, []);

  const info = useMemo(() => {
    if (!selected) return null;
    const block = findBlock(data, selected.block);
    if (!block) return null;
    return { pos: containerPosition(block, selected) };
  }, [selected, data]);

  if (!info || !selected) return null;

  const [x, y, z] = info.pos;

  return (
    <group>
      <lineSegments position={[x, y, z]} geometry={outlines[selected.size]}>
        <lineBasicMaterial color="#ffe066" />
      </lineSegments>

      <mesh position={[x, y + 26, z]}>
        <cylinderGeometry args={[0.16, 0.16, 48, 6]} />
        <meshBasicMaterial color="#ffe066" transparent opacity={0.55} />
      </mesh>

      <Html position={[x, y + 4.2, z]} center distanceFactor={90} zIndexRange={[6, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded-md border border-amber-300/60 bg-slate-950/85 px-2 py-1 text-[13px] font-semibold tracking-wide text-amber-200 shadow-lg">
          {selected.no}
        </div>
      </Html>
    </group>
  );
}
