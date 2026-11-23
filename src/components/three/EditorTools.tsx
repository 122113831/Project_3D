'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ROAD } from '@/lib/constants';
import { assetFootprint, findItem } from '@/lib/editorAssets';
import {
  blockSize,
  equipmentFootprint,
  type LayoutBlock,
  type LayoutEquipment,
  type LayoutRoad,
  type YardLayout,
} from '@/lib/layout';
import { persistBlockPlacement } from '@/lib/persist';
import { rayHit, type Ray, type Rect } from '@/lib/pick';
import { roadLen } from '@/lib/roadSnap';
import { fitRoad, snap, useEditor, type Selection } from '@/store/useEditor';
import { useYard } from '@/store/useYard';

/** Setipis apa objek datar dibuat supaya tetap bisa diklik. */
const FLAT = 0.4;

const blockRectOf = (b: LayoutBlock): Rect => {
  const { length, width } = blockSize(b);
  return {
    cx: b.originX + length / 2,
    cz: b.originZ + width / 2,
    sx: length,
    sy: FLAT,
    sz: width,
    ry: b.rot ?? 0,
  };
};
const roadRectOf = (r: LayoutRoad): Rect => ({
  cx: r.x,
  cz: r.z,
  // Kotak kliknya ikut panjang sebenarnya. Dengan ROAD.tile tetap, sebuah
  // penutup celah 0,4 m akan punya daerah klik 24 m yang menelan tetangganya.
  sx: roadLen(r),
  sy: FLAT,
  sz: ROAD.tile,
  ry: r.ry,
});
const equipRectOf = (e: LayoutEquipment): Rect => {
  const f = equipmentFootprint(e);
  return { cx: e.x, cz: e.z, sx: f.x, sy: f.y, sz: f.z, ry: e.ry };
};

/**
 * Objek TERDEKAT ke kamera yang menang.
 *
 * Dulu yang menang adalah yang alasnya paling kecil, karena semuanya diuji di
 * bidang tanah dan alat berdiri di atas blok — tanpa urutan itu klik pada RTG
 * akan memilih blok di bawahnya. Dengan uji sinar 3D urutan itu tidak perlu
 * dikarang lagi: benda yang benar-benar ditembus sinar lebih dulu memang yang
 * terlihat di depan.
 */
function hitTest(layout: YardLayout, ray: Ray): Selection {
  let best: { sel: Selection; t: number } | null = null;
  const consider = (sel: Selection, rect: Rect) => {
    const t = rayHit(rect, ray);
    if (t !== null && (!best || t < best.t)) best = { sel, t };
  };
  for (const e of layout.equipment) consider({ type: 'equipment', id: e.id }, equipRectOf(e));
  for (const r of layout.roads) consider({ type: 'road', id: r.id }, roadRectOf(r));
  for (const b of layout.blocks) consider({ type: 'block', id: b.id }, blockRectOf(b));
  return best ? (best as { sel: Selection }).sel : null;
}

function rectOf(layout: YardLayout, sel: Selection): Rect | null {
  if (!sel) return null;
  if (sel.type === 'block') {
    const b = layout.blocks.find((v) => v.id === sel.id);
    return b ? blockRectOf(b) : null;
  }
  if (sel.type === 'road') {
    const r = layout.roads.find((v) => v.id === sel.id);
    return r ? roadRectOf(r) : null;
  }
  const e = layout.equipment.find((v) => v.id === sel.id);
  return e ? equipRectOf(e) : null;
}

/** Titik jangkar objek — yang digeser saat drag. Blok memakai sudutnya. */
function anchorOf(layout: YardLayout, sel: Selection): { x: number; z: number } | null {
  if (!sel) return null;
  if (sel.type === 'block') {
    const b = layout.blocks.find((v) => v.id === sel.id);
    return b ? { x: b.originX, z: b.originZ } : null;
  }
  if (sel.type === 'road') {
    const r = layout.roads.find((v) => v.id === sel.id);
    return r ? { x: r.x, z: r.z } : null;
  }
  const e = layout.equipment.find((v) => v.id === sel.id);
  return e ? { x: e.x, z: e.z } : null;
}

/**
 * Alat sunting di dalam scene: raycast ke tanah, klik untuk menaruh atau
 * memilih, seret untuk menggeser.
 *
 * Pointer ditangani di level DOM, bukan lewat event R3F. Objek yang bisa
 * disunting cuma puluhan dan kotak alasnya diketahui, jadi uji kliknya
 * aritmetika biasa — tidak perlu satu pun mesh tambahan di scene, dan tidak
 * ada raycast yang berjalan tiap gerakan mouse.
 */
