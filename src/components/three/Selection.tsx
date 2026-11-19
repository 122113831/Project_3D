'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX } from '@/lib/constants';
import { containerPosition } from '@/lib/yard';
import { findBlock, useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';

/** Lama kotak hasil pencarian berdenyut sebelum diam (detik). */
const PULSE_SECONDS = 12;

/**
 * Penanda kontainer HASIL PENCARIAN: kotak kuning tembus pandang (tidak
 * tertutup tumpukan di depannya, jadi kontainer di tengah blok tetap
 * kelihatan) yang berdenyut beberapa detik, garis tepi, tiang dari langit,
 * cincin di tanah, dan label lokasi.
 *
 * Denyutnya berhenti sendiri: lapangan memakai frameloop="demand", dan
 * berdenyut terus berarti menggambar ulang tiap frame selamanya.
 */
function LocateMarker() {
  const located = useYard((s) => s.located);
  const data = useYardView();
  const invalidate = useThree((s) => s.invalidate);
  const fill = useRef<THREE.MeshBasicMaterial>(null);
  const edge = useRef<THREE.LineBasicMaterial>(null);
  const box = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const t0 = useRef(0);

  const pos = useMemo(() => {
    if (!located) return null;
    const block = findBlock(data, located.block);
    if (!block) return null;
    // Label kecil TEPAT di atas kotaknya. Label HTML selalu digambar di atas
    // scene, jadi tidak perlu dinaikkan melewati tumpukan — dinaikkan justru
    // memisahkannya dari kotak yang ditunjuk (dan keluar layar dari dekat).
    const at = containerPosition(block, located);
    return { at, labelY: at[1] + BOX.height / 2 + 1.1 };
  }, [located, data]);

  useEffect(() => {
    t0.current = performance.now();
    invalidate();
  }, [located, invalidate]);

  useFrame(() => {
    if (!located || !fill.current || !edge.current || !box.current || !ring.current) return;
    const t = (performance.now() - t0.current) / 1000;
    const live = t < PULSE_SECONDS;
    // Denyut 1,2 Hz yang meluruh ke keadaan diam yang tetap terlihat.
    const k = live ? 0.5 + 0.5 * Math.sin(t * Math.PI * 2.4) : 0.5;
    fill.current.opacity = 0.18 + 0.22 * k;
    edge.current.opacity = 0.65 + 0.35 * k;
    const sc = 1 + (live ? 0.06 * k : 0);
    box.current.scale.setScalar(sc);
    const r = live ? 1 + (t % 1.4) / 1.4 : 1.5;
    ring.current.scale.set(r, r, 1);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = live ? 0.7 * (1 - (t % 1.4) / 1.4) : 0.35;
    if (live) invalidate();
  });

  const geo = useMemo(() => {
    if (!located) return null;
    const len = located.size === 40 ? BOX.len40 : BOX.len20;
    const b = new THREE.BoxGeometry(len + 0.5, BOX.height + 0.5, BOX.width + 0.5);
    return { box: b, edges: new THREE.EdgesGeometry(b), radius: len * 0.75 };
  }, [located]);
  useEffect(() => () => {
    geo?.box.dispose();
    geo?.edges.dispose();
  }, [geo]);

  if (!located || !pos || !geo) return null;
  const [x, y, z] = pos.at;

  return (
    <group>
      <group ref={box} position={[x, y, z]}>
        {/* depthTest mati + renderOrder tinggi: terlihat menembus tumpukan. */}
        <mesh geometry={geo.box} renderOrder={20}>
          <meshBasicMaterial ref={fill} color="#ffd43b" transparent opacity={0.3} depthTest={false} depthWrite={false} />
        </mesh>
        <lineSegments geometry={geo.edges} renderOrder={21}>
          <lineBasicMaterial ref={edge} color="#fff3bf" transparent opacity={1} depthTest={false} />
        </lineSegments>
      </group>

      {/* Cincin di tanah yang memancar: menunjuk letak tumpukan dari jauh. */}
      <mesh ref={ring} position={[x, 0.08, z]} rotation-x={-Math.PI / 2} renderOrder={19}>
        <ringGeometry args={[geo.radius, geo.radius + 0.6, 48]} />
        <meshBasicMaterial color="#ffd43b" transparent opacity={0.5} depthWrite={false} />
      </mesh>

      <mesh position={[x, y + 30, z]}>
        <cylinderGeometry args={[0.22, 0.22, 56, 6]} />
        <meshBasicMaterial color="#ffd43b" transparent opacity={0.6} />
      </mesh>

      <Html position={[x, pos.labelY, z]} center distanceFactor={45} zIndexRange={[7, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded-md border border-amber-300/70 bg-slate-950/90 px-2.5 py-1 text-center shadow-lg">
          <div className="text-[13px] font-semibold tracking-wide text-amber-200">{located.no}</div>
          <div className="text-[10px] text-slate-300">
            {located.block} · bay {located.bay + 1} · row {located.row + 1} · tier {located.tier}
          </div>
        </div>
      </Html>
    </group>
  );
}

/** Kotak sorot + tiang penanda supaya kontainer terpilih kelihatan dari jauh. */
export function Selection() {
  return (
    <>
      <SelectedMarker />
      <LocateMarker />
    </>
  );
}

function SelectedMarker() {
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

  const located = useYard((s) => s.located);
  const info = useMemo(() => {
    if (!selected) return null;
    const block = findBlock(data, selected.block);
    if (!block) return null;
    return { pos: containerPosition(block, selected) };
  }, [selected, data]);

  // Kontainer yang sama sudah ditandai penanda pencarian: jangan dobel.
  if (!info || !selected || located?.no === selected.no) return null;

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
