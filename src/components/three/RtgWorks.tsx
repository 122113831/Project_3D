'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, PITCH, RTG, RTG_ASSET, rtgAssetScale, rtgSpanScale } from '@/lib/constants';
import { craneModelFor, RTG_CRANE_MODEL_URL, type ModelPart } from '@/lib/containerModel';
import { generateEquipment } from '@/lib/equipment';
import {
  createContainerGeometry,
  createRtgGeometry,
  createRtgSpreaderGeometry,
  SPREADER_Y,
} from '@/lib/geometry';
import type { LayoutEquipment } from '@/lib/layout';
import { colorFor } from '@/lib/palette';
import type { YardBlock } from '@/lib/types';
import { containerPosition } from '@/lib/yard';
import { useEditor } from '@/store/useEditor';
import { useTraffic, type RtgJob } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';

/**
 * RTG yang benar-benar bekerja: menjemput kontainer dari truk yang menunggu
 * dan menaruhnya di slotnya (bongkar), atau sebaliknya (ambil).
 *
 * Alurnya meniru RTG sungguhan, dalam enam langkah yang masing-masing punya
 * durasi sendiri: portal BERJALAN sepanjang blok ke bay tujuan → trolley
 * bergeser dan spreader TURUN ke sumber → kontainer TERANGKAT → trolley
 * MEMBAWA ke tujuan → spreader TURUN lagi → kontainer DILEPAS, spreader naik.
 *
 * Pada saat terangkat dan dilepas, data lapangan DITAMBAL: kontainer bongkar
 * muncul di tumpukan tepat ketika spreader melepasnya, kontainer ambil hilang
 * dari tumpukan tepat ketika terangkat. Itulah yang membuat tumpukan berubah
 * mengikuti kejadian tanpa memuat ulang lapangan.
 *
 * RTG yang sedang bekerja dikeluarkan dari instancing statis (lihat
 * Equipment) dan digambar di sini dengan transform yang berubah tiap frame.
 * Blok tanpa RTG tetap dilayani — kontainernya berpindah setelah jeda yang
 * sama, hanya tanpa alat yang terlihat.
 */

/** Kecepatan jalan portal, m/detik, sebelum pengali kecepatan HUD. */
const GANTRY_SPEED = 3;

/** Ketinggian alas spreader saat membawa muatan — harus di atas tumpukan tier 5 (13,07 m). */
const CRUISE_UNDERSIDE = RTG.height - 2.2;

/** Alas kontainer yang duduk di atas dek chassis (lihat createChassisLoadGeometry). */
const TRUCK_DECK_TOP = 1.45;

type Base =
  | { kind: 'rtg'; id: string; x: number; z: number; ry: number; sz: number }
  | { kind: 'rtgAsset'; id: string; x: number; z: number; ry: number; s: number };

type Anim = {
  job: RtgJob;
  base: Base | null;
  /** Detik sejak mulai, sudah dikali kecepatan. */
  t: number;
  /** Batas waktu tiap langkah, kumulatif. */
  steps: number[];
  gx0: number;
  gx1: number;
  /** Titik sumber dan tujuan muatan: (z, puncak kontainer). */
  src: { z: number; top: number };
  dst: { z: number; top: number };
  lifted: boolean;
  placed: boolean;
};

const smooth = (t: number) => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/** Blok terdekat pada sumbu Z — aturan yang sama dengan skala RTG di Equipment. */
function nearestBlock(blocks: readonly YardBlock[], z: number): YardBlock | null {
  let best: YardBlock | null = null;
  let d = Infinity;
  for (const b of blocks) {
    const c = b.originZ + (b.rows * PITCH.row) / 2;
    if (Math.abs(c - z) < d) {
      d = Math.abs(c - z);
      best = b;
    }
  }
  return best;
}

function planSteps(a: Omit<Anim, 'steps' | 't' | 'lifted' | 'placed'>): number[] {
  const travel = Math.max(0.4, Math.abs(a.gx1 - a.gx0) / GANTRY_SPEED);
  const d = [travel, 1.8, 0.4, 1.2, 1.6, 1.5, 0.4, 1.0];
  const out: number[] = [];
  let s = 0;
  for (const v of d) out.push((s += v));
  return out;
}

