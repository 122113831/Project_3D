'use client';

import { useEffect, useMemo } from 'react';
import { buildReeferRack, rackMaterials, type RackParts } from '@/lib/reeferRack';
import { blockCenter, laneSide } from '@/lib/yard';
import { useYardView } from '@/store/useYardView';

/**
 * Rak listrik reefer di setiap blok bertanda `reefer` (tab Block di editor).
 * Satu grup per blok, diputar dan dipindah seperti bloknya; geometrinya hanya
 * dibangun ulang saat ukuran/sisi lajur blok berubah, bukan saat isi
 * kontainernya berganti.
 */
export function ReeferRacks() {
  const data = useYardView();
  const blocks = useMemo(() => (data?.blocks ?? []).filter((b) => b.reefer), [data]);
  const shapeKey = blocks.map((b) => `${b.id}:${b.slots}x${b.rows}x${b.tiers}:${laneSide(b)}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dibangun ulang hanya saat BENTUK blok berubah
  const racks = useMemo(() => new Map(blocks.map((b) => [b.id, buildReeferRack(b.slots, b.rows, b.tiers, laneSide(b))])), [shapeKey]);
  useEffect(() => () => racks.forEach((r) => Object.values(r).forEach((g) => g.dispose())), [racks]);
  const mats = rackMaterials();

  return (
    <group>
      {blocks.map((b) => {
        const parts = racks.get(b.id);
        if (!parts) return null;
        const [cx, cz] = blockCenter(b);
        return (
          <group key={b.id} position={[cx, 0, cz]} rotation={[0, b.rot ?? 0, 0]}>
            {(Object.keys(parts) as (keyof RackParts)[]).map((k) => (
              <mesh key={k} geometry={parts[k]} material={mats[k]} castShadow receiveShadow />
            ))}
          </group>
        );
      })}
    </group>
  );
}
