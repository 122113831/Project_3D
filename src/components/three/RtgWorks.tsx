'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, PITCH, RTG, RTG_ASSET, rtgAssetScale, rtgSpanScale } from '@/lib/constants';
import { craneModelFor, RTG_CRANE_MODEL_URL, type ModelPart } from '@/lib/containerModel';
import { generateEquipment } from '@/lib/equipment';
import {
  createRtgGeometry,
  createRtgSpreaderGeometry,
  SPREADER_Y,
} from '@/lib/geometry';
import type { LayoutEquipment } from '@/lib/layout';
import { rsUnits, wantsMobile } from '@/lib/rsPlan';
import type { YardBlock } from '@/lib/types';
import { containerPosition } from '@/lib/yard';
import { useEditor } from '@/store/useEditor';
import { useTraffic, type RtgJob } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { CRANE_REST, splitCrane, type SplitCrane } from '@/lib/craneSplit';
import { dropRtgPose, setRtgPose } from './trafficRegistry';
import { CarriedContainer } from './CarriedContainer';
import { RTG_DETAIL, rtgDetailModel, rtgDetailRailZ } from '@/lib/rtgDetail';
import { rtgDetail2Model } from '@/lib/rtgDetail2';

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
  | { kind: 'rtgAsset'; id: string; x: number; z: number; ry: number; s: number }
  | { kind: 'rtgDetail'; id: string; x: number; z: number; ry: number; railZ: number; variant: 1 | 2 };

type Anim = {
  job: RtgJob;
  base: Base | null;
  /** Detik sejak mulai, sudah dikali kecepatan. */
  t: number;
  /** Batas waktu tiap langkah, kumulatif. */
  steps: number[];
  /** Posisi portal: awal (tempat parkir), di sumber, di tujuan. */
  gx0: number;
  gx1: number;
  gx2: number;
  /** Tinggi girder untuk trolley dan kabel. */
  girder: number;
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
  // Membawa muatan: trolley bergeser melintang, dan pada relokasi ke bay lain
  // portalnya juga berjalan — yang lebih lama yang menentukan.
  const carry = Math.max(1.6, Math.abs(a.dst.z - a.src.z) / 2.5, Math.abs(a.gx2 - a.gx1) / GANTRY_SPEED);
  const d = [travel, 1.8, 0.4, 1.2, carry, 1.5, 0.4, 1.0];
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
  const gx =
    t < tHoist
      ? a.gx0 + (a.gx1 - a.gx0) * seg(0, tTravel)
      : a.gx1 + (a.gx2 - a.gx1) * seg(tHoist, tCarry);
  // Alas spreader berada di puncak kontainer saat menjepit dan saat melepas.
  // `top` adalah alas kontainer — dek truk atau dasar slot — jadi puncaknya
  // selalu top + tinggi kontainer, baik di truk maupun di tumpukan.
  const srcHang = a.src.top + BOX.height;
  const dstHang = a.dst.top + BOX.height;
  // Portal sedang berjalan: lampu suar berkedip.
  const travelling =
    (t < tTravel && Math.abs(a.gx1 - a.gx0) > 0.5) ||
    (t >= tHoist && t < tCarry && Math.abs(a.gx2 - a.gx1) > 0.5);

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
  return {
    gx,
    z,
    under,
    carrying,
    travelling,
    locked: t >= tGrab && t < tRelease,
    grabbed: t >= tGrab,
    released: t >= tRelease,
    done: t >= tRaise,
  };
}

/**
 * Aset RTG yang sedang bekerja: rangka diam, dan trolley + spreader ASLI dari
 * modelnya dalam grup sendiri yang digeser tiap frame (lihat craneSplit.ts).
 * Dulu seluruh model digambar utuh dan spreader tiruan digantung di
 * sampingnya — trolley dan spreader asli tetap diam, jadi tampak dua alat.
 */
function AssetCrane({
  split,
  s,
  trolleyRef,
  spreaderRef,
}: {
  split: SplitCrane;
  s: number;
  trolleyRef: (el: THREE.Object3D | null) => void;
  spreaderRef: (el: THREE.Object3D | null) => void;
}) {
  const draw = (parts: ModelPart[]) =>
    parts.map((p) => <mesh key={p.name} geometry={p.geometry} material={p.material} />);
  return (
    <group scale={s} position={[-RTG_ASSET.midX * s, 0, -RTG_ASSET.midZ * s]}>
      {draw(split.frame)}
      <group ref={trolleyRef}>{draw(split.trolley)}</group>
      <group ref={spreaderRef}>{draw(split.spreader)}</group>
    </group>
  );
}

