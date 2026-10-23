'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { TRUCK_MODEL_URL, truckModelFor } from '@/lib/containerModel';
import { createChassisGeometry, createChassisLoadGeometry } from '@/lib/geometry';
import {
  buildRoadGraph,
  keepLeft,
  makeRoute,
  routeFromStop,
  routeToStop,
  sampleRoute,
  stopFor,
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
import {
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

type Dest = { block: YardBlock; c: YardContainer };

type Mover = {
  id: string;
  route: Route;
  s: number;
  /** in: menuju tujuan · hold: menunggu tujuan · wait: di bay · out: pulang */
  phase: 'in' | 'hold' | 'wait' | 'out';
  stop: { pt: Pt; links: number[] } | null;
  dest: Dest | null;
  /** Sedang bertanya tujuan ke database. */
  resolving: boolean;
  x: number;
  z: number;
  ry: number;
  held: number;
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

function Fleet({ graph, find, blocks }: {
  graph: RoadGraph;
  find: (ctrNo: string) => Dest | null;
  blocks: readonly YardBlock[];
}) {
  const gltf = useGLTF(TRUCK_MODEL_URL, false, false);
  const parts = useMemo(() => truckModelFor(gltf).parts20, [gltf]);
  const chassis = useMemo(() => createChassisGeometry(), []);
  const load = useMemo(() => createChassisLoadGeometry(), []);

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
  const loadRef = useRef<THREE.InstancedMesh>(null);

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
    if (!stop) return `blok ${dest.block.id} tidak dikenal`;
    let path: Pt[] | null;
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
      path = routeToStop(g, fake, stop);
    } else {
      const trip = useTraffic.getState().trips[m.id];
      const gate = pickGate(g, 'in', trip?.gateInNo ?? null);
      if (!gate) return 'tata letak belum punya gate masuk';
      path = routeToStop(g, gate, stop);
    }
    if (!path) return `blok ${dest.block.id} tidak tersambung jalan ke gate`;
    m.route = makeRoute(keepLeft(path, KEEP_LEFT, !!from, true));
    m.s = 0;
    m.phase = 'in';
    m.stop = stop;
    m.dest = dest;
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
        s: 0,
        phase: 'hold',
        stop: null,
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
      m.route = makeRoute(keepLeft(hold.pts, KEEP_LEFT, false, false));
      m.phase = 'in';
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

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const { trips, speed, finish, skip, rtgJobs, queueJob } = useTraffic.getState();
    const done: string[] = [];
    let moving = false;
    let n = 0;
    let nl = 0;
    const seq: string[] = [];

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
        const path = gate ? routeFromStop(g, m.stop, gate) : null;
        if (!path) {
          skip(m.id, gate ? 'tidak ada jalan dari blok ke gate keluar' : 'tata letak belum punya gate keluar');
          continue;
        }
        m.route = makeRoute(keepLeft(path, KEEP_LEFT, true, false));
        m.s = 0;
        m.phase = 'out';
        setTruckRoute(m.id, m.route.pts);
      }

      if (m.phase === 'in' || m.phase === 'out') {
        moving = true;
        if (m.held < MAX_HOLD && blockedAhead(m, movers.current.values())) {
          m.held += dt * speed;
        } else {
          m.held = 0;
          m.s += dt * DRIVE * speed;
        }
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

      // Bongkar (R) datang bermuatan dan kosong begitu spreader mengangkatnya;
      // ambil (D) datang kosong dan bermuatan begitu spreader melepasnya.
      const loaded = trip.flow === 'R' ? !job?.lifted : !!job?.placed;
      if (loaded) loadRef.current?.setMatrixAt(nl++, m4);
      n++;
    }
    order.current = seq;

    for (const mesh of [...partRefs.current, chassisRef.current]) {
      if (!mesh) continue;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (loadRef.current) {
      loadRef.current.count = nl;
      loadRef.current.instanceMatrix.needsUpdate = true;
    }

    for (const id of done) {
      movers.current.delete(id);
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
      <instancedMesh ref={loadRef} args={[load, undefined, CAP]} count={0} frustumCulled={false}>
        <meshPhongMaterial color="#c9762f" shininess={20} />
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
      <RouteTrail />
      <Suspense fallback={null}>
        <Fleet graph={graph} find={find} blocks={data.blocks} />
      </Suspense>
    </>
  );
}
