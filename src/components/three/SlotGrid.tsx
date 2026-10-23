'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BOX, PITCH } from '@/lib/constants';
import { expandBlocked } from '@/lib/slots';
import type { BlockedCell, YardBlock } from '@/lib/types';
import { bayOffsetX, blockCenter } from '@/lib/yard';
import { useEditor } from '@/store/useEditor';
import { useYardView } from '@/store/useYardView';

/**
 * Kisi slot untuk editor, dan kotak merah slot terkunci untuk semua orang.
 *
 * Di editor kontainer disembunyikan (lihat YardContainers) dan tiap blok
 * digambar sebagai KISI sel seukuran satu posisi 20ft — slot x row x tier —
 * supaya yang terlihat adalah wadahnya, bukan isinya. Tiga lapis per blok:
 *
 *   - kisi garis  : satu LineSegments per blok. Garis-garisnya dibagi antar
 *                   sel (tepi sel bersama digambar sekali), jadi blok 40x6x5
 *                   cuma ~575 ruas, bukan 7.200 tepi kotak;
 *   - isi         : kotak abu-abu tembus pandang di sel yang sudah berisi
 *                   kontainer, supaya tahu slot mana yang tidak kosong;
 *   - terkunci    : kotak merah di tiap sel yang dikunci, dari dasar kunci
 *                   sampai tier teratas. Lapis ini juga tampil DI LUAR editor,
 *                   lebih redup, karena operator perlu melihatnya.
 *
 * Semua digambar di kerangka LOKAL blok — pusat blok di titik nol, lalu grup
 * diputar dan digeser — dengan rumus yang sama seperti aroundBlock di yard.ts,
 * jadi kisi tidak bisa meleset dari tumpukannya saat blok diputar.
 *
 * Klik dan hover di modus 'slots' diuji dengan aritmetika, bukan raycast
 * three: sinar dipindah ke kerangka lokal blok dan diuji terhadap kotak blok
 * dulu, baru terhadap sel-selnya. Ribuan uji slab per klik itu murah; yang
 * mahal adalah ribuan mesh yang bisa diraycast.
 */

type Dims = Pick<YardBlock, 'slots' | 'rows' | 'tiers'>;

/** Pusat sel (bay, row, tier) di kerangka lokal blok. */
function cellCenter(b: YardBlock, bay: number, row: number, tier: number, size: 20 | 40 = 20) {
  const length = b.slots * PITCH.teu;
  const width = b.rows * PITCH.row;
  return new THREE.Vector3(
    bayOffsetX(b, bay, size) - length / 2,
    (tier - 1) * PITCH.tier + BOX.height / 2,
    (row + 0.5) * PITCH.row - width / 2,
  );
}