/** RTG detail yang bekerja: rangka diam, trolley+kabin dan spreader di grup sendiri. */
function DetailCrane({
  railZ,
  variant,
  trolleyRef,
  spreaderRef,
}: {
  railZ: number;
  variant: 1 | 2;
  trolleyRef: (el: THREE.Object3D | null) => void;
  spreaderRef: (el: THREE.Object3D | null) => void;
}) {
  const m = (variant === 2 ? rtgDetail2Model : rtgDetailModel)(railZ);
  const draw = (parts: ModelPart[]) =>
    parts.map((p) => <mesh key={p.name} geometry={p.geometry} material={p.material} dispose={null} />);
  return (
    <>
      {draw(m.frame)}
      <group ref={trolleyRef}>{draw(m.trolley)}</group>
      <group ref={spreaderRef} position-y={RTG_DETAIL.restUnder}>
        {draw(m.spreader)}
      </group>
    </>
  );
}

type Nodes = {
  crane: THREE.Group | null;
  /** Grup trolley dan spreader asli di dalam aset RTG (koordinat model). */
  aTrolley: THREE.Group | null;
  aSpreader: THREE.Group | null;
  spreader: THREE.Mesh | null;
  load: THREE.Object3D | null;
  trolley: THREE.Mesh | null;
  cables: THREE.LineSegments | null;
  beacon: THREE.Mesh | null;
  locks: THREE.Group | null;
};

