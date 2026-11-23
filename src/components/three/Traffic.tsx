'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { TRUCK_MODEL_URL, truckModelFor } from '@/lib/containerModel';
import { createChassisGeometry } from '@/lib/geometry';
import { CarriedContainer } from './CarriedContainer';
import {
  buildRoadGraph,
  keepLeft,
  makeRoute,
  nearestS,
  roundCorners,
  routeFromStop,
  routeToStop,
  sampleRoute,
  stopFor,
  type Stop,
  type StopEntry,
  unreachableBlocks,
  type GateNode,
  type Pt,
  type RoadGraph,
  type Route,
} from '@/lib/roadGraph';
import { isBlocked } from '@/lib/slots';
import type { YardBlock, YardContainer } from '@/lib/types';
import { fetchContainer } from '@/lib/yardApi';
import { useEditor } from '@/store/useEditor';
import { useTraffic, type Trip } from '@/store/useTraffic';
import { useYardView } from '@/store/useYardView';
import { BOX, GATE, ROAD } from '@/lib/constants';
import {
  allTruckPoses,
  dropTruck,
  routesVersion,
  setTruckPose,
  setTruckRoute,
  truckRoute,
} from './trafficRegistry';

/**
 * Truk gate yang bergerak mengikuti kejadian: masuk lewat gate in, berhenti di
 * lajur layanan blok tujuannya, dilayani RTG, lalu keluar lewat gate out.
 *
 * Rutenya dicari di graf jalan yang dibangun ulang dari tata letak setiap kali
 * tata letak berubah (lihat roadGraph.ts). Truk yang sedang berjalan
 * mempertahankan rutenya sendiri; truk berikutnya memakai jalan yang baru.
 *
 * Tujuan truk ditentukan BERTAHAP, karena di lapangan pun begitu: kontainer
 * bongkar baru punya slot saat ditumpuk. Kalau saat gate in tujuannya belum
 * diketahui, truk masuk dan MENUNGGU di area tunggu tepat di dalam gerbang;
 * begitu kejadian "ditangani" datang dan database sudah tahu slotnya, truk
 * melanjutkan ke bay-nya.
 */

/** Kecepatan dasar, m/detik, sebelum dikali pengali kecepatan di HUD. */
const DRIVE = 8;

/** Geseran ke kiri garis tengah jalan: lajur kiri, sesuai lalu lintas Indonesia. */
const KEEP_LEFT = 3.5;

/** Batas truk yang digambar sekaligus. */
const CAP = 64;

/** Jarak iring: rig traktor + chassis 15,4 m ditambah sedikit celah. */
const FOLLOW = 18;

/**
 * Batas menunggu di belakang truk lain, dalam detik waktu animasi.
 *
 * Aturan iring tidak tahu soal persimpangan dan titik berhenti, jadi dua truk
 * bisa saja saling menunggu selamanya. Setelah batas ini yang di belakang
 * dibiarkan lewat menembus — lebih baik sesekali tumpang-tindih sesaat daripada
 * lalu lintas yang macet permanen.
 */
const MAX_HOLD = 6;

/** Jarak area tunggu dari gerbang, diukur sepanjang jalan. */
const HOLD_DISTANCE = 45;

/** Percepatan dan pengereman, m/detik², sebelum pengali kecepatan HUD. */
const ACCEL = 2.2;
const BRAKE = 3.5;

/** Berhenti di timbangan gate, detik waktu animasi. */
const GATE_PAUSE = 2.5;

/** Jarak tengok ke depan untuk lampu sein, meter. */
const SIGNAL_AHEAD = 24;

/** Rute dari titik-titik graf: lajur kiri, tikungan dibulatkan. */
const lane = (pts: Pt[], keepFirst: boolean | number, keepLast: boolean | number) =>
  makeRoute(roundCorners(keepLeft(pts, KEEP_LEFT, keepFirst, keepLast)));

/** Selisih sudut terkecil, bertanda (positif = belok kiri). */
const turn = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

type Dest = { block: YardBlock; c: YardContainer };

