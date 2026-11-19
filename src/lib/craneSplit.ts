import * as THREE from 'three';
import type { ModelPart } from './containerModel';

/**
 * Memisah aset RTG menjadi bagian yang diam dan bagian yang bergerak.
 *
 * Model rtg_crane.glb adalah SATU mesh statis: rangka portal, trolley, dan
 * spreader menyatu, dan tulang Spreader_LR / Spreader_UP_DOWN di dalamnya
 * hanya penanda tanpa skin. Supaya trolley dan spreader ASLI-nya yang bergerak
 * — bukan tiruan yang menempel di samping alat yang diam — segitiganya dipilah
 * menurut letaknya (koordinat model, meter):
 *
 *   - spreader : pita tengah bentang |z + 8,78| < 2,4, ketinggian 5–10,5 m
 *   - trolley  : pita yang sama, di atas 13,2 m, di antara girder (x 0,9–8,6)
 *   - tali     : pita yang sama, 10,5–13,2 m — disembunyikan saat bekerja,
 *                diganti kabel yang ikut memanjang
 *   - rangka   : sisanya
 *
 * Angka-angka ini dibaca dari sebaran segitiga model itu sendiri (lihat
 * scratchpad glb-analyze); kalau asetnya diganti, angkanya ikut diperiksa.
 */

export const CRANE_REST = {
  /** Pusat trolley/spreader pada sumbu bentang, koordinat model. */
  z: -8.78,
} as const;

const BAND = 2.4;
type Group = 'frame' | 'trolley' | 'spreader' | 'rope';

function classify(cx: number, cy: number, cz: number): Group {
  if (Math.abs(cz - CRANE_REST.z) >= BAND) return 'frame';
  if (cy >= 5 && cy <= 10.5) return 'spreader';
  if (cy > 10.5 && cy < 13.2) return 'rope';
  if (cy >= 13.2 && cx >= 0.9 && cx <= 8.6) return 'trolley';
  return 'frame';
}

export type SplitCrane = {
  frame: ModelPart[];
  trolley: ModelPart[];
  spreader: ModelPart[];
  /** Alas spreader saat diam, koordinat model. */
  spreaderBottom: number;
  /** Puncak kepala spreader saat diam, koordinat model. */
  spreaderTop: number;
};

const cache = new WeakMap<ModelPart[], SplitCrane>();

export function splitCrane(parts: ModelPart[]): SplitCrane {
  const hit = cache.get(parts);
  if (hit) return hit;
  const out: SplitCrane = { frame: [], trolley: [], spreader: [], spreaderBottom: Infinity, spreaderTop: -Infinity };
  for (const part of parts) {
    const src = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    const pos = src.getAttribute('position') as THREE.BufferAttribute;
    const nor = src.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const buckets: Record<Group, { p: number[]; n: number[] }> = {
      frame: { p: [], n: [] },
      trolley: { p: [], n: [] },
      spreader: { p: [], n: [] },
      rope: { p: [], n: [] },
    };
    for (let t = 0; t < pos.count; t += 3) {
      const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
      const cy = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
      const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
      const g = classify(cx, cy, cz);
      const b = buckets[g];
      for (let k = 0; k < 3; k++) {
        b.p.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
        if (nor) b.n.push(nor.getX(t + k), nor.getY(t + k), nor.getZ(t + k));
        if (g === 'spreader') {
          out.spreaderBottom = Math.min(out.spreaderBottom, pos.getY(t + k));
          out.spreaderTop = Math.max(out.spreaderTop, pos.getY(t + k));
        }
      }
    }
    for (const g of ['frame', 'trolley', 'spreader'] as const) {
      const b = buckets[g];
      if (b.p.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      if (b.n.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      else geo.computeVertexNormals();
      out[g].push({ ...part, name: `${part.name}:${g}`, geometry: geo });
    }
  }
  if (!Number.isFinite(out.spreaderBottom)) {
    out.spreaderBottom = 6;
    out.spreaderTop = 9;
  }
  cache.set(parts, out);
  return out;
}
