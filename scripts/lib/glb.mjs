/**
 * Baca/tulis GLB seadanya, dipakai bersama oleh skrip aset di folder ini.
 *
 * Sengaja tidak memakai pustaka glTF: yang dibutuhkan cuma membongkar dua
 * chunk, menata ulang bufferView, dan menulisnya kembali.
 */
import fs from 'node:fs';

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
export const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export const TARGET_ARRAY_BUFFER = 34962;
export const TARGET_ELEMENT_ARRAY_BUFFER = 34963;

export function readGlb(file) {
  const src = fs.readFileSync(file);
  if (src.readUInt32LE(0) !== MAGIC) throw new Error(`${file}: bukan file GLB`);

  const jsonLength = src.readUInt32LE(12);
  if (src.readUInt32LE(16) !== CHUNK_JSON) throw new Error(`${file}: chunk JSON tidak ditemukan`);
  const json = JSON.parse(src.toString('utf8', 20, 20 + jsonLength));

  const binStart = 20 + jsonLength;
  const binLength = src.readUInt32LE(binStart);
  if (src.readUInt32LE(binStart + 4) !== CHUNK_BIN) throw new Error(`${file}: chunk BIN tidak ditemukan`);

  return { json, bin: src.subarray(binStart + 8, binStart + 8 + binLength), size: src.length };
}

/** Isi sebuah accessor sebagai typed array, sudah dirapatkan dari stride-nya. */
export function readAccessor(json, bin, index) {
  const a = json.accessors[index];
  if (a.sparse) throw new Error('accessor sparse belum didukung');
  const view = json.bufferViews[a.bufferView];
  const comps = COMPONENTS[a.type];
  const bytes = COMPONENT_BYTES[a.componentType];
  const element = comps * bytes;
  const stride = view.byteStride ?? element;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);

  const Ctor = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
  const out = new Ctor(a.count * comps);
  for (let i = 0; i < a.count; i++) {
    const at = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const o = at + c * bytes;
      out[i * comps + c] =
        a.componentType === 5126 ? bin.readFloatLE(o)
        : a.componentType === 5125 ? bin.readUInt32LE(o)
        : a.componentType === 5123 ? bin.readUInt16LE(o)
        : a.componentType === 5122 ? bin.readInt16LE(o)
        : a.componentType === 5121 ? bin.readUInt8(o)
        : bin.readInt8(o);
    }
  }
  return out;
}

/**
 * Menyusun chunk BIN baru sambil mencatat bufferView-nya.
 *
 * Selalu satu bufferView per potongan data, dirapatkan tanpa byteStride.
 * File hasil ekspor sering menaruh puluhan accessor di dalam satu bufferView
 * raksasa; menyalin view secara utuh berarti data yang sudah dibuang ikut
 * terbawa dan ukuran file tidak bergerak sedikit pun.
 */
export class BufferPacker {
  constructor() {
    this.bufferViews = [];
    this.chunks = [];
    this.offset = 0;
  }

  push(data, extra = {}) {
    const pad = (4 - (this.offset % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.offset += pad;
    }
    const buf = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this.chunks.push(buf);
    this.bufferViews.push({ buffer: 0, byteOffset: this.offset, byteLength: buf.length, ...extra });
    this.offset += buf.length;
    return this.bufferViews.length - 1;
  }

  get bin() {
    return Buffer.concat(this.chunks);
  }
}

export function writeGlb(file, json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPad.length + 8 + binPad.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPad.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binPad.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);

  fs.writeFileSync(file, Buffer.concat([header, jsonHeader, jsonPad, binHeader, binPad]));
  return fs.statSync(file).size;
}

/** Semua referensi tekstur di glTF berbentuk objek dengan properti `index`. */
const TEXTURE_REF_KEYS = new Set(['index', 'texCoord', 'scale', 'strength', 'extensions', 'extras']);

export const isTextureRef = (v) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  typeof v.index === 'number' &&
  Object.keys(v).every((k) => TEXTURE_REF_KEYS.has(k));

export function eachTextureRef(value, fn) {
  if (value === null || typeof value !== 'object') return;
  if (isTextureRef(value)) {
    fn(value);
    return;
  }
  for (const v of Object.values(value)) eachTextureRef(v, fn);
}

export const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
export const num = (n) => n.toLocaleString('en-US');
