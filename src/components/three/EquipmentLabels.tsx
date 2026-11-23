'use client';

import { useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { generateEquipment } from '@/lib/equipment';
import { equipmentLabels, type EquipmentLabel } from '@/lib/equipmentNames';
import { useEditor } from '@/store/useEditor';
import { useRsWorks } from '@/store/useRsWorks';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { workPose } from './trafficRegistry';

/**
 * Papan nama di atas tiap alat: kode alatnya (RS01, RTG02, …) dan jenisnya.
 *
 * Satu elemen DOM per alat — paling banyak beberapa puluh — dan ukurannya
 * tetap di layar seperti papan kapasitas blok. Alat yang sedang bekerja
 * (RTG berjalan, RS keluar dari parkir) diikuti tiap frame lewat pose di
 * trafficRegistry, jadi papannya ikut bergerak tanpa me-render ulang React.
 */
export function EquipmentLabels() {
  const data = useYardView();
  const enabled = useYard((s) => s.options.equipLabels);
  const layoutEquipment = useEditor((s) => s.layout?.equipment);

  const labels = useMemo(() => {
    if (!data) return [];
    const items =
      layoutEquipment ?? generateEquipment(data.blocks, data.meta.extentX ?? 0, data.meta.extentZ ?? 0);
    return equipmentLabels(items);
  }, [data, layoutEquipment]);

  if (!enabled || labels.length === 0) return null;
  return (
    <>
      {labels.map((l) => (
        <Label key={l.key} label={l} />
      ))}
    </>
  );
}

function Label({ label }: { label: EquipmentLabel }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    let x = label.x;
    let z = label.z;
    if (label.group === 'rs') {
      // RS yang bekerja: ikuti posisinya di lintasan.
      const job = Object.values(useRsWorks.getState().jobs).find((j) => j.unitKey === label.key);
      const p = job ? workPose(job.id) : null;
      if (p) {
        x = p.x;
        z = p.z;
      }
    } else if (label.group === 'rtg') {
      const { rtgJobs, rtgPark } = useTraffic.getState();
      const job = Object.values(rtgJobs).find((j) => j.rtgId === label.key && j.stage === 'working');
      const p = job ? workPose(job.id) : null;
      // RTG hanya berjalan di relnya (sumbu X); Z tetap di sumbu portal.
      x = p ? p.x : (rtgPark[label.key] ?? label.x);
    }
    if (g.position.x !== x || g.position.z !== z) g.position.set(x, label.y, z);
  });
  return (
    <group ref={ref} position={[label.x, label.y, label.z]}>
      <Html center zIndexRange={[4, 0]}>
        <div className="pointer-events-none flex select-none items-center gap-1 whitespace-nowrap rounded-md border border-amber-300/40 bg-slate-950/80 px-1.5 py-0.5 text-[11px] leading-none text-slate-100 shadow-lg">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span className="font-bold tracking-wide">{label.name}</span>
          <span className="text-[10px] text-slate-400">{label.type}</span>
        </div>
      </Html>
    </group>
  );
}
