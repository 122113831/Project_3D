'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX } from '@/lib/constants';
import { createReachStacker, type ReachStackerObject } from '@/lib/reachStacker';
import { headingOf, type Pose, type RsStep } from '@/lib/rsPlan';
import { useRsWorks, type RsJob } from '@/store/useRsWorks';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';
import { CarriedContainer } from './CarriedContainer';
import { dropRtgPose, setRtgPose } from './trafficRegistry';

/**
 * Reach stacker yang sedang bekerja: mengikuti rencana dari rsPlan langkah
 * demi langkah — lintasan dihaluskan (Catmull-Rom), arah moncong mengikuti
 * garis singgung (dibalik saat mundur) dan diperhalus supaya tidak patah,
 * boom bergerak di antara pose, dan kontainer menggantung di alas spreader.
 *
 * Seperti RTG: kontainer HILANG dari tumpukan saat twistlock mengunci dan
 * MUNCUL di tumpukan tujuan saat dilepas — data lapangan ditambal langsung.
 */

/** Kecepatan jalan (m/detik) sebelum pengali kecepatan HUD. */
const DRIVE_SPEED = 4.2;
const REVERSE_SPEED = 2.6;

type Timed =
  | { kind: 'drive'; dur: number; curve: THREE.CatmullRomCurve3; reverse: boolean; pose: Pose }
  | { kind: 'boom'; dur: number; from: Pose; to: Pose; event?: 'grab' | 'release' };

const smooth = (k: number) => {
  const t = Math.max(0, Math.min(1, k));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function timeline(steps: RsStep[]): Timed[] {
  return steps.map((s): Timed => {
    if (s.kind === 'boom') return s;
    // Titik yang berimpit membuat garis singgung tak terdefinisi.
    const pts: THREE.Vector3[] = [];
    for (const p of s.pts) {
      const v = new THREE.Vector3(p.x, 0, p.z);
      if (!pts.length || pts[pts.length - 1].distanceTo(v) > 0.5) pts.push(v);
    }
    if (pts.length === 1) pts.push(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    return { kind: 'drive', curve, reverse: s.reverse, pose: s.pose, dur: Math.max(0.8, len / (s.reverse ? REVERSE_SPEED : DRIVE_SPEED)) };
  });
}

type Run = {
  job: RsJob;
  steps: Timed[];
  i: number;
  t: number;
  heading: number;
  carrying: boolean;
  /** Arah moncong saat kontainer dijepit — kontainer ikut berputar dari sini. */
  grabHeading: number;
  rot: number;
};

function Worker({ job }: { job: RsJob }) {
  const invalidate = useThree((s) => s.invalidate);
  const rs = useMemo<ReachStackerObject>(() => createReachStacker(job.code), [job.code]);
  const load = useRef<THREE.Group>(null);
  const run = useRef<Run | null>(null);

  useEffect(() => {
    const id = job.id;
    run.current = {
      job,
      steps: timeline(job.steps),
      i: 0,
      t: 0,
      heading: job.home.ry,
      carrying: false,
      grabHeading: job.home.ry,
      rot: job.rot,
    };
    rs.position.set(job.home.x, 0, job.home.z);
    rs.rotation.y = job.home.ry;
    invalidate();
    return () => dropRtgPose(id);
  }, [job, rs, invalidate]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const r = run.current;
    if (!r) return;
    const speed = useTraffic.getState().speed;
    const dt = Math.min(delta, 0.1) * speed;
    r.t += dt;
    // Lewati langkah yang sudah habis, sambil menjalankan kejadiannya.
    while (r.i < r.steps.length && r.t >= r.steps[r.i].dur) {
      const s = r.steps[r.i];
      if (s.kind === 'boom' && s.event === 'grab' && !r.carrying) {
        r.carrying = true;
        r.grabHeading = r.heading;
        useYard.getState().removeContainer(r.job.container.no);
      }
      if (s.kind === 'boom' && s.event === 'release' && r.carrying) {
        r.carrying = false;
        useYard.getState().addContainer(r.job.to);
      }
      r.t -= s.dur;
      r.i++;
    }
    if (r.i >= r.steps.length) {
      run.current = null;
      dropRtgPose(r.job.id);
      useRsWorks.getState().finish(r.job.id);
      invalidate();
      return;
    }
    const s = r.steps[r.i];
    const k = r.t / s.dur;
    let pose: Pose;
    if (s.kind === 'drive') {
      const u = smooth(k);
      const p = s.curve.getPointAt(u);
      const tan = s.curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
      const target = headingOf({ x: s.reverse ? -tan.x : tan.x, z: s.reverse ? -tan.z : tan.z });
      // Perhalus belokan: moncong mengejar arah lintasan, tidak meloncat.
      r.heading += wrap(target - r.heading) * Math.min(1, dt * 5);
      rs.position.set(p.x, 0, p.z);
      rs.rotation.y = r.heading;
      pose = s.pose;
    } else {
      const e = smooth(k);
      pose = { angle: s.from.angle + (s.to.angle - s.from.angle) * e, ext: s.from.ext + (s.to.ext - s.from.ext) * e };
    }
    rs.setPose(pose.angle, pose.ext);
    // Kamera "Ikuti alat" membaca daftar pose yang sama dengan RTG.
    setRtgPose(r.job.id, { x: rs.position.x, y: 4, z: rs.position.z });

    const l = load.current;
    if (l) {
      l.visible = r.carrying;
      if (r.carrying) {
        rs.updateMatrixWorld(true);
        tmp.copy(rs.spreaderBottom());
        rs.localToWorld(tmp);
        l.position.set(tmp.x, tmp.y - BOX.height / 2, tmp.z);
        l.rotation.y = r.rot + (r.heading - r.grabHeading);
      }
    }
    invalidate();
  });

  return (
    <>
      <primitive object={rs} dispose={null} />
      <CarriedContainer ref={load} c={job.container} visible={false} />
    </>
  );
}

export function RsWorks() {
  const jobs = useRsWorks((s) => s.jobs);
  return (
    <>
      {Object.values(jobs).map((j) => (
        <Worker key={j.id} job={j} />
      ))}
    </>
  );
}