/** Posisi spreader (x, z, alas) dan apakah muatan sedang menggantung, pada waktu t. */
function poseAt(a: Anim) {
  const [tTravel, tToSrc, tGrab, tHoist, tCarry, tLower, tRelease, tRaise] = a.steps;
  const t = a.t;
  const seg = (from: number, to: number) => smooth((t - from) / Math.max(1e-6, to - from));
  const gx = a.gx0 + (a.gx1 - a.gx0) * seg(0, tTravel);
  const srcTop = a.src.top;
  const dstTop = a.dst.top;
  const srcUnder = srcTop + (a.job.flow === 'R' ? 0 : BOX.height);
  // Alas spreader berada di puncak kontainer saat menjepit: untuk sumber truk
  // puncaknya = dek + tinggi kontainer; untuk sumber tumpukan sudah termasuk.
  const srcHang = a.job.flow === 'R' ? srcTop + BOX.height : srcUnder;
  const dstHang = dstTop + BOX.height;

  let z = a.src.z;
  let under = CRUISE_UNDERSIDE;
  let carrying = false;
  if (t < tTravel) {
    z = a.src.z;
    under = CRUISE_UNDERSIDE;
  } else if (t < tToSrc) {
    const k = seg(tTravel, tToSrc);
    z = a.src.z;
    under = CRUISE_UNDERSIDE + (srcHang - CRUISE_UNDERSIDE) * k;
  } else if (t < tGrab) {
    z = a.src.z;
    under = srcHang;
  } else if (t < tHoist) {
    const k = seg(tGrab, tHoist);
    z = a.src.z;
    under = srcHang + (CRUISE_UNDERSIDE - srcHang) * k;
    carrying = true;
  } else if (t < tCarry) {
    const k = seg(tHoist, tCarry);
    z = a.src.z + (a.dst.z - a.src.z) * k;
    under = CRUISE_UNDERSIDE;
    carrying = true;
  } else if (t < tLower) {
    const k = seg(tCarry, tLower);
    z = a.dst.z;
    under = CRUISE_UNDERSIDE + (dstHang - CRUISE_UNDERSIDE) * k;
    carrying = true;
  } else if (t < tRelease) {
    z = a.dst.z;
    under = dstHang;
  } else {
    const k = seg(tRelease, tRaise);
    z = a.dst.z;
    under = dstHang + (CRUISE_UNDERSIDE - dstHang) * k;
  }
  return { gx, z, under, carrying, grabbed: t >= tGrab, released: t >= tRelease, done: t >= tRaise };
}

/** Aset RTG sebagai mesh biasa, untuk unit yang sedang bergerak. */
function AssetCrane({ parts, s }: { parts: ModelPart[]; s: number }) {
  return (
    <group scale={s} position={[-RTG_ASSET.midX * s, 0, -RTG_ASSET.midZ * s]}>
      {parts.map((p) => (
        <mesh key={p.name} geometry={p.geometry} material={p.material} />
      ))}
    </group>
  );
}

