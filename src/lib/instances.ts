import * as THREE from 'three';
import { colorFor, GHOST_COLOR, HIGHLIGHT_COLOR } from './palette';
import { containerPosition } from './yard';
import type {
  ColorMode,
  ContainerStatus,
  TypeFilter,
  YardBlock,
  YardContainer,
  YardFilter,
} from './types';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();

/**
 * Menulis matriks transform seluruh kontainer sekali saja.
 * instanceMatrix ditandai StaticDrawUsage karena posisi tidak pernah berubah —
 * driver boleh menyimpannya di memori GPU yang tidak pernah di-upload ulang.
 */
export function writeMatrices(
  mesh: THREE.InstancedMesh,
  block: YardBlock,
  items: readonly YardContainer[],
) {
  // Seluruh isi blok berputar bersama bloknya: posisinya diputar oleh
  // containerPosition, dan ARAH HADAPnya oleh kuaternion ini. Tanpa yang
  // kedua, kontainer akan berpindah mengikuti blok tapi tetap menghadap utara.
  _q.setFromAxisAngle(_axisY, block.rot ?? 0);

  for (let i = 0; i < items.length; i++) {
    const [x, y, z] = containerPosition(block, items[i]);
    _p.set(x, y, z);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

/**
 * Apakah kontainer ini memenuhi satu pilihan status.
 *
 * Diperiksa terhadap FAKTA MENTAH, bukan kategori turunan `c.status`. Kategori
 * itu hanya menyimpan satu sifat dan yang lebih genting menang — reefer yang
 * kosong berkategori 'reefer' — jadi menyaring dengannya membuat "Kosong"
 * diam-diam melewatkan setiap reefer, setiap kontainer rusak, dan setiap
 * barang berbahaya yang kebetulan juga kosong.
 *
 * 'reefer' masih dilayani di sini walau chip-nya sudah pindah ke Jenis: filter
 * yang tersimpan dari versi sebelumnya bisa saja masih memuatnya.
 */
const statusMatch = (c: YardContainer, s: ContainerStatus): boolean => {
  switch (s) {
    case 'full':
      return c.filled;
    case 'empty':
      return !c.filled;
    case 'damaged':
      return c.damaged;
    case 'dangerous':
      return c.dangerous;
    case 'reefer':
      return c.reefer;
  }
};

/** Reefer disaring dari sifatnya sendiri; sisanya dari bentuk yang digambar. */
const typeMatch = (c: YardContainer, t: TypeFilter): boolean =>
  t === 'reefer' ? c.reefer : c.type === t;

export function matchesFilter(c: YardContainer, f: YardFilter): boolean {
  if (f.lines.length && !f.lines.includes(c.line)) return false;
  if (f.statuses.length && !f.statuses.some((s) => statusMatch(c, s))) return false;
  if (f.sizes.length && !f.sizes.includes(c.size)) return false;
  if (f.types.length && !f.types.some((t) => typeMatch(c, t))) return false;
  return true;
}

/**
 * Menulis warna per instance. Filter tidak menghapus kontainer dari buffer —
 * yang tidak cocok hanya diredupkan, jadi mengubah filter cuma menyentuh
 * instanceColor (murah), bukan instanceMatrix.
 */
export function writeColors(
  mesh: THREE.InstancedMesh,
  items: readonly YardContainer[],
  mode: ColorMode,
  filter: YardFilter,
  selectedNo: string | null,
  /**
   * Material lapisan ini sudah membawa cat aslinya sendiri.
   *
   * instanceColor adalah PENGALI, jadi lapisan seperti itu harus diberi putih —
   * mengalikannya dengan warna aset lagi akan menggandakan catnya.
   */
  ownColors = false,
) {
  const filtering =
    filter.lines.length > 0 ||
    filter.statuses.length > 0 ||
    filter.sizes.length > 0 ||
    filter.types.length > 0;

  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    if (c.no === selectedNo) _c.set(HIGHLIGHT_COLOR);
    else if (filtering && !matchesFilter(c, filter)) _c.set(GHOST_COLOR);
    else if (ownColors) _c.setRGB(1, 1, 1);
    else _c.set(colorFor(c, mode));
    mesh.setColorAt(i, _c);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