type Mover = {
  id: string;
  route: Route;
  s: number;
  /** in: menuju tujuan · hold: menunggu tujuan · wait: di bay · out: pulang */
  phase: 'in' | 'hold' | 'wait' | 'out';
  stop: Stop | null;
  /** Cara masuk yang dipakai (arah laju di lajur layanan), dipakai lagi saat keluar. */
  entry: StopEntry | null;
  dest: Dest | null;
  /** Sedang bertanya tujuan ke database. */
  resolving: boolean;
  x: number;
  z: number;
  ry: number;
  held: number;
  /** Kecepatan sekarang, m/detik dasar (sebelum pengali HUD). */
  v: number;
  /** Jarak di rute tempat truk berhenti di timbangan gate, atau null. */
  pauseAt: number | null;
  pauseLeft: number;
  /** Lampu sein: -1 kanan, 0 mati, 1 kiri. */
  signal: number;
  braking: boolean;
};

const byPosition = (a: GateNode, b: GateNode) => a.x - b.x || a.z - b.z;

/**
 * Gate untuk sebuah perjalanan.
 *
 * Nomor gate dari database (GATI_NO / GATO_NO) dipetakan ke gate di tata letak
 * menurut urutan posisinya. Database tidak menyimpan di mana gate itu berdiri,
 * jadi pemetaan ini satu-satunya yang bisa dibuat tanpa mengarang; kalau
 * nomornya melebihi jumlah gate, ia berputar.
 */
function pickGate(g: RoadGraph, dir: 'in' | 'out', no: number | null): GateNode | null {
  const list = g.gates.filter((x) => x.kind === dir || x.kind === 'both').sort(byPosition);
  if (list.length === 0) return null;
  const i = no && no > 0 ? (no - 1) % list.length : 0;
  return list[i];
}

/** Ada truk lain tepat di depan, searah, dalam jarak iring? */
function blockedAhead(m: Mover, all: Iterable<Mover>): boolean {
  const hx = Math.cos(m.ry);
  const hz = -Math.sin(m.ry);
  for (const o of all) {
    if (o === m) continue;
    const dx = o.x - m.x;
    const dz = o.z - m.z;
    const t = dx * hx + dz * hz;
    if (t <= 0 || t > FOLLOW) continue;
    if (Math.abs(dx * -hz + dz * hx) > 3) continue;
    if (hx * Math.cos(o.ry) + hz * -Math.sin(o.ry) < 0.7) continue;
    return true;
  }
  return false;
}

/**
 * Titik tunggu: node jalan sejauh HOLD_DISTANCE dari gerbang ke arah dalam.
 * Dicari dengan menelusuri graf dari node gerbang — jalan ke dalam itu yang
 * pertama ditemui setelah node gerbang sendiri.
 */
function holdPoint(g: RoadGraph, gate: GateNode): { pts: Pt[]; node: number } | null {
  const seen = new Set<number>([gate.node]);
  let frontier: { node: number; path: number[]; dist: number }[] = [{ node: gate.node, path: [gate.node], dist: 0 }];
  // `as`, bukan anotasi: dengan anotasi TypeScript menyempitkan `best` ke null
  // dan tidak melihat penugasan di dalam loop bersarang di bawah.
  let best = null as { node: number; path: number[]; dist: number } | null;
  while (frontier.length) {
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (const e of g.adj[f.node]) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        const cand = { node: e.to, path: [...f.path, e.to], dist: f.dist + e.w };
        if (cand.dist >= HOLD_DISTANCE) {
          if (!best || cand.dist < best.dist) best = cand;
        } else next.push(cand);
      }
    }
    if (best) break;
    frontier = next;
  }
  if (!best) return null;
  return { pts: [gate.outside, ...best.path.map((i) => g.nodes[i])], node: best.node };
}

/** Pasang jeda timbangan di titik rute terdekat ke gerbang. */
function armGatePause(m: Mover, gate: GateNode) {
  m.pauseAt = nearestS(m.route, gate);
  m.pauseLeft = GATE_PAUSE;
}

/**
 * Palang gerbang: dua lengan berengsel di tiang luar, terangkat begitu ada
 * truk dalam 26 m, turun lagi setelah lewat. Plat timbangan di bawah kanopi
 * menandai tempat truk berhenti.
 *
 * Gerakannya dihitung tiap frame tapi hanya meminta frame baru selama ada
 * lengan yang masih bergerak — palang yang diam tidak membuat GPU bekerja.
 */