function Works() {
  const data = useYardView();
  const layoutEquipment = useEditor((s) => s.layout?.equipment);
  const jobs = useTraffic((s) => s.rtgJobs);
  const colorMode = useYard((s) => s.colorMode);
  const invalidate = useThree((s) => s.invalidate);

  const gltf = useGLTF(RTG_CRANE_MODEL_URL, false, false);
  const assetParts = useMemo(() => craneModelFor(gltf).parts20, [gltf]);
  const geo = useMemo(
    () => ({
      rtg: createRtgGeometry(),
      spreader: createRtgSpreaderGeometry(),
      box20: createContainerGeometry(BOX.len20),
      box40: createContainerGeometry(BOX.len40),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      rtg: new THREE.MeshPhongMaterial({ color: '#3a6ea5', shininess: 20 }),
      spreader: new THREE.MeshPhongMaterial({ color: '#d9741f', shininess: 20 }),
    }),
    [],
  );

  /** RTG yang tersedia, dengan blok yang dilayaninya. */
  const cranes = useMemo(() => {
    const blocks = data?.blocks ?? [];
    const items: LayoutEquipment[] =
      layoutEquipment ??
      generateEquipment(blocks, data?.meta.extentX ?? 0, data?.meta.extentZ ?? 0);
    const out: { base: Base; blockId: string }[] = [];
    for (const it of items) {
      if (it.kind !== 'rtg' && it.kind !== 'rtgAsset') continue;
      const b = nearestBlock(blocks, it.z);
      if (!b) continue;
      const width = b.rows * PITCH.row;
      out.push({
        blockId: b.id,
        base:
          it.kind === 'rtg'
            ? { kind: 'rtg', id: it.id, x: it.x, z: it.z, ry: it.ry, sz: rtgSpanScale(width) }
            : { kind: 'rtgAsset', id: it.id, x: it.x, z: it.z, ry: it.ry, s: rtgAssetScale(width) },
      });
    }
    return out;
  }, [data, layoutEquipment]);

  const anims = useRef(new Map<string, Anim>());
  const nodes = useRef(new Map<string, { crane: THREE.Group | null; spreader: THREE.Mesh | null; load: THREE.Mesh | null }>());

  // --- klaim pekerjaan baru ---------------------------------------------------
  useEffect(() => {
    const { claimJob } = useTraffic.getState();
    const busy = new Set(useTraffic.getState().busyRtg);
    for (const job of Object.values(jobs)) {
      if (job.stage !== 'queued' || anims.current.has(job.id)) continue;
      const block = data?.blocks.find((b) => b.id === job.blockId);
      if (!block) continue;

      // RTG terdekat ke bay yang melayani blok ini dan sedang bebas.
      let pick: { base: Base; blockId: string } | null = null;
      let best = Infinity;
      const [sx, sy, sz] = containerPosition(block, job.container);
      for (const c of cranes) {
        if (c.blockId !== job.blockId || busy.has(c.base.id)) continue;
        const d = Math.abs(c.base.x - sx);
        if (d < best) {
          best = d;
          pick = c;
        }
      }
      // Ada RTG di blok ini tapi semuanya sibuk: tunggu giliran.
      if (!pick && cranes.some((c) => c.blockId === job.blockId)) continue;

      const slotTop = sy - BOX.height / 2;
      const truckTop = TRUCK_DECK_TOP;
      const src = job.flow === 'R' ? { z: job.truck.z, top: truckTop } : { z: sz, top: slotTop };
      const dst = job.flow === 'R' ? { z: sz, top: slotTop } : { z: job.truck.z, top: truckTop };
      const partial = { job, base: pick?.base ?? null, gx0: pick?.base.x ?? sx, gx1: sx, src, dst };
      anims.current.set(job.id, { ...partial, steps: planSteps(partial), t: 0, lifted: false, placed: false });
      claimJob(job.id, pick?.base.id ?? null);
      if (pick) busy.add(pick.base.id);
      invalidate();
    }
    // Pekerjaan yang dibuang dari store (reset) ikut dibuang di sini.
    for (const id of [...anims.current.keys()]) if (!jobs[id]) anims.current.delete(id);
  }, [jobs, cranes, data, invalidate]);

  // --- gerak per frame ----------------------------------------------------------
  const pos = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    if (anims.current.size === 0) return;
    const { speed, markLifted, markPlaced, finishJob } = useTraffic.getState();
    const { addContainer, removeContainer } = useYard.getState();
    const dt = Math.min(delta, 0.1) * speed;

    for (const a of anims.current.values()) {
      if (a.job.stage === 'done') continue;
      a.t += dt;
      const p = poseAt(a);
      const n = nodes.current.get(a.job.id);

      if (p.grabbed && !a.lifted) {
        a.lifted = true;
        markLifted(a.job.id);
        // Ambil: kontainer meninggalkan tumpukan begitu terangkat.
        if (a.job.flow === 'D') removeContainer(a.job.container.no);
      }
      if (p.released && !a.placed) {
        a.placed = true;
        markPlaced(a.job.id);
        // Bongkar: kontainer masuk tumpukan begitu dilepas.
        if (a.job.flow === 'R') addContainer(a.job.container);
      }
      if (p.done) {
        finishJob(a.job.id);
        continue;
      }

      if (n?.crane && a.base) {
        n.crane.position.set(p.gx, 0, a.base.z);
      }
      if (n?.spreader) {
        // Geometri spreader dibangun di y = SPREADER_Y dengan tebal 0,5; alasnya
        // SPREADER_Y - 0,25. Digeser supaya alas itu jatuh di `under`.
        n.spreader.position.set(p.gx, p.under - (SPREADER_Y - 0.25), p.z);
        n.spreader.visible = !!a.base;
      }
      if (n?.load) {
        n.load.visible = p.carrying;
        pos.set(p.gx, p.under - BOX.height / 2, p.z);
        n.load.position.copy(pos);
      }
    }
    invalidate();
  });

  const active = Object.values(jobs).filter((j) => j.stage === 'working');
  if (active.length === 0) return null;

  return (
    <>
      {active.map((job) => {
        const a = anims.current.get(job.id);
        if (!a) return null;
        const ref = (key: 'crane' | 'spreader' | 'load') => (el: THREE.Group | THREE.Mesh | null) => {
          const cur = nodes.current.get(job.id) ?? { crane: null, spreader: null, load: null };
          (cur as Record<string, unknown>)[key] = el;
          nodes.current.set(job.id, cur);
        };
        const color = colorFor(job.container, colorMode);
        return (
          <group key={job.id}>
            {a.base && (
              <group ref={ref('crane')} position={[a.gx0, 0, a.base.z]} rotation-y={a.base.ry}>
                {a.base.kind === 'rtg' ? (
                  <mesh geometry={geo.rtg} material={mats.rtg} scale={[1, 1, a.base.sz]} />
                ) : (
                  <AssetCrane parts={assetParts} s={a.base.s} />
                )}
              </group>
            )}
            <mesh ref={ref('spreader')} geometry={geo.spreader} material={mats.spreader} rotation-y={a.base?.ry ?? 0} />
            <mesh ref={ref('load')} geometry={job.container.size === 40 ? geo.box40 : geo.box20} visible={false}>
              <meshPhongMaterial color={color} shininess={14} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

export function RtgWorks() {
  return (
    <Suspense fallback={null}>
      <Works />
    </Suspense>
  );
}
