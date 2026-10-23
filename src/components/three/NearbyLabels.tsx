'use client';

import { useMemo, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { containerPosition } from '@/lib/yard';
import type { YardContainer } from '@/lib/types';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';

/** Batas LOD label — angka kecil ini yang menjaga overlay tetap murah. */
const SHOW_WITHIN = 85;
const MAX_LABELS = 24;
const RECOMPUTE_EVERY = 0.15; // detik

type Tagged = { c: YardContainer; pos: THREE.Vector3 };

/**
 * Nomor kontainer untuk tumpukan teratas di sekitar kamera.
 *
 * Membuat label untuk SEMUA kontainer adalah cara paling cepat membunuh
 * halaman ini — 20.000 elemen DOM jauh lebih berat daripada 20.000 kotak di
 * GPU. Jadi label hanya muncul saat kamera sudah dekat, dibatasi 36 buah,
 * dan daftarnya dihitung ulang paling cepat 150 ms sekali.
 */
export function NearbyLabels() {
  const data = useYardView();
  const editing = useEditor((s) => s.open);
  const enabled = useYard((s) => s.options.labels) && !editing;
  const [visible, setVisible] = useState<Tagged[]>([]);
  const acc = useRef(0);

  // Hanya kontainer paling atas di tiap tumpukan yang layak diberi label.
  const tops = useMemo(() => {
    if (!data) return [] as Tagged[];
    const out: Tagged[] = [];
    for (const block of data.blocks) {
      const maxTier = new Map<string, number>();
      for (const c of block.containers) {
        const k = `${c.bay}:${c.row}`;
        if ((maxTier.get(k) ?? 0) < c.tier) maxTier.set(k, c.tier);
      }
      for (const c of block.containers) {
        if (maxTier.get(`${c.bay}:${c.row}`) !== c.tier) continue;
        const [x, y, z] = containerPosition(block, c);
        out.push({ c, pos: new THREE.Vector3(x, y, z) });
      }
    }
    return out;
  }, [data]);

  useFrame((state, dt) => {
    if (!enabled) {
      if (visible.length) setVisible([]);
      return;
    }
    acc.current += dt;
    if (acc.current < RECOMPUTE_EVERY) return;
    acc.current = 0;

    const cam = state.camera.position;
    const near: Tagged[] = [];
    for (const t of tops) {
      if (t.pos.distanceToSquared(cam) < SHOW_WITHIN * SHOW_WITHIN) {
        near.push(t);
        if (near.length > MAX_LABELS * 3) break;
      }
    }
    near.sort((a, b) => a.pos.distanceToSquared(cam) - b.pos.distanceToSquared(cam));
    const next = near.slice(0, MAX_LABELS);

    const changed =
      next.length !== visible.length || next.some((t, i) => t.c.no !== visible[i]?.c.no);
    if (changed) setVisible(next);
  });

  if (!enabled) return null;

  return (
    <>
      {visible.map(({ c, pos }) => (
        <Html
          key={c.no}
          position={[pos.x, pos.y + 1.7, pos.z]}
          center
          distanceFactor={52}
          zIndexRange={[2, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap rounded bg-slate-950/70 px-1.5 py-0.5 text-[11px] font-medium text-slate-100">
            {c.no}
          </div>
        </Html>
      ))}
    </>
  );
}
