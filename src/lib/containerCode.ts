import * as THREE from 'three';

/**
 * Nomor kontainer ASLI di badan kontainer realistis, per instance.
 *
 * Tiap kontainer membawa nomornya sendiri (11 karakter ISO 6346: 4 huruf
 * pemilik, 6 digit seri, 1 check digit) plus kode ukuran-jenis ISO (4
 * karakter) sebagai dua atribut instance. Shader cat menggambar hurufnya dari
 * satu atlas glyph di "zona kode" pada atlas marka — jadi ribuan nomor berbeda
 * tetap satu draw call per kelompok, tanpa tekstur per kontainer.
 *
 * Pengodean: karakter → indeks 0–35 (0–9, A–Z), 36 = kosong. Tiga karakter
 * dipadatkan ke satu float (c0 + c1·37 + c2·37²  < 2²⁴, eksak di float32).
 *   aCode0.xyzw = karakter 0–11   (nomor kontainer)
 *   aCode1.x    = karakter 12–14  (tiga karakter terakhir ISO; karakter ke-11 = ISO[0])
 *   aCode1.w    = 2 → penanda "ada kode"; atribut yang tidak diisi bernilai
 *                 bawaan WebGL (0,0,0,1), jadi w=1 berarti "jangan gambar".
 */

export const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const BLANK = 36;
export const CODE_VALID = 2;
/** Lebar slot huruf relatif tinggi hurufnya (huruf condensed). */
export const SLOT_ASPECT = 0.5;

const charIndex = (ch: string) => {
  const i = GLYPHS.indexOf(ch);
  return i < 0 ? BLANK : i;
};

/** 15 karakter: nomor kontainer (11) + ISO (4), dirapikan dan diberi spasi. */
export function codeString(no: string, iso: string): string {
  const n = no.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11).padEnd(11, ' ');
  const i = iso.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4).padEnd(4, ' ');
  return n + i;
}

/** Tulis 8 float (aCode0 + aCode1) untuk satu kontainer ke `out` mulai `o`. */
export function encodeCode(no: string, iso: string, out0: Float32Array, out1: Float32Array, i: number) {
  const s = codeString(no, iso);
  const pack = (a: number) => charIndex(s[a]) + charIndex(s[a + 1]) * 37 + charIndex(s[a + 2]) * 1369;
  out0[i * 4] = pack(0);
  out0[i * 4 + 1] = pack(3);
  out0[i * 4 + 2] = pack(6);
  out0[i * 4 + 3] = pack(9);
  out1[i * 4] = pack(12);
  out1[i * 4 + 1] = 0;
  out1[i * 4 + 2] = 0;
  out1[i * 4 + 3] = CODE_VALID;
}

/** Kebalikan encodeCode — persis rumus di shader. Dipakai uji. */
export function decodeChar(code0: ArrayLike<number>, code1: ArrayLike<number>, k: number): number {
  const v = k < 12 ? code0[Math.floor(k / 3)] : code1[0];
  const d = [1, 37, 1369][k % 3];
  return Math.floor(Math.round(v) / d) % 37;
}

/** Kode ukuran-jenis: dari data kalau valid, kalau tidak ditebak dari ukuran & reefer. */
export function isoFor(c: { isoCode?: string; size: number; reefer?: boolean }): string {
  const iso = (c.isoCode ?? '').toUpperCase().trim();
  if (/^[0-9][0-9A-Z][A-Z0-9]{2}$/.test(iso)) return iso;
  if (c.size >= 40) return c.reefer ? '45R1' : '42G1';
  return c.reefer ? '22R1' : '22G1';
}

/**
 * Salinan geometri yang berbagi semua atribut aslinya (buffer GPU tidak
 * berlipat) plus atribut instance aCode0/aCode1 untuk `items`.
 */
export function withCodes(
  base: THREE.BufferGeometry,
  items: readonly { no: string; iso: string }[],
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
  // Indeks ikut dibagi: tanpa ini geometri berindeks digambar sebagai daftar
  // segitiga mentah dari atribut posisinya — bentuknya rusak dan vertexnya
  // tidak dipakai ulang.
  g.setIndex(base.getIndex());
  g.boundingSphere = base.boundingSphere;
  g.boundingBox = base.boundingBox;
  const n = Math.max(1, items.length);
  const a0 = new Float32Array(n * 4);
  const a1 = new Float32Array(n * 4);
  items.forEach((it, i) => encodeCode(it.no, it.iso, a0, a1, i));
  g.setAttribute('aCode0', new THREE.InstancedBufferAttribute(a0, 4));
  g.setAttribute('aCode1', new THREE.InstancedBufferAttribute(a1, 4));
  return g;
}