export function EditorTools() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { enabled: boolean } | null;
  const invalidate = useThree((s) => s.invalidate);

  const open = useEditor((s) => s.open);
  const tool = useEditor((s) => s.tool);
  const assetId = useEditor((s) => s.assetId);
  const layout = useEditor((s) => s.layout);
  const selected = useEditor((s) => s.selected);
  const connectFrom = useEditor((s) => s.connectFrom);
  const extentX = useYard((s) => s.data?.meta.extentX ?? 400);
  const extentZ = useYard((s) => s.data?.meta.extentZ ?? 400);
  const centerX = useYard((s) => s.data?.meta.centerX ?? 0);
  const centerZ = useYard((s) => s.data?.meta.centerZ ?? 0);

  const ghost = useRef<THREE.Mesh>(null);
  const outline = useRef<THREE.LineSegments>(null);

  // Ada tata letak atau tidak — BUKAN isinya. Kalau efek ini bergantung pada
  // objek layout-nya, tiap gerakan seret akan membongkar dan memasang ulang
  // listener di tengah seretan, dan `dragging` di bawah ikut hilang. Gejalanya
  // persis: blok bergerak satu langkah mouse lalu berhenti. Semua pembacaan
  // tata letak di dalam sini lewat useEditor.getState(), jadi selalu segar
  // tanpa perlu jadi dependency.
  const hasLayout = layout !== null;

  useEffect(() => {
    if (!open || !hasLayout) return;
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    const worldAt = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
    };

    let downAt: { x: number; y: number } | null = null;
    let dragging: { grabX: number; grabZ: number; anchorX: number; anchorZ: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      const p = worldAt(e);
      if (!p) return;

      // Seret hanya berlaku pada objek yang SUDAH terpilih. Dengan begitu klik
      // pertama memilih dan klik kedua baru menggeser — tanpa itu, satu klik
      // meleset di atas blok akan menyeretnya tanpa sengaja.
      const store = useEditor.getState();
      if (store.tool !== 'select' || !store.selected || !store.layout) return;
      const rect = rectOf(store.layout, store.selected);
      const anchor = anchorOf(store.layout, store.selected);
      // Diuji dengan SINAR, bukan titik di tanah: menyeret harus bisa dimulai
      // dari mana pun badan objek terlihat, termasuk puncak tiang lampu.
      if (!rect || !anchor || rayHit(rect, ray.ray) === null) return;

      dragging = { grabX: p.x, grabZ: p.z, anchorX: anchor.x, anchorZ: anchor.z };
      if (controls) controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      const p = worldAt(e);
      if (!p) return;

      if (dragging) {
        useEditor
          .getState()
          .moveSelected(
            dragging.anchorX + (p.x - dragging.grabX),
            dragging.anchorZ + (p.z - dragging.grabZ),
            false,
          );
        invalidate();
        return;
      }

      // Pratinjau letak: kotak hantu mengikuti kursor pada posisi ter-snap.
      // Jepretannya harus SAMA dengan yang dipakai saat menaruh, kalau tidak
      // hantunya berbohong soal tempat ubin akan mendarat.
      const g = ghost.current;
      const store = useEditor.getState();
      if (g && store.tool === 'place') {
        const item = findItem(store.assetId);
        if (item?.spec.kind === 'road') {
          const fit = fitRoad(item.spec.road.kind, p.x, p.z);
          g.position.set(fit.x, 0.09, fit.z);
          g.rotation.y = fit.ry ?? g.rotation.y;
        } else {
          g.position.set(snap(p.x), 0.09, snap(p.z));
        }
        invalidate();
      }
    };

    const onUp = (e: PointerEvent) => {
      if (dragging) {
        dragging = null;
        if (controls) controls.enabled = true;
        el.releasePointerCapture(e.pointerId);
        // Satu catatan riwayat untuk seluruh seretan, bukan per pixel.
        const p = worldAt(e);
        const store = useEditor.getState();
        if (p && store.selected) {
          const a = anchorOf(store.layout!, store.selected);
          if (a) store.moveSelected(a.x, a.z, true);
          // Blok yang ada di database ikut tersimpan posisinya. Alat dan jalan
          // tidak: keduanya tidak punya tabel, jadi tetap tinggal di tata letak
          // lokal saja.
          if (store.selected.type === 'block') persistBlockPlacement(store.selected.id);
        }
        downAt = null;
        return;
      }
      // Abaikan kalau ini gerakan orbit, bukan klik.
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
        downAt = null;
        return;
      }
      downAt = null;

      const p = worldAt(e);
      if (!p) return;
      const store = useEditor.getState();
      if (!store.layout) return;
      if (store.tool === 'select') store.select(hitTest(store.layout, ray.ray));
      else if (store.tool === 'place') store.place(p.x, p.z);
      else if (store.tool === 'connect') store.connectAt(p.x, p.z);
      // Modus 'slots' ditangani SlotGrid: kliknya mengenai sel, bukan objek.
      invalidate();
    };

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const store = useEditor.getState();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        store.removeSelected();
        invalidate();
      } else if (e.key === 'Escape') {
        store.select(null);
        store.setTool('select');
      } else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        store.undo();
        invalidate();
      } else if (e.key.toLowerCase() === 'r' && store.selected?.type !== undefined) {
        const sel = store.selected;
        // Searah jarum jam, 15 derajat sekali tekan — 24 ketukan untuk satu
        // putaran penuh. Shift memutar balik.
        const step = (e.shiftKey ? -1 : 1) * (Math.PI / 12);
        if (sel?.type === 'equipment') {
          const cur = store.layout?.equipment.find((v) => v.id === sel.id);
          if (cur) store.updateEquipment(sel.id, { ry: cur.ry + step });
        } else if (sel?.type === 'road') {
          // Ubin jalan hanya mengenal kelipatan 90 derajat. Sudut lain akan
          // memutus sambungan marka di batas ubin, dan lengan belokan tidak
          // lagi menunjuk ke ubin tetangga.
          const cur = store.layout?.roads.find((v) => v.id === sel.id);
          const quarter = (e.shiftKey ? -1 : 1) * (Math.PI / 2);
          if (cur) store.updateRoad(sel.id, { ry: cur.ry + quarter });
        } else if (sel?.type === 'block') {
          const cur = store.layout?.blocks.find((v) => v.id === sel.id);
          if (cur) {
            store.updateBlock(sel.id, { rot: (cur.rot ?? 0) + step });
            persistBlockPlacement(sel.id);
          }
        }
        invalidate();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      if (controls) controls.enabled = true;
    };
  }, [open, hasLayout, gl, camera, controls, invalidate]);

  // Sorotan objek terpilih, digambar sebagai kotak tepi di atas tanah.
  const rect = layout && selected ? rectOf(layout, selected) : null;
  const outlineGeo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  useEffect(() => () => outlineGeo.dispose(), [outlineGeo]);

  useEffect(() => {
    invalidate();
  }, [rect, tool, assetId, connectFrom, invalidate]);

  if (!open) return null;

  // Kotak hantu memakai ukuran alas kartu yang sedang aktif, jadi pratinjau
  // saat menaruh benar-benar seukuran benda yang akan muncul.
  const active = findItem(assetId);
  const ghostSize = active ? assetFootprint(active) : { x: 10, z: 10 };

  // Saat kartu jalan aktif, grid biasa diganti kisi seukuran UBIN dan
  // disejajarkan ke kisi yang sama dengan tempat ubin akan dijepret.
  //
  // Tanpa ini tidak ada apa pun di layar yang memberi tahu ke petak mana ubin
  // akan mendarat, jadi dua ubin gampang tertaruh berjauhan satu petak dan
  // jalannya tampak "tidak nyambung" padahal penjepretannya benar.
  // Kisi ubin juga tampil untuk Sambung jalan: jalurnya mengikuti petak kisi ini.
  const roadArmed = (tool === 'place' && active?.spec.kind === 'road') || tool === 'connect';
  const span = Math.ceil((Math.max(extentX, extentZ) * 1.6) / ROAD.tile) * ROAD.tile;
  const gridX = Math.round(centerX / ROAD.tile) * ROAD.tile;
  const gridZ = Math.round(centerZ / ROAD.tile) * ROAD.tile;

  return (
    <group>
      {roadArmed ? (
        <gridHelper
          args={[span, span / ROAD.tile, '#38bdf8', '#38bdf8']}
          position={[gridX, 0.05, gridZ]}
          material-transparent
          material-opacity={0.5}
        />
      ) : (
        <gridHelper
          args={[Math.max(extentX, extentZ) * 1.6, Math.round(Math.max(extentX, extentZ) / 10), '#5c6572', '#7d848d']}
          position={[centerX, 0.04, centerZ]}
        />
      )}

      {/* Sambung jalan: tiang penanda di titik awal. */}
      {tool === 'connect' && connectFrom && (
        <mesh position={[connectFrom.x, 4, connectFrom.z]}>
          <cylinderGeometry args={[0.8, 0.8, 8, 12]} />
          <meshBasicMaterial color="#38bdf8" />
        </mesh>
      )}
      {tool === 'place' && (
        <mesh ref={ghost} position-y={0.09}>
          <boxGeometry args={[ghostSize.x, 0.1, ghostSize.z]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      )}

      {rect && (
        <lineSegments
          ref={outline}
          geometry={outlineGeo}
          position={[rect.cx, rect.sy / 2, rect.cz]}
          rotation-y={rect.ry}
          scale={[rect.sx, rect.sy, rect.sz]}
        >
          <lineBasicMaterial color="#ffe066" />
        </lineSegments>
      )}
    </group>
  );
}