function latticeGeometry(b: Dims) {
  const L = b.slots * PITCH.teu;
  const W = b.rows * PITCH.row;
  const H = b.tiers * PITCH.tier;
  const v: number[] = [];
  for (let j = 0; j <= b.rows; j++) {
    const z = j * PITCH.row - W / 2;
    for (let k = 0; k <= b.tiers; k++) v.push(-L / 2, k * PITCH.tier, z, L / 2, k * PITCH.tier, z);
  }
  for (let i = 0; i <= b.slots; i++) {
    const x = i * PITCH.teu - L / 2;
    for (let k = 0; k <= b.tiers; k++) v.push(x, k * PITCH.tier, -W / 2, x, k * PITCH.tier, W / 2);
    for (let j = 0; j <= b.rows; j++) {
      const z = j * PITCH.row - W / 2;
      v.push(x, 0, z, x, H, z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

/** Uji slab sinar lokal terhadap kotak [lo, hi]; jarak t atau null. */
function slab(o: THREE.Vector3, d: THREE.Vector3, lo: number[], hi: number[]): number | null {
  let tMin = -Infinity;
  let tMax = Infinity;
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) {
      if (oo[i] < lo[i] || oo[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - oo[i]) / dd[i];
    let t2 = (hi[i] - oo[i]) / dd[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMax < tMin) return null;
  }
  if (tMax < 0) return null;
  return tMin >= 0 ? tMin : tMax;
}

export type SlotHit = { block: YardBlock; bay: number; row: number; tier: number; t: number };

/** Sel terdekat yang ditembus sinar, di antara semua blok. */
export function pickSlot(blocks: readonly YardBlock[], ray: THREE.Ray): SlotHit | null {
  let best: SlotHit | null = null;
  const o = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (const b of blocks) {
    const [cx, cz] = blockCenter(b);
    const rot = b.rot ?? 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // Sinar ke kerangka lokal: balikan dari rotasi aroundBlock (lihat pick.ts).
    const ox = ray.origin.x - cx;
    const oz = ray.origin.z - cz;
    o.set(ox * c - oz * s, ray.origin.y, ox * s + oz * c);
    d.set(ray.direction.x * c - ray.direction.z * s, ray.direction.y, ray.direction.x * s + ray.direction.z * c);

    const L = b.slots * PITCH.teu;
    const W = b.rows * PITCH.row;
    const H = b.tiers * PITCH.tier;
    const tBlock = slab(o, d, [-L / 2, 0, -W / 2], [L / 2, H, W / 2]);
    if (tBlock === null || (best && tBlock > best.t)) continue;

    for (let pos = 0; pos < b.slots; pos++) {
      const x0 = pos * PITCH.teu - L / 2;
      for (let row = 0; row < b.rows; row++) {
        const z0 = row * PITCH.row - W / 2;
        for (let tier = 1; tier <= b.tiers; tier++) {
          const y0 = (tier - 1) * PITCH.tier;
          const t = slab(o, d, [x0, y0, z0], [x0 + PITCH.teu, y0 + PITCH.tier, z0 + PITCH.row]);
          if (t !== null && (!best || t < best.t)) {
            // Posisi fisik → indeks bay data, mengikuti SLOT_START seperti
            // bayOffsetX; kuncinya disimpan per bay data supaya tetap menempel
            // pada slot bernomor sama walau arah penomoran diubah.
            const bay = b.slotStart === 'R' ? b.slots - 1 - pos : pos;
            best = { block: b, bay, row, tier, t };
          }
        }
      }
    }
  }
  return best;
}

/**
 * Sel pada TIER TERTENTU di bawah kursor: sinar dipotongkan dengan bidang
 * datar di tengah ketinggian tier itu, lalu titik potongnya dicari di petak
 * blok mana. Dengan cara ini sel di tengah blok bisa dipilih — pickSlot yang
 * mengambil sel terdepan tidak pernah bisa sampai ke sana.
 */
export function pickSlotAtTier(blocks: readonly YardBlock[], ray: THREE.Ray, tier: number): SlotHit | null {
  const y = (tier - 0.5) * PITCH.tier;
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = (y - ray.origin.y) / ray.direction.y;
  if (t <= 0) return null;
  const px = ray.origin.x + ray.direction.x * t;
  const pz = ray.origin.z + ray.direction.z * t;
  for (const b of blocks) {
    if (tier > b.tiers) continue;
    const [cx, cz] = blockCenter(b);
    const rot = b.rot ?? 0;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const dx = px - cx;
    const dz = pz - cz;
    const lx = dx * c - dz * s + (b.slots * PITCH.teu) / 2;
    const lz = dx * s + dz * c + (b.rows * PITCH.row) / 2;
    if (lx < 0 || lz < 0 || lx >= b.slots * PITCH.teu || lz >= b.rows * PITCH.row) continue;
    const pos = Math.floor(lx / PITCH.teu);
    const row = Math.floor(lz / PITCH.row);
    const bay = b.slotStart === 'R' ? b.slots - 1 - pos : pos;
    return { block: b, bay, row, tier, t };
  }
  return null;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** Satu InstancedMesh kotak, matriksnya ditulis dari daftar pusat + skala. */
function Boxes({
  items,
  color,
  opacity,
  geometry,
}: {
  items: { p: THREE.Vector3; sx: number }[];
  color: string;
  opacity: number;
  geometry: THREE.BoxGeometry;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((it, i) => {
      _s.set(it.sx, 1, 1);
      _m.compose(it.p, _q, _s);
      mesh.setMatrixAt(i, _m);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, Math.max(1, items.length)]} frustumCulled={false}>
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </instancedMesh>
  );
}

function BlockGrid({
  b,
  editing,
  geo,
  tierPlane,
}: {
  b: YardBlock;
  editing: boolean;
  geo: { cell: THREE.BoxGeometry; lock: THREE.BoxGeometry };
  /** Tier yang sedang dibidik di modus kunci; null = tidak digambar. */
  tierPlane: number | null;
}) {
  const lattice = useMemo(() => latticeGeometry(b), [b]);
  useEffect(() => () => lattice.dispose(), [lattice]);

  const occupied = useMemo(
    () =>
      editing
        ? b.containers.map((c) => ({
            p: cellCenter(b, c.bay, c.row, c.tier, c.size),
            sx: c.size === 40 ? BOX.len40 / BOX.len20 : 1,
          }))
        : [],
    [b, editing],
  );
  const locked = useMemo(
    () => expandBlocked(b.blocked, b).map((c: BlockedCell) => ({ p: cellCenter(b, c.bay, c.row, c.tier), sx: 1 })),
    [b],
  );

  const [cx, cz] = blockCenter(b);
  if (!editing && locked.length === 0) return null;
  return (
    <group position={[cx, 0, cz]} rotation-y={b.rot ?? 0}>
      {editing && (
        <lineSegments geometry={lattice}>
          <lineBasicMaterial color="#cbd5e1" transparent opacity={0.38} depthWrite={false} />
        </lineSegments>
      )}
      {editing && <Boxes items={occupied} color="#94a3b8" opacity={0.28} geometry={geo.cell} />}
      {/* Lantai tier yang dibidik: bidang tipis biru setinggi dasar tier itu,
          supaya terlihat di tingkat mana klik akan mendarat. */}
      {editing && tierPlane !== null && tierPlane <= b.tiers && (
        <mesh position={[0, (tierPlane - 1) * PITCH.tier + 0.03, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[b.slots * PITCH.teu, b.rows * PITCH.row]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.14} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <Boxes items={locked} color="#ef4444" opacity={editing ? 0.5 : 0.32} geometry={geo.lock} />
    </group>
  );
}

export function SlotGrid() {
  const data = useYardView();
  const editing = useEditor((s) => s.open);
  const tool = useEditor((s) => s.tool);
  const lockTier = useEditor((s) => s.lockTier);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  const geo = useMemo(
    () => ({
      cell: new THREE.BoxGeometry(BOX.len20, BOX.height, BOX.width),
      // Sedikit lebih besar dari kontainer: di luar editor, sel terkunci yang
      // ternyata berisi tetap kelihatan merah di sekeliling kontainernya.
      lock: new THREE.BoxGeometry(BOX.len20 + 0.3, BOX.height + 0.3, BOX.width + 0.3),
      hover: new THREE.EdgesGeometry(new THREE.BoxGeometry(PITCH.teu, PITCH.tier, PITCH.row)),
    }),
    [],
  );
  useEffect(
    () => () => {
      geo.cell.dispose();
      geo.lock.dispose();
      geo.hover.dispose();
    },
    [geo],
  );

  // Sorotan sel di bawah kursor — digerakkan langsung, tanpa render React.
  const hover = useRef<THREE.LineSegments>(null);
  const blocksRef = useRef<readonly YardBlock[]>([]);
  blocksRef.current = data?.blocks ?? [];
  const tierRef = useRef(1);
  tierRef.current = lockTier;

  const active = editing && tool === 'slots';
  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const marker = hover.current;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down: { x: number; y: number } | null = null;
    let lastKey = '';

    const rayAt = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray;
    };
    const place = (h: SlotHit | null) => {
      const m = marker;
      if (!m) return;
      const k = h ? `${h.block.id}:${h.bay}:${h.row}:${h.tier}` : '';
      if (k === lastKey) return;
      lastKey = k;
      m.visible = h !== null;
      if (h) {
        const [cx, cz] = blockCenter(h.block);
        const c = cellCenter(h.block, h.bay, h.row, h.tier);
        c.y = (h.tier - 0.5) * PITCH.tier;
        const rot = h.block.rot ?? 0;
        m.position.set(cx + c.x * Math.cos(rot) + c.z * Math.sin(rot), c.y, cz - c.x * Math.sin(rot) + c.z * Math.cos(rot));
        m.rotation.y = rot;
      }
      invalidate();
    };

    // Bidang tier yang dibidik dulu; kalau kursor di luar petak blok pada
    // tier itu, baru sel terdepan yang kena sinar (misalnya sisi tumpukan).
    const pick = (ray: THREE.Ray) =>
      pickSlotAtTier(blocksRef.current, ray, tierRef.current) ?? pickSlot(blocksRef.current, ray);
    const onMove = (e: PointerEvent) => place(pick(rayAt(e)));
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
        down = null;
        return;
      }
      down = null;
      const h = pick(rayAt(e));
      if (h) {
        useEditor.getState().toggleSlot(h.block.id, h.bay, h.row, h.tier);
        invalidate();
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      if (marker) marker.visible = false;
      invalidate();
    };
  }, [active, gl, camera, invalidate]);

  useEffect(() => {
    invalidate();
  }, [editing, data, lockTier, active, invalidate]);

  if (!data) return null;
  return (
    <group>
      {data.blocks.map((b) => (
        <BlockGrid key={b.id} b={b} editing={editing} geo={geo} tierPlane={active ? lockTier : null} />
      ))}
      {active && (
        <lineSegments ref={hover} geometry={geo.hover} visible={false}>
          <lineBasicMaterial color="#ffe066" />
        </lineSegments>
      )}
    </group>
  );
}