/**
 * Membuang salinan dari withCodes TANPA ikut membuang buffer atribut bersama.
 * dispose() biasa menghapus buffer GPU semua atributnya — termasuk posisi dan
 * normal yang dipakai mesh lain — jadi atribut bersama dilepas lebih dulu.
 */
export function disposeCodes(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) if (name !== 'aCode0' && name !== 'aCode1') g.deleteAttribute(name);
  g.setIndex(null); // indeks juga milik bersama
  g.dispose();
}

/** Zona kode pada atlas marka, dalam piksel kanvas (y dari atas). */
export type CodeZone = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Per slot: indeks karakter di string kode (0–14), atau -1 untuk spasi. */
  map: number[];
};

export const MAX_ZONES = 8;
export const MAX_ZONE_SLOTS = 96;

/** Daftarkan zona sepanjang map, slot selebar tinggi × SLOT_ASPECT. */
export function addZone(zones: CodeZone[], x: number, y: number, h: number, map: number[], align: 'left' | 'right' | 'center' = 'left') {
  const w = map.length * h * SLOT_ASPECT;
  const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  zones.push({ x: x0, y, w, h, map });
  return { x0, x1: x0 + w };
}

/** Peta slot yang umum. */
export const MAP = {
  /** "MSKU 220417" */
  ownerSerial: [0, 1, 2, 3, -1, 4, 5, 6, 7, 8, 9],
  check: [10],
  iso: [11, 12, 13, 14],
  owner: [0, 1, 2, 3],
  serialCheck: [4, 5, 6, 7, 8, 9, 10],
  /** "NARU 506199 1" */
  fullSpaced: [0, 1, 2, 3, -1, 4, 5, 6, 7, 8, 9, -1, 10],
};

/**
 * Ubah zona piksel ke uniform shader (UV atlas, v dari bawah).
 *
 * `bounds`: dua kotak pembatas gabungan — zona di dinding samping (y < sideH)
 * dan zona di muka pintu — supaya shader bisa melewati loop zona untuk piksel
 * di luar keduanya. Dipisah dua karena gabungan satu kotak akan menutup
 * hampir seluruh atlas (samping di kanan atas, pintu di kiri bawah).
 */
export function zoneUniforms(zones: CodeZone[], atlasW: number, atlasH: number, sideH = Infinity) {
  if (zones.length > MAX_ZONES) throw new Error(`zona kode maks ${MAX_ZONES}`);
  const rect: THREE.Vector4[] = [];
  const info: THREE.Vector2[] = [];
  const map: number[] = [];
  for (const z of zones) {
    rect.push(new THREE.Vector4(z.x / atlasW, 1 - (z.y + z.h) / atlasH, (z.x + z.w) / atlasW, 1 - z.y / atlasH));
    info.push(new THREE.Vector2(z.map.length, map.length));
    map.push(...z.map);
  }
  if (map.length > MAX_ZONE_SLOTS) throw new Error(`slot kode maks ${MAX_ZONE_SLOTS}`);
  const bounds = [new THREE.Vector4(2, 2, 2, 2), new THREE.Vector4(2, 2, 2, 2)];
  const seen = [false, false];
  zones.forEach((z, i) => {
    const k = z.y < sideH ? 0 : 1;
    const r = rect[i];
    if (!seen[k]) {
      bounds[k].copy(r);
      seen[k] = true;
    } else {
      bounds[k].set(Math.min(bounds[k].x, r.x), Math.min(bounds[k].y, r.y), Math.max(bounds[k].z, r.z), Math.max(bounds[k].w, r.w));
    }
  });
  while (rect.length < MAX_ZONES) rect.push(new THREE.Vector4(2, 2, 2, 2));
  while (info.length < MAX_ZONES) info.push(new THREE.Vector2(0, 0));
  while (map.length < MAX_ZONE_SLOTS) map.push(-1);
  return { rect, info, map, count: zones.length, bounds };
}

let glyphTex: THREE.Texture | null = null;

/** Atlas glyph: 37 sel (0–9, A–Z, kosong) dalam satu baris, huruf putih di alpha. */
export function glyphTexture(font: string): THREE.Texture {
  if (glyphTex) return glyphTex;
  const cellH = 128;
  const cellW = Math.round(cellH * SLOT_ASPECT);
  const cv = document.createElement('canvas');
  cv.width = cellW * 37;
  cv.height = cellH;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.font = `bold ${cellH * 0.9}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i], cellW * (i + 0.5), cellH * 0.54, cellW * 0.92);
  const tex = new THREE.CanvasTexture(cv);
  // Tanpa mipmap: sampel diambil di dalam cabang shader (zona), tempat turunan
  // layar untuk memilih mip tidak terdefinisi.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  glyphTex = tex;
  return tex;
}
