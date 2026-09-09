'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE, PITCH } from '@/lib/constants';
import type { YardBlock } from '@/lib/types';
import { aroundBlock, laneSide, slotNumberAt } from '@/lib/yard';
import { useYardView } from '@/store/useYardView';

const CELL = 128;
const ATLAS_COLS = 12;

/** Ukuran quad di dunia, dalam meter. Sel atlas persegi, jadi quad juga. */
const BLOCK_LABEL = 11;
const SLOT_LABEL = 3.8;
const ROW_LABEL = 2.5;

/**
 * Nomor slot dicat di LAJUR LAYANAN, di sisi +Z bloknya sendiri.
 *
 * Sisi -Z sempat dipakai, tapi di sana cuma ada 1,8 m bersih antara garis tepi
 * jalan dan rel RTG — nomor setinggi 1,5 m yang muat di situ cuma sekitar 8
 * piksel dari kamera awal, jadi praktis tidak terbaca. Lajur layanan lebarnya
 * 4,2 m dan itu justru tempat nomor bay dicat di terminal sungguhan: di sisi
 * yang dilihat sopir truk saat mengantre.
 */
const SLOT_LABEL_OFFSET = (LANE.service.from + LANE.service.to) / 2;

type Placed = { text: string; size: number; x: number; z: number; rot: number };

/**
 * Semua teks di lapangan — nomor blok, nomor slot, nomor row — dalam SATU
 * draw call.
 *
 * Versi naifnya (satu mesh teks per label) memakan ribuan draw call begitu
 * tiap slot ikut dinomori. Tekniknya sama seperti sebelumnya, cuma sekarang
 * atlasnya menampung sembarang teks, bukan cuma kode blok: semua label
 * dilukis ke satu canvas, tiap quad diberi UV yang menunjuk ke selnya, lalu
 * seluruh quad digabung jadi satu geometry.
 */