function GateBarriers({ graph }: { graph: RoadGraph }) {
  const invalidate = useThree((s) => s.invalidate);
  const gates = useMemo(
    () =>
      graph.gates.map((g) => {
        const ux = g.outside.x - g.x;
        const uz = g.outside.z - g.z;
        return { id: g.id, x: g.x, z: g.z, ry: Math.atan2(-uz, ux) };
      }),
    [graph],
  );
  const arm = useMemo(() => {
    const len = GATE.span / 2 - 0.9;
    const geo = new THREE.BoxGeometry(0.18, 0.18, len);
    geo.translate(0, 0, -len / 2);
    return geo;
  }, []);
  const plate = useMemo(() => new THREE.BoxGeometry(GATE.depth - 1, 0.08, ROAD.width - 1), []);
  const post = useMemo(() => new THREE.BoxGeometry(0.6, 1.1, 0.6), []);
  useEffect(
    () => () => {
      arm.dispose();
      plate.dispose();
      post.dispose();
    },
    [arm, plate, post],
  );

  const angles = useRef(new Map<string, number>());
  const groups = useRef(new Map<string, THREE.Group>());

  useFrame((_, delta) => {
    const poses = allTruckPoses();
    let changing = false;
    for (const g of gates) {
      let near = false;
      for (const p of poses.values()) {
        if (Math.hypot(p.x - g.x, p.z - g.z) < 26) {
          near = true;
          break;
        }
      }
      const target = near ? 1.35 : 0;
      const cur = angles.current.get(g.id) ?? 0;
      const next = cur + (target - cur) * Math.min(1, delta * 3.5);
      angles.current.set(g.id, next);
      if (Math.abs(next - target) > 0.002) changing = true;
      const grp = groups.current.get(g.id);
      if (grp) {
        const [a, b] = grp.children as THREE.Object3D[];
        // Lengan berengsel di +Z memutar +X untuk naik; yang di -Z sebaliknya.
        if (a) a.rotation.x = next;
        if (b) b.rotation.x = -next;
      }
    }
    if (changing) invalidate();
  });

  const half = GATE.span / 2 - 0.4;
  const outer = GATE.depth / 2 + 0.8;
  return (
    <>
      {gates.map((g) => (
        <group key={g.id} position={[g.x, 0, g.z]} rotation-y={g.ry}>
          <group
            ref={(el) => {
              if (el) groups.current.set(g.id, el);
              else groups.current.delete(g.id);
            }}
          >
            <mesh geometry={arm} position={[outer, 1.05, half]}>
              <meshPhongMaterial color="#d63c3c" />
            </mesh>
            <mesh geometry={arm} position={[outer, 1.05, -half]} rotation-y={Math.PI}>
              <meshPhongMaterial color="#d63c3c" />
            </mesh>
          </group>
          <mesh geometry={post} position={[outer, 0.55, half + 0.4]}>
            <meshPhongMaterial color="#f2c94c" />
          </mesh>
          <mesh geometry={post} position={[outer, 0.55, -half - 0.4]}>
            <meshPhongMaterial color="#f2c94c" />
          </mesh>
          <mesh geometry={plate} position={[0, 0.06, 0]}>
            <meshLambertMaterial color="#4b5058" />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Fleet({ graph, find, blocks }: {
  graph: RoadGraph;
  find: (ctrNo: string) => Dest | null;
  blocks: readonly YardBlock[];
}) {
  const gltf = useGLTF(TRUCK_MODEL_URL, false, false);
  const parts = useMemo(() => truckModelFor(gltf).parts20, [gltf]);
  const chassis = useMemo(() => createChassisGeometry(), []);

  const invalidate = useThree((s) => s.invalidate);
  const movers = useRef(new Map<string, Mover>());
  /** Urutan instance pada frame terakhir — untuk memetakan klik ke perjalanan. */
  const order = useRef<string[]>([]);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const findRef = useRef(find);
  findRef.current = find;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const partRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const chassisRef = useRef<THREE.InstancedMesh>(null);
  /**
   * Truk yang sedang bermuatan dan kontainernya. Muatan digambar dengan aset
   * kontainer yang sama dengan di tumpukan (CarriedContainer), satu grup per
   * truk — jumlahnya puluhan, bukan ribuan. Daftar ini baru diganti saat
   * susunannya berubah (truk naik/turun muatan), bukan tiap frame.
   */
  const [cargo, setCargo] = useState<{ id: string; c: YardContainer }[]>([]);
  const cargoSig = useRef('');
  const cargoRefs = useRef(new Map<string, THREE.Group>());
  /** Kontainer pengganti untuk truk bongkar yang tujuannya belum diketahui. */
  const ghost = useRef(new Map<string, YardContainer>());

  // --- tujuan -------------------------------------------------------------
  //
  // Tiga sumber, berurutan: lapangan yang sedang tampil, posisi yang dibawa
  // pesan, lalu database. Yang terakhir async — truk sementara itu berjalan
  // ke area tunggu.
  const resolve = async (trip: Trip): Promise<Dest | null> => {
    const local = findRef.current(trip.ctrNo);
    if (local) return local;
    if (trip.position) {
      const block = blocksRef.current.find((b) => b.id === trip.position!.block);
      if (block) {
        const bay = Math.max(0, (trip.position.slot - 1) / 2);
        const c: YardContainer = {
          no: trip.ctrNo,
          size: 20,
          type: 'gp',
          status: 'empty',
          line: 'LAIN',
          block: block.id,
          bay,
          row: Math.max(0, trip.position.row - 1),
          tier: Math.max(1, trip.position.tier),
          weightKg: 0,
          vessel: '—',
          inDate: new Date().toISOString().slice(0, 10),
          filled: false,
          damaged: false,
          typeCode: '',
          isoCode: '',
          reefer: false,
          dangerous: false,
        };
        return { block, c };
      }
    }
    try {
      const c = await fetchContainer(trip.ctrNo);
      if (!c) return null;
      const block = blocksRef.current.find((b) => b.id === c.block);
      return block ? { block, c } : null;
    } catch {
      return null;
    }
  };

  const routeInto = (m: Mover, from: Pt | null, dest: Dest): string | null => {
    const g = graphRef.current;
    // Bongkar ke slot yang dikunci ditolak di sini, sebelum truk berangkat:
    // kuncinya berarti baris YARD_ROWTIER-nya tidak ada, jadi TOS pun tidak
    // akan bisa menumpuknya di situ. Kontainer 40ft memakai dua posisi.
    const flow = useTraffic.getState().trips[m.id]?.flow;
    if (flow === 'R') {
      const locks = dest.block.blocked ?? [];
      const span = dest.c.size === 40 ? 2 : 1;
      for (let i = 0; i < span; i++) {
        if (isBlocked(locks, dest.c.bay + i, dest.c.row, dest.c.tier)) {
          return (
            `slot ${dest.block.id}-${(dest.c.bay + i) * 2 + 1} row ${dest.c.row + 1} ` +
            `tier ${dest.c.tier} terkunci — tidak bisa ditumpuk`
          );
        }
      }
    }
    const stop = stopFor(g, dest.block, dest.c.bay, dest.c.size);
    if (!stop) {
      return dest.block.ownRoad === false
        ? `blok ${dest.block.id}: tidak ada ubin jalan di lorong dekat slot ${dest.c.bay * 2 + 1}`
        : `blok ${dest.block.id} tidak dikenal`;
    }
    let path: Pt[] | null;
    const picked: { entry?: StopEntry } = {};
    if (from) {
      // Dari area tunggu: cari dari node terdekat ke posisi sekarang.
      let near = 0;
      let best = Infinity;
      g.nodes.forEach((n, i) => {
        const d = Math.hypot(n.x - from.x, n.z - from.z);
        if (d < best) {
          best = d;
          near = i;
        }
      });
      const fake: GateNode = { id: 'hold', kind: 'in', node: near, x: from.x, z: from.z, outside: from };
      path = routeToStop(g, fake, stop, picked);
    } else {
      const trip = useTraffic.getState().trips[m.id];
      const gate = pickGate(g, 'in', trip?.gateInNo ?? null);
      if (!gate) return 'tata letak belum punya gate masuk';
      path = routeToStop(g, gate, stop, picked);
    }
    if (!path) return `blok ${dest.block.id} tidak tersambung jalan ke gate`;
    // Ekor rute di lajur layanan (menepi + lurus) tidak digeser ke kiri.
    m.route = lane(path, !!from, picked.entry?.via ? 2 : 1);
    m.entry = picked.entry ?? null;
    m.s = 0;
    m.phase = 'in';
    m.stop = stop;
    m.dest = dest;
    // Masuk langsung dari luar gerbang: berhenti dulu di timbangan.
    if (!from) {
      const trip = useTraffic.getState().trips[m.id];
      const gate = pickGate(g, 'in', trip?.gateInNo ?? null);
      if (gate) armGatePause(m, gate);
    }
    setTruckRoute(m.id, m.route.pts);
    return null;
  };

  // --- dari perjalanan ke truk ----------------------------------------------
  useEffect(() => {
    const sync = () => {
      const { trips, skip } = useTraffic.getState();
      for (const id of [...movers.current.keys()]) {
        if (!trips[id]) {
          movers.current.delete(id);
          dropTruck(id);
        }
      }
      for (const trip of Object.values(trips)) {
        if (movers.current.has(trip.id)) continue;
        void spawn(trip).then((reason) => reason && skip(trip.id, reason));
      }
      invalidate();
    };

    const spawn = async (trip: Trip): Promise<string | null> => {
      const g = graphRef.current;
      const gate = pickGate(g, 'in', trip.gateInNo);
      if (!gate) return 'tata letak belum punya gate masuk';
      const m: Mover = {
        id: trip.id,
        route: makeRoute([gate.outside]),
        v: 0,
        pauseAt: null,
        pauseLeft: 0,
        signal: 0,
        braking: false,
        s: 0,
        phase: 'hold',
        stop: null,
        entry: null,
        dest: null,
        resolving: false,
        x: gate.outside.x,
        z: gate.outside.z,
        ry: 0,
        held: 0,
      };
      // Dipasang DULU supaya sinkronisasi berikutnya tidak membuat truk kedua
      // untuk perjalanan yang sama selagi tujuannya masih dicari.
      movers.current.set(trip.id, m);

      const dest = findRef.current(trip.ctrNo) ?? (trip.position ? await resolve(trip) : null);
      if (dest) {
        const err = routeInto(m, null, dest);
        if (err) {
          movers.current.delete(trip.id);
          return err;
        }
        return null;
      }
      // Tujuan belum diketahui: masuk dan tunggu di dalam gerbang.
      const hold = holdPoint(g, gate);
      if (!hold) {
        movers.current.delete(trip.id);
        return 'tidak ada jalan di dalam gerbang untuk menunggu';
      }
      m.route = lane(hold.pts, false, false);
      m.phase = 'in';
      armGatePause(m, gate);
      setTruckRoute(m.id, m.route.pts);
      return null;
    };

    sync();
    return useTraffic.subscribe(sync);
  }, [invalidate]);

  // --- gerak per frame ------------------------------------------------------
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const lamp = useMemo(() => new THREE.Matrix4(), []);
  const sig = useMemo(() => new THREE.Matrix4(), []);
  /** Tengah muatan di atas chassis, lokal truk (lihat createChassisLoadGeometry). */
  const loadAt = useMemo(() => new THREE.Matrix4().makeTranslation(1.3 - BOX.len40 / 2, 1.45 + BOX.height / 2, 0), []);
  const cm = useMemo(() => new THREE.Matrix4(), []);
  const signalRef = useRef<THREE.InstancedMesh>(null);
  const brakeRef = useRef<THREE.InstancedMesh>(null);
  const lampGeo = useMemo(() => new THREE.SphereGeometry(0.28, 8, 6), []);
  useEffect(() => () => lampGeo.dispose(), [lampGeo]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const { trips, speed, finish, skip, rtgJobs, queueJob } = useTraffic.getState();
    const done: string[] = [];
    let moving = false;
    let n = 0;
    const loadedNow: { id: string; c: YardContainer }[] = [];
    let ns = 0;
    let nb = 0;
    const seq: string[] = [];
    // Kedip sein ±1,5 Hz, waktu nyata.
    const blink = Math.floor(performance.now() / 330) % 2 === 0;

    for (const m of movers.current.values()) {
      const trip = trips[m.id];
      if (!trip) continue;
      const job = rtgJobs[m.id];

      // Menunggu tujuan, dan kejadian "ditangani" sudah datang: database kini
      // tahu slotnya — tanyakan, lalu lanjutkan ke bay.
      if (m.phase === 'hold' && !m.dest && !m.resolving && (trip.handled || trip.position)) {
        m.resolving = true;
        void resolve(trip).then((dest) => {
          m.resolving = false;
          if (!dest) {
            skip(m.id, `${trip.ctrNo} belum punya slot di lapangan`);
            return;
          }
          const err = routeInto(m, { x: m.x, z: m.z }, dest);
          if (err) skip(m.id, err);
          invalidate();
        });
      }

      // Sampai di bay dan sudah ditangani menurut kejadian: minta RTG bekerja.
      if (m.phase === 'wait' && m.dest && trip.handled && !job) {
        queueJob({
          id: m.id,
          blockId: m.dest.block.id,
          flow: trip.flow,
          container: m.dest.c,
          truck: { x: m.x, z: m.z, ry: m.ry },
          stage: 'queued',
          rtgId: null,
          lifted: false,
          placed: false,
          queuedAt: Date.now(),
        });
      }

      // Berangkat keluar hanya setelah RTG selesai DAN gate out tercatat.
      if (m.phase === 'wait' && trip.leaving && job?.stage === 'done' && m.stop) {
        const g = graphRef.current;
        const gate = pickGate(g, 'out', trip.gateOutNo);
        const path = gate ? routeFromStop(g, m.stop, gate, m.entry) : null;
        if (!path) {
          skip(m.id, gate ? 'tidak ada jalan dari blok ke gate keluar' : 'tata letak belum punya gate keluar');
          continue;
        }
        m.route = lane(path, m.entry?.outVia ? 2 : 1, false);
        m.s = 0;
        m.phase = 'out';
        m.v = 0;
        armGatePause(m, gate!);
        setTruckRoute(m.id, m.route.pts);
      }

      if (m.phase === 'in' || m.phase === 'out') {
        moving = true;
        const step = dt * speed;
        // Kecepatan sasaran: penuh di jalan lurus, turun menjelang tikungan
        // (dilihat dari beda arah di depan), dan cukup rendah untuk bisa
        // berhenti tepat di ujung rute atau di timbangan gate.
        const here = sampleRoute(m.route, m.s + 2).ry;
        const ahead = sampleRoute(m.route, m.s + 14).ry;
        const curve = Math.min(1, Math.abs(turn(here, ahead)) / (Math.PI / 2));
        let target = DRIVE * (1 - 0.65 * curve);
        const toEnd = m.route.length - m.s;
        target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(0, toEnd)) + 0.6);
        if (m.pauseAt !== null) {
          target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(0, m.pauseAt - m.s)));
        }
        const blocked = m.held < MAX_HOLD && blockedAhead(m, movers.current.values());
        if (blocked) {
          target = 0;
          m.held += step;
        } else {
          m.held = 0;
        }
        const prev = m.v;
        m.v += Math.max(-BRAKE * step, Math.min(ACCEL * step, target - m.v));
        m.v = Math.max(0, m.v);
        m.braking = m.v < prev - 1e-4 || (m.v < 0.3 && target < 0.3);
        m.s += m.v * step;
        // Timbangan: tahan di titiknya selama GATE_PAUSE.
        if (m.pauseAt !== null && m.s >= m.pauseAt - 0.6) {
          m.s = Math.min(m.s, m.pauseAt);
          if (m.v < 0.6) {
            m.v = 0;
            m.pauseLeft -= step;
            if (m.pauseLeft <= 0) m.pauseAt = null;
          }
        }
        // Lampu sein: tikungan berarti di depan.
        const far = turn(sampleRoute(m.route, m.s).ry, sampleRoute(m.route, m.s + SIGNAL_AHEAD).ry);
        m.signal = Math.abs(far) > 0.35 && toEnd > 6 ? Math.sign(far) : 0;
        if (m.s >= m.route.length) {
          m.s = m.route.length;
          if (m.phase === 'out') {
            done.push(m.id);
            continue;
          }
          // Sampai: di bay (kalau tujuannya sudah ada) atau di area tunggu.
          m.phase = m.dest ? 'wait' : 'hold';
        }
      }
      if (n >= CAP) continue;

      const p = sampleRoute(m.route, m.s);
      m.x = p.x;
      m.z = p.z;
      m.ry = p.ry;
      setTruckPose(m.id, { x: p.x, z: p.z, ry: p.ry, phase: m.phase });
      pos.set(p.x, 0, p.z);
      q.setFromAxisAngle(up, p.ry);
      m4.compose(pos, q, one);
      for (const mesh of partRefs.current) mesh?.setMatrixAt(n, m4);
      chassisRef.current?.setMatrixAt(n, m4);
      seq[n] = m.id;

      // Lampu: sein berkedip di sisi belokan, rem menyala saat melambat atau
      // berhenti di jalan. Sisi kiri truk adalah -Z lokal (truk menghadap +X).
      const lit = m.phase === 'in' || m.phase === 'out' || m.phase === 'hold';
      if (lit && m.signal !== 0 && blink) {
        const side = m.signal > 0 ? -1.25 : 1.25;
        for (const lx of [4.2, -10.9]) {
          lamp.makeTranslation(lx, 1.15, side);
          sig.multiplyMatrices(m4, lamp);
          signalRef.current?.setMatrixAt(ns++, sig);
        }
      }
      if (lit && (m.braking || m.phase === 'hold')) {
        for (const side of [-1.05, 1.05]) {
          lamp.makeTranslation(-10.95, 1.0, side);
          sig.multiplyMatrices(m4, lamp);
          brakeRef.current?.setMatrixAt(nb++, sig);
        }
      }

      // Bongkar (R) datang bermuatan dan kosong begitu spreader mengangkatnya;
      // ambil (D) datang kosong dan bermuatan begitu spreader melepasnya.
      const loaded = trip.flow === 'R' ? !job?.lifted : !!job?.placed;
      if (loaded) {
        let c = m.dest?.c ?? ghost.current.get(m.id);
        if (!c) {
          c = { no: trip.ctrNo, size: 20, type: 'gp', status: 'empty', line: '', block: '', bay: 0, row: 0, tier: 1,
            weightKg: 0, vessel: '', inDate: '', filled: false, damaged: false, typeCode: '', isoCode: '', reefer: false, dangerous: false };
          ghost.current.set(m.id, c);
        }
        loadedNow.push({ id: m.id, c });
        const g = cargoRefs.current.get(m.id);
        if (g) {
          g.matrixAutoUpdate = false;
          g.matrix.copy(cm.multiplyMatrices(m4, loadAt));
          g.matrixWorldNeedsUpdate = true;
        }
      }
      n++;
    }
    order.current = seq;

    for (const mesh of [...partRefs.current, chassisRef.current]) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    const sigNow = loadedNow.map((x) => `${x.id}:${x.c.no}`).join(',');
    if (sigNow !== cargoSig.current) {
      cargoSig.current = sigNow;
      setCargo(loadedNow);
      invalidate();
    }
    for (const [ref, count] of [
      [signalRef, ns],
      [brakeRef, nb],
    ] as const) {
      if (!ref.current) continue;
      ref.current.count = count;
      ref.current.instanceMatrix.needsUpdate = true;
    }

    for (const id of done) {
      movers.current.delete(id);
      ghost.current.delete(id);
      dropTruck(id);
      finish(id);
    }
    if (moving || Object.values(rtgJobs).some((j) => j.stage === 'working')) invalidate();
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.instanceId !== undefined ? order.current[e.instanceId] : undefined;
    if (id) useTraffic.getState().selectTrip(id);
  };

  return (
    <>
      {parts.map((part, i) => (
        <instancedMesh
          key={part.name}
          ref={(el) => {
            partRefs.current[i] = el;
            if (el) el.count = 0;
          }}
          args={[part.geometry, part.material, CAP]}
          // Instance bergerak keluar dari bounding sphere geometri aslinya;
          // dengan culling aktif truk menghilang di tengah jalan.
          frustumCulled={false}
        />
      ))}
      {/* Klik ditangani di chassis: geometrinya kecil, dan hanya ada puluhan
          instance, jadi raycast hover R3F yang menyertainya murah. */}
      <instancedMesh
        ref={chassisRef}
        args={[chassis, undefined, CAP]}
        count={0}
        frustumCulled={false}
        onClick={onClick}
      >
        <meshPhongMaterial color="#5b636e" shininess={20} />
      </instancedMesh>
      {cargo.map(({ id, c }) => (
        <CarriedContainer
          key={`${id}:${c.no}`}
          c={c}
          ref={(el) => {
            if (el) cargoRefs.current.set(id, el);
            else cargoRefs.current.delete(id);
          }}
        />
      ))}
      {/* Lampu sein dan rem: tanpa pencahayaan supaya tampak menyala. */}
      <instancedMesh ref={signalRef} args={[lampGeo, undefined, CAP * 2]} count={0} frustumCulled={false}>
        <meshBasicMaterial color="#ffa21a" />
      </instancedMesh>
      <instancedMesh ref={brakeRef} args={[lampGeo, undefined, CAP * 2]} count={0} frustumCulled={false}>
        <meshBasicMaterial color="#ff2a2a" />
      </instancedMesh>
    </>
  );
}

/** Garis jaringan jalan — untuk memeriksa apakah jalan dan gate sudah tersambung. */
function NetworkOverlay({ graph }: { graph: RoadGraph }) {
  const geometry = useMemo(() => {
    const v: number[] = [];
    graph.adj.forEach((edges, a) => {
      for (const e of edges) {
        if (e.to < a) continue;
        const p = graph.nodes[a];
        const q = graph.nodes[e.to];
        v.push(p.x, 0.25, p.z, q.x, 0.25, q.z);
      }
    });
    for (const g of graph.gates) v.push(g.x, 0.25, g.z, g.x, 12, g.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return geo;
  }, [graph]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#38bdf8" depthTest={false} transparent opacity={0.9} />
    </lineSegments>
  );
}

/** Jejak rute truk yang dipilih: garis kuning di atas jalan. */
function RouteTrail() {
  const selected = useTraffic((s) => s.selectedTrip);
  const [version, setVersion] = useState(0);
  // Rute berubah di luar React (saat truk berangkat pulang); intip versinya.
  useFrame(() => {
    const v = routesVersion();
    if (v !== version) setVersion(v);
  });
  const geometry = useMemo(() => {
    const pts = selected ? truckRoute(selected) : null;
    if (!pts || pts.length < 2) return null;
    const v: number[] = [];
    for (const p of pts) v.push(p.x, 0.35, p.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return geo;
    // version memaksa hitung ulang saat rute berganti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, version]);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;
  return (
    <primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ffe066', depthTest: false, transparent: true, opacity: 0.95 }))} />
  );
}

export function Traffic() {
  const data = useYardView();
  const roads = useEditor((s) => s.layout?.roads);
  const equipment = useEditor((s) => s.layout?.equipment);
  const showNetwork = useTraffic((s) => s.showNetwork);
  const setDiag = useTraffic((s) => s.setDiag);

  const graph = useMemo(() => {
    if (!data) return null;
    return buildRoadGraph(data.blocks, roads ?? [], equipment ?? [], {
      x: data.meta.centerX ?? 0,
      z: data.meta.centerZ ?? 0,
    });
  }, [data, roads, equipment]);

  useEffect(() => {
    if (!graph) return;
    setDiag({
      nodes: graph.nodes.length,
      edges: graph.adj.reduce((n, e) => n + e.length, 0) / 2,
      gatesIn: graph.gates.filter((g) => g.kind !== 'out').length,
      gatesOut: graph.gates.filter((g) => g.kind !== 'in').length,
      unreachable: unreachableBlocks(graph),
      // Gate yang tidak menemukan jalan di depan maupun belakangnya: truk tidak
      // bisa masuk lewat situ, dan tanpa daftar ini penyebabnya tidak tampak.
      gatesUnlinked: graph.gates.filter((g) => graph.adj[g.node].length === 0).map((g) => g.id),
    });
  }, [graph, setDiag]);

  const find = useMemo(() => {
    const index = new Map<string, Dest>();
    for (const block of data?.blocks ?? []) {
      for (const c of block.containers) index.set(c.no.trim().toUpperCase(), { block, c });
    }
    return (ctrNo: string) => index.get(ctrNo.trim().toUpperCase()) ?? null;
  }, [data]);

  if (!graph || !data) return null;
  return (
    <>
      {showNetwork && <NetworkOverlay graph={graph} />}
      <GateBarriers graph={graph} />
      <RouteTrail />
      <Suspense fallback={null}>
        <Fleet graph={graph} find={find} blocks={data.blocks} />
      </Suspense>
    </>
  );
}