function Works() {
  const data = useYardView();
  const layoutEquipment = useEditor((s) => s.layout?.equipment);
  const jobs = useTraffic((s) => s.rtgJobs);
  const invalidate = useThree((s) => s.invalidate);

  const gltf = useGLTF(RTG_CRANE_MODEL_URL, false, false);
  const assetParts = useMemo(() => craneModelFor(gltf).parts20, [gltf]);
  const split = useMemo(() => splitCrane(assetParts), [assetParts]);
  const geo = useMemo(
    () => ({
      rtg: createRtgGeometry(),
      spreader: createRtgSpreaderGeometry(),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      rtg: new THREE.MeshPhongMaterial({ color: '#3a6ea5', shininess: 20 }),
      spreader: new THREE.MeshPhongMaterial({ color: '#d9741f', shininess: 20 }),
      trolley: new THREE.MeshPhongMaterial({ color: '#f2c94c', shininess: 20 }),
      cable: new THREE.LineBasicMaterial({ color: '#1f2933' }),
      // Lampu suar dan twistlock: tanpa pencahayaan supaya tampak menyala.
      beaconOn: new THREE.MeshBasicMaterial({ color: '#ffb020' }),
      beaconOff: new THREE.MeshBasicMaterial({ color: '#6b4a12' }),
      lockOpen: new THREE.MeshBasicMaterial({ color: '#ef4444' }),
      lockShut: new THREE.MeshBasicMaterial({ color: '#22c55e' }),
    }),
    [],
  );
  const extra = useMemo(
    () => ({
      trolley: new THREE.BoxGeometry(3.2, 1.4, 3.0),
      beacon: new THREE.CylinderGeometry(0.45, 0.45, 0.7, 10),
      lock: new THREE.BoxGeometry(0.35, 0.3, 0.35),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const g of Object.values(extra)) g.dispose();
    },
    [extra],
  );

  /** RTG yang tersedia, dengan blok yang dilayaninya. */
  const cranes = useMemo(() => {
    const blocks = data?.blocks ?? [];
    const items: LayoutEquipment[] =
      layoutEquipment ??
      generateEquipment(blocks, data?.meta.extentX ?? 0, data?.meta.extentZ ?? 0);
    const out: { base: Base; blockId: string }[] = [];
    for (const it of items) {
      if (it.kind !== 'rtg' && it.kind !== 'rtgAsset' && it.kind !== 'rtgDetail' && it.kind !== 'rtgDetail2') continue;
      const b = nearestBlock(blocks, it.z);
      if (!b) continue;
      const width = b.rows * PITCH.row;
      out.push({
        blockId: b.id,
        base:
          it.kind === 'rtg'
            ? { kind: 'rtg', id: it.id, x: it.x, z: it.z, ry: it.ry, sz: rtgSpanScale(width) }
            : it.kind === 'rtgDetail' || it.kind === 'rtgDetail2'
              ? {
                  kind: 'rtgDetail',
                  id: it.id,
                  x: it.x,
                  z: it.z,
                  ry: it.ry,
                  railZ: rtgDetailRailZ(width),
                  variant: it.kind === 'rtgDetail2' ? 2 : 1,
                }
              : { kind: 'rtgAsset', id: it.id, x: it.x, z: it.z, ry: it.ry, s: rtgAssetScale(width) },
      });
    }
    return out;
  }, [data, layoutEquipment]);

  const anims = useRef(new Map<string, Anim>());
  const nodes = useRef(new Map<string, Nodes>());
  const rtgPark = useTraffic((s) => s.rtgPark);

  // --- klaim pekerjaan baru ---------------------------------------------------
  useEffect(() => {
    const { claimJob } = useTraffic.getState();
    const busy = new Set(useTraffic.getState().busyRtg);
    // Kontainer yang menurut data ditangani alat bergerak (KODE_ALAT RS/SL/FL)
    // dikerjakan RsWorks — selama tata letak punya alat bergerak.
    const mobile = rsUnits(useEditor.getState().layout?.equipment ?? []).length > 0;
    for (const job of Object.values(jobs)) {
      if (job.stage !== 'queued' || anims.current.has(job.id)) continue;
      if (mobile && job.flow !== 'S' && wantsMobile(job.equipment)) continue;
      const block = data?.blocks.find((b) => b.id === job.blockId);
      if (!block) continue;

      // RTG terdekat ke bay yang melayani blok ini dan sedang bebas — diukur
      // dari tempat ia terakhir PARKIR, bukan dari tempat asalnya.
      let pick: { base: Base; blockId: string } | null = null;
      let best = Infinity;
      const [sx, sy, sz] = containerPosition(block, job.container);
      const parkOf = (c: { base: Base }) => rtgPark[c.base.id] ?? c.base.x;
      for (const c of cranes) {
        if (c.blockId !== job.blockId || busy.has(c.base.id)) continue;
        const d = Math.abs(parkOf(c) - sx);
        if (d < best) {
          best = d;
          pick = c;
        }
      }
      // Ada RTG di blok ini tapi semuanya sibuk: tunggu giliran.
      if (!pick && cranes.some((c) => c.blockId === job.blockId)) continue;

      const slotTop = sy - BOX.height / 2;
      const truckTop = TRUCK_DECK_TOP;
      let src = { z: sz, top: slotTop };
      let dst = { z: job.truck.z, top: truckTop };
      let gx2 = sx;
      if (job.flow === 'R') {
        src = { z: job.truck.z, top: truckTop };
        dst = { z: sz, top: slotTop };
      } else if (job.flow === 'S' && job.to) {
        // Relokasi: tujuannya slot lain, mungkin di bay lain.
        const [tx, ty, tz] = containerPosition(block, job.to);
        dst = { z: tz, top: ty - BOX.height / 2 };
        gx2 = tx;
      }
      const base = pick?.base ?? null;
      const girder =
        !base || base.kind === 'rtg'
          ? RTG.height
          : base.kind === 'rtgDetail'
            ? RTG_DETAIL.girderTop
            : RTG_ASSET.height * base.s;
      const partial = { job, base, gx0: pick ? parkOf(pick) : sx, gx1: sx, gx2, src, dst, girder };
      anims.current.set(job.id, { ...partial, steps: planSteps(partial), t: 0, lifted: false, placed: false });
      claimJob(job.id, pick?.base.id ?? null);
      if (pick) busy.add(pick.base.id);
      invalidate();
    }
    // Pekerjaan yang dibuang dari store (reset) ikut dibuang di sini.
    for (const id of [...anims.current.keys()]) {
      if (!jobs[id]) {
        anims.current.delete(id);
        dropRtgPose(id);
      }
    }
  }, [jobs, cranes, data, invalidate, rtgPark]);

  // --- gerak per frame ----------------------------------------------------------
  const pos = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    if (anims.current.size === 0) return;
    const { speed, markLifted, markPlaced, finishJob, parkRtg } = useTraffic.getState();
    // Kedip lampu suar: dua kali sedetik, waktu nyata (bukan dikali kecepatan).
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    const { addContainer, removeContainer } = useYard.getState();
    const dt = Math.min(delta, 0.1) * speed;

    for (const a of anims.current.values()) {
      // `a.job` adalah salinan saat diklaim — tahapnya tetap 'queued'. Yang
      // dibaca harus tahap TERKINI di store; pekerjaan yang sudah selesai
      // dibuang dari daftar animasi.
      const live = useTraffic.getState().rtgJobs[a.job.id];
      if (!live || live.stage === 'done') {
        anims.current.delete(a.job.id);
        dropRtgPose(a.job.id);
        continue;
      }
      a.t += dt;
      const p = poseAt(a);
      const n = nodes.current.get(a.job.id);

      if (p.grabbed && !a.lifted) {
        a.lifted = true;
        markLifted(a.job.id);
        // Ambil dan relokasi: kontainer meninggalkan tumpukan begitu terangkat.
        if (a.job.flow !== 'R') removeContainer(a.job.container.no);
      }
      if (p.released && !a.placed) {
        a.placed = true;
        markPlaced(a.job.id);
        // Bongkar: kontainer masuk tumpukan begitu dilepas; relokasi: masuk di
        // posisi barunya.
        if (a.job.flow === 'R') addContainer(a.job.container);
        if (a.job.flow === 'S' && a.job.to) addContainer(a.job.to);
      }
      if (p.done) {
        // RTG tetap berdiri di bay terakhirnya, bukan kembali ke tempat asal.
        if (a.base) parkRtg(a.base.id, a.gx2);
        dropRtgPose(a.job.id);
        finishJob(a.job.id);
        // Dibuang SEKARANG, bukan dibiarkan: kalau tidak, frame berikutnya
        // memanggil finishJob lagi dan mencoret RTG ini dari daftar sibuk —
        // padahal pekerjaan berikutnya di antrean sudah memakainya, dan RTG
        // diamnya muncul lagi di samping yang bergerak.
        anims.current.delete(a.job.id);
        continue;
      }
      setRtgPose(a.job.id, { x: p.gx, y: p.under, z: p.z });

      if (n?.crane && a.base) {
        n.crane.position.set(p.gx, 0, a.base.z);
      }
      if (n?.spreader) {
        // Geometri spreader dibangun di y = SPREADER_Y dengan tebal 0,5; alasnya
        // SPREADER_Y - 0,25. Digeser supaya alas itu jatuh di `under`.
        n.spreader.position.set(p.gx, p.under - (SPREADER_Y - 0.25), p.z);
        // Spreader prosedural hanya untuk RTG prosedural; aset RTG memakai
        // spreader aslinya sendiri.
        n.spreader.visible = a.base?.kind === 'rtg';
      }
      if (n?.load) {
        n.load.visible = p.carrying;
        pos.set(p.gx, p.under - BOX.height / 2, p.z);
        n.load.position.copy(pos);
      }
      if (a.base?.kind === 'rtgAsset') {
        // Geser trolley dan spreader asli, dalam koordinat model (grup aset
        // diskalakan s). Posisi diamnya di tengah bentang (CRANE_REST.z).
        const sc = a.base.s;
        const restZ = a.base.z + (CRANE_REST.z - RTG_ASSET.midZ) * sc;
        const dz = (p.z - restZ) / sc;
        if (n?.aTrolley) n.aTrolley.position.set(0, 0, dz);
        if (n?.aSpreader) n.aSpreader.position.set(0, p.under / sc - split.spreaderBottom, dz);
      }
      if (a.base?.kind === 'rtgDetail') {
        // Trolley + kabin dan spreader asli RTG detail (koordinat lokal portal).
        const dz = p.z - a.base.z;
        if (n?.aTrolley) n.aTrolley.position.set(0, 0, dz);
        if (n?.aSpreader) n.aSpreader.position.set(0, p.under, dz);
      }
      if (a.base) {
        // Trolley di girder, tepat di atas spreader. Aset GLB sudah membawa
        // mesin trolleynya sendiri; trolley tambahan hanya untuk RTG prosedural.
        if (n?.trolley) n.trolley.position.set(p.gx, a.girder - 0.2, p.z);
        // Empat kabel hoist dari trolley ke kepala spreader.
        if (n?.cables) {
          const attr = n.cables.geometry.getAttribute('position') as THREE.BufferAttribute;
          // Aset: dari bawah trolley aslinya (13,3 m model) ke puncak spreader aslinya.
          const assetScale = a.base.kind === 'rtgAsset' ? a.base.s : null;
          const detail = a.base.kind === 'rtgDetail';
          const top = detail ? RTG_DETAIL.ropeTop : assetScale ? 13.3 * assetScale : a.girder - 0.9;
          const head = detail
            ? p.under + RTG_DETAIL.spreaderHead
            : assetScale
              ? p.under + (split.spreaderTop - split.spreaderBottom) * assetScale
              : p.under + 1.2;
          let i = 0;
          for (const dx of [-0.9, 0.9]) {
            for (const dz of [-0.7, 0.7]) {
              attr.setXYZ(i++, p.gx + dx, top, p.z + dz);
              attr.setXYZ(i++, p.gx + dx * 0.6, head, p.z + dz * 0.6);
            }
          }
          attr.needsUpdate = true;
        }
        if (n?.beacon) {
          n.beacon.position.set(p.gx, a.girder + 0.9, a.base.z);
          n.beacon.material = p.travelling && blink ? mats.beaconOn : mats.beaconOff;
        }
        if (n?.locks) {
          n.locks.position.set(p.gx, p.under + 0.6, p.z);
          const m = p.locked ? mats.lockShut : mats.lockOpen;
          for (const c of n.locks.children) (c as THREE.Mesh).material = m;
        }
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
        const ref = (key: keyof Nodes) => (el: THREE.Object3D | null) => {
          const cur: Nodes = nodes.current.get(job.id) ?? {
            crane: null,
            aTrolley: null,
            aSpreader: null,
            spreader: null,
            load: null,
            trolley: null,
            cables: null,
            beacon: null,
            locks: null,
          };
          (cur as Record<string, unknown>)[key] = el;
          nodes.current.set(job.id, cur);
        };
        return (
          <group key={job.id}>
            {a.base && (
              <group ref={ref('crane')} position={[a.gx0, 0, a.base.z]} rotation-y={a.base.ry}>
                {a.base.kind === 'rtg' ? (
                  <mesh geometry={geo.rtg} material={mats.rtg} scale={[1, 1, a.base.sz]} />
                ) : a.base.kind === 'rtgDetail' ? (
                  <DetailCrane
                    railZ={a.base.railZ}
                    variant={a.base.variant}
                    trolleyRef={ref('aTrolley')}
                    spreaderRef={ref('aSpreader')}
                  />
                ) : (
                  <AssetCrane split={split} s={a.base.s} trolleyRef={ref('aTrolley')} spreaderRef={ref('aSpreader')} />
                )}
              </group>
            )}
            <mesh ref={ref('spreader')} geometry={geo.spreader} material={mats.spreader} rotation-y={a.base?.ry ?? 0} />
            {/* Aset yang SAMA dengan di tumpukan & di truk (livery, nomor, rona). */}
            <CarriedContainer ref={ref('load')} c={job.container} visible={false} />
            {a.base && (
              <>
                {a.base.kind === 'rtg' && (
                  <mesh ref={ref('trolley')} geometry={extra.trolley} material={mats.trolley} />
                )}
                <lineSegments ref={ref('cables')} material={mats.cable} frustumCulled={false}>
                  <bufferGeometry>
                    <bufferAttribute attach="attributes-position" args={[new Float32Array(8 * 3), 3]} />
                  </bufferGeometry>
                </lineSegments>
                <mesh ref={ref('beacon')} geometry={extra.beacon} material={mats.beaconOff} />
                {/* Twistlock di keempat sudut kontainer: merah terbuka, hijau terkunci. */}
                <group ref={ref('locks')}>
                  {[-1, 1].flatMap((sxn) =>
                    [-1, 1].map((szn) => (
                      <mesh
                        key={`${sxn}${szn}`}
                        geometry={extra.lock}
                        material={mats.lockOpen}
                        position={[
                          (sxn * ((job.container.size === 40 ? BOX.len40 : BOX.len20) - 0.4)) / 2,
                          0,
                          (szn * (BOX.width - 0.3)) / 2,
                        ]}
                      />
                    )),
                  )}
                </group>
              </>
            )}
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
