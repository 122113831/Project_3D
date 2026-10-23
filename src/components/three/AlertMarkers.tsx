'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, DWELL_ALERT_DAYS } from '@/lib/constants';
import { STATUS_COLOR } from '@/lib/palette';
import type { YardContainer } from '@/lib/types';
import { containerPosition } from '@/lib/yard';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';

/**
 * Penanda berdenyut di atas kontainer yang perlu perhatian: barang berbahaya,
 * rusak, dan yang sudah terlalu lama di lapangan (lewat DWELL_ALERT_DAYS).
 *
 * Tiga InstancedMesh, satu per warna — ratusan penanda tetap tiga draw call.
 * Denyutnya tidak menyentuh matriks instance: yang berubah hanya opacity
 * material, satu uniform per frame. Itu sebabnya ratusan penanda yang
 * berkedip tidak terasa di GPU, dan hanya meminta frame baru selama penanda
 * memang ditampilkan.
 */

type Kind = 'dangerous' | 'damaged' | 'overdue';
const COLOR: Record<Kind, string> = {
  dangerous: STATUS_COLOR.dangerous,
  damaged: STATUS_COLOR.damaged,
  overdue: '#f4c430',
};
const MAX = 4000;

/** Umur kontainer di lapangan, hari, dari tanggal masuk ISO. */
const ageDays = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : 0;
};

const kindOf = (c: YardContainer): Kind | null =>
  c.dangerous ? 'dangerous' : c.damaged ? 'damaged' : ageDays(c.inDate) > DWELL_ALERT_DAYS ? 'overdue' : null;

function Layer({ kind, items }: { kind: Kind; items: { x: number; y: number; z: number; rot: number }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    // Kerucut terbalik yang melayang di atas tumpukan, menunjuk ke bawah.
    const g = new THREE.ConeGeometry(0.75, 1.6, 6);
    g.rotateX(Math.PI);
    g.translate(0, 0.8, 0);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const s = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const n = Math.min(items.length, MAX);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      p.set(it.x, it.y, it.z);
      q.setFromAxisAngle(up, it.rot);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, m, p, q, s, up]);

  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, MAX]} frustumCulled={false}>
      <meshBasicMaterial color={COLOR[kind]} transparent opacity={0.9} depthWrite={false} />
    </instancedMesh>
  );
}

export function AlertMarkers() {
  // Ikut sembunyi bersama kontainernya saat editor terbuka.
  const editing = useEditor((s) => s.open);
  const enabled = useYard((s) => s.options.alerts) && !editing;
  const data = useYardView();
  const invalidate = useThree((s) => s.invalidate);
  const group = useRef<THREE.Group>(null);

  const layers = useMemo(() => {
    const out: Record<Kind, { x: number; y: number; z: number; rot: number }[]> = {
      dangerous: [],
      damaged: [],
      overdue: [],
    };
    if (!enabled || !data) return out;
    for (const b of data.blocks) {
      // Hanya kontainer TERATAS di tiap tumpukan yang diberi penanda: penanda
      // di tier bawah akan tersembunyi di dalam kontainer di atasnya.
      const top = new Map<string, YardContainer>();
      for (const c of b.containers) {
        const key = `${c.bay}:${c.row}`;
        const cur = top.get(key);
        if (!cur || c.tier > cur.tier) top.set(key, c);
      }
      // Tapi kondisinya diambil dari SELURUH tumpukan: tumpukan yang ada satu
      // saja kontainer berbahaya di dalamnya tetap ditandai.
      const worst = new Map<string, Kind>();
      const rank: Record<Kind, number> = { dangerous: 3, damaged: 2, overdue: 1 };
      for (const c of b.containers) {
        const k = kindOf(c);
        if (!k) continue;
        const key = `${c.bay}:${c.row}`;
        const cur = worst.get(key);
        if (!cur || rank[k] > rank[cur]) worst.set(key, k);
      }
      for (const [key, k] of worst) {
        const c = top.get(key);
        if (!c) continue;
        const [x, y, z] = containerPosition(b, c);
        out[k].push({ x, y: y + BOX.height / 2 + 1.2, z, rot: b.rot ?? 0 });
      }
    }
    return out;
  }, [data, enabled]);

  // Denyut: opacity naik-turun pelan, serempak untuk semua penanda.
  //
  // Lewat interval 8 Hz, BUKAN useFrame. Lapangan memakai frameloop="demand"
  // dan diam saat tidak ada yang berubah; useFrame yang memanggil invalidate
  // tiap frame akan membatalkan itu dan membuat GPU bekerja terus hanya untuk
  // penanda yang berkedip. Delapan pembaruan per detik sudah terlihat halus.
  //
  // Hanya opacity yang berubah. Menskalakan grup akan menggeser penanda yang
  // jauh dari titik nol dunia, bukan mengembang-kempiskannya di tempat.
  const any = layers.dangerous.length + layers.damaged.length + layers.overdue.length > 0;
  useEffect(() => {
    if (!enabled || !any) return;
    const t0 = performance.now();
    const h = setInterval(() => {
      const g = group.current;
      if (!g) return;
      const k = 0.75 + 0.25 * Math.sin(((performance.now() - t0) / 1000) * 3.2);
      g.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
        if (mat && 'opacity' in mat) mat.opacity = 0.55 + 0.4 * k;
      });
      invalidate();
    }, 125);
    return () => clearInterval(h);
  }, [enabled, any, invalidate]);

  if (!enabled) return null;
  return (
    <group ref={group}>
      <Layer kind="dangerous" items={layers.dangerous} />
      <Layer kind="damaged" items={layers.damaged} />
      <Layer kind="overdue" items={layers.overdue} />
    </group>
  );
}