function buildAtlas(labels: readonly string[]) {
  const rows = Math.max(1, Math.ceil(labels.length / ATLAS_COLS));
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * CELL;
  canvas.height = rows * CELL;

  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const index = new Map<string, number>();
  labels.forEach((text, i) => {
    index.set(text, i);
    const cx = (i % ATLAS_COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / ATLAS_COLS) * CELL + CELL / 2;

    // Kecilkan font sampai muat: kode blok bisa tiga huruf, nomor slot dua
    // digit, dan keduanya berbagi sel seukuran sama.
    let px = Math.round(CELL * 0.68);
    do {
      ctx.font = `bold ${px}px ui-sans-serif, system-ui, sans-serif`;
      if (ctx.measureText(text).width <= CELL * 0.82) break;
      px -= 4;
    } while (px > 12);

    ctx.fillStyle = 'rgba(28, 34, 42, 0.86)';
    ctx.fillText(text, cx, cy);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, atlasRows: rows, index };
}

/** Satu quad datar di atas aspal, UV-nya diarahkan ke sel `cell` di atlas. */
function quad(p: Placed, cell: number, atlasRows: number) {
  const g = new THREE.PlaneGeometry(p.size, p.size);
  g.rotateX(-Math.PI / 2);
  // Teksnya ikut miring bersama bloknya, jadi nomor slot tetap sejajar
  // barisan petaknya, bukan menghadap utara sendirian.
  if (p.rot !== 0) g.rotateY(p.rot);
  g.translate(p.x, 0.05, p.z);

  const col = cell % ATLAS_COLS;
  const row = Math.floor(cell / ATLAS_COLS);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let v = 0; v < uv.count; v++) {
    uv.setXY(
      v,
      (col + uv.getX(v)) / ATLAS_COLS,
      // baris atlas dihitung dari atas, UV dari bawah
      (atlasRows - 1 - row + uv.getY(v)) / atlasRows,
    );
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Nomor slot dicat di aspal SEBELUM tepi blok (sisi -Z), nomor row di ujung
 * kiri (sisi -X) — sama seperti di lapangan sungguhan, di luar petak tumpukan
 * supaya tidak tertutup kontainer.
 */
function place(blocks: readonly YardBlock[]): Placed[] {
  const out: Placed[] = [];
  for (const b of blocks) {
    const length = b.slots * PITCH.teu;
    const width = b.rows * PITCH.row;
    const rot = b.rot ?? 0;
    // Semua label diukur dari PUSAT blok supaya ikut mengorbit saat bloknya
    // diputar; aroundBlock yang mengerjakan putarannya.
    const at = (dx: number, dz: number) => {
      const [x, z] = aroundBlock(b, dx, dz);
      return { x, z, rot };
    };

    out.push({
      text: b.id,
      size: BLOCK_LABEL,
      ...at(-length / 2 - BLOCK_LABEL, 0),
    });

    // Satu nomor per POSISI FISIK, dipusatkan pada petaknya. Angka yang tercetak
    // datang dari slotNumberAt, yang tahu penomoran sumbernya (depot naik 2:
    // 1, 3, 5, … seperti YARD_SLOT; demo naik 1) sekaligus dari ujung mana
    // penomoran dimulai (SLOT_START).
    //
    // Nomornya dicat di lajur layanan, jadi ia ikut ke sisi mana pun lajur itu
    // berada.
    const lane = laneSide(b);
    for (let pos = 0; pos < b.slots; pos++) {
      out.push({
        text: String(slotNumberAt(b, pos)),
        size: SLOT_LABEL,
        ...at((pos + 0.5) * PITCH.teu - length / 2, lane * (width / 2 + SLOT_LABEL_OFFSET)),
      });
    }

    for (let row = 0; row < b.rows; row++) {
      out.push({
        text: String(row + 1),
        size: ROW_LABEL,
        ...at(-length / 2 - ROW_LABEL / 2 - 0.7, (row + 0.5) * PITCH.row - width / 2),
      });
    }
  }
  return out;
}

function buildOutlineGeometry(blocks: readonly YardBlock[]) {
  // Tiap blok punya ukurannya sendiri, jadi tidak ada satu geometri dasar
  // yang bisa dipakai bersama.
  const parts = blocks.map((b) => {
    const length = b.slots * PITCH.teu;
    const width = b.rows * PITCH.row;
    const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(length, width));
    g.rotateX(-Math.PI / 2);
    if (b.rot) g.rotateY(b.rot);
    const [cx, cz] = aroundBlock(b, 0, 0);
    g.translate(cx, 0.06, cz);
    return g;
  });
  return mergeGeometries(parts, false)!;
}

export function BlockLabels() {
  const data = useYardView();
  const blocks = useMemo(() => data?.blocks ?? [], [data]);

  const built = useMemo(() => {
    if (blocks.length === 0) return null;
    const placed = place(blocks);
    // Atlas hanya menyimpan teks yang BERBEDA: nomor slot dan row berulang di
    // setiap blok, jadi tanpa dedup atlasnya membengkak berkali-kali lipat.
    const unique = [...new Set(placed.map((p) => p.text))];
    const { texture, atlasRows, index } = buildAtlas(unique);
    return {
      texture,
      labels: mergeGeometries(
        placed.map((p) => quad(p, index.get(p.text)!, atlasRows)),
        false,
      )!,
      outlines: buildOutlineGeometry(blocks),
    };
  }, [blocks]);

  useEffect(() => {
    if (!built) return;
    return () => {
      built.texture.dispose();
      built.labels.dispose();
      built.outlines.dispose();
    };
  }, [built]);

  if (!built) return null;

  return (
    <group>
      <mesh geometry={built.labels}>
        <meshBasicMaterial map={built.texture} transparent depthWrite={false} />
      </mesh>
      <lineSegments geometry={built.outlines}>
        <lineBasicMaterial color="#39424e" transparent opacity={0.4} />
      </lineSegments>
    </group>
  );
}
