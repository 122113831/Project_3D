/**
 * Menurunkan jumlah segitiga sebuah GLB, mengecilkan teksturnya, lalu menulis
 * ulang file-nya secara padat.
 *
 * Kenapa perlu: aset kontainer GP yang dipakai di sini datang sebagai hasil
 * konversi beresolusi penuh — 1.500.000 segitiga dan tiga tekstur 4096x4096
 * dalam satu file 68 MB. Untuk 12.000 instance itu tidak bisa dipakai sama
 * sekali; dua blok bermodel penuh saja sudah 1,3 MILIAR segitiga.
 *
 * Urutannya:
 *
 *   1. WELD (opsional) — gabungkan posisi yang sama. Lihat peringatan di bawah.
 *   2. SIMPLIFY lewat meshoptimizer, sadar-atribut supaya UV ikut dijaga.
 *   3. COMPACT: vertex yang tidak lagi terpakai dibuang.
 *   4. Tekstur dikecilkan, slot yang tidak dipakai renderer dibuang.
 *
 * Pemakaian:
 *   node scripts/decimate-glb.mjs <in.glb> <out.glb> --triangles=32000 \
 *     [--max-texture=1024] [--textures=baseColor,normal] [--weld=false]
 *
 *   --triangles     target jumlah segitiga untuk SELURUH file; dibagi ke tiap
 *                   primitive menurut porsinya. 0 = jangan sederhanakan sama
 *                   sekali, cuma bersihkan dan padatkan ulang
 *   --max-texture   sisi terpanjang tekstur setelah dikecilkan (0 = biarkan)
 *   --textures      slot tekstur yang dipertahankan; sisanya dibuang beserta
 *                   gambarnya. Default semua.
 *   --attributes    atribut vertex yang dipertahankan. Default semua. Berguna
 *                   untuk membuang TANGENT dan TEXCOORD cadangan yang memang
 *                   dihapus lagi oleh renderer saat load.
 *   --error         anggaran galat penyederhana, relatif ukuran objek
 *                   (default 0.05). Penyederhana berhenti begitu galat ini
 *                   habis, jadi target segitiga yang agresif tidak akan
 *                   tercapai kalau anggaran ini terlalu ketat.
 *   --weld=false    jangan gabungkan posisi yang sama.
 *
 * PERINGATAN soal --weld: weld MERUSAK atlas UV. Jahitan UV ada justru karena
 * satu posisi punya dua koordinat tekstur, dan weld cuma menyimpan salah satu.
 *
 * Pada aset GP di sini bedanya terukur. TANPA weld, penyederhana berhenti di
 * 32.456 segitiga berapa pun target yang diminta — atlasnya terdiri dari
 * 13.974 pulau kecil, dan sebuah pulau tidak bisa dikerutkan di bawah dua
 * segitiga. UV-nya utuh: luas terpakai tetap 44% dari atlas. DENGAN weld,
 * 897.405 vertex mengerut jadi 749.914 posisi, mesh-nya ternyata satu manifold
 * tertutup rapat, dan bisa turun sampai 8.000 segitiga — tapi 74% segitiganya
 * lalu merentang antar pulau dan luas UV terpakai membengkak jadi 20.665% dari
 * atlas. Teksturnya jadi coreng-moreng.
 *
 * Jadi: pakai weld HANYA kalau tekstur model itu memang akan dibuang.
 */
import sharp from 'sharp';
import { MeshoptSimplifier } from 'meshoptimizer';
import {
  BufferPacker,
  COMPONENTS,
  eachTextureRef,
  mb,
  num,
  readAccessor,
  readGlb,
  TARGET_ARRAY_BUFFER,
  TARGET_ELEMENT_ARRAY_BUFFER,
  writeGlb,
} from './lib/glb.mjs';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/decimate-glb.mjs <in.glb> <out.glb> --triangles=32000');
  process.exit(1);
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};
const TARGET_TRIANGLES = Number(flag('triangles', 32000));
const MAX_TEXTURE = Number(flag('max-texture', 0));
const KEEP_SLOTS = flag('textures', null)?.split(',').map((s) => s.trim());
const KEEP_ATTRS = flag('attributes', null)?.split(',').map((s) => s.trim());
const WELD = flag('weld', 'true') !== 'false';
const TARGET_ERROR = Number(flag('error', 0.05));

/** Slot tekstur pada material glTF, dengan letaknya di dalam objek material. */
const TEXTURE_SLOTS = [
  ['baseColor', (m) => m.pbrMetallicRoughness, 'baseColorTexture'],
  ['metallicRoughness', (m) => m.pbrMetallicRoughness, 'metallicRoughnessTexture'],
  ['normal', (m) => m, 'normalTexture'],
  ['occlusion', (m) => m, 'occlusionTexture'],
  ['emissive', (m) => m, 'emissiveTexture'],
];

const { json, bin, size: sourceSize } = readGlb(input);

/**
 * Anggaran segitiga dibagi menurut porsi tiap primitive.
 *
 * Tanpa ini, --triangles berlaku per primitive: aset truk punya 81 primitive,
 * jadi "20.000" akan berarti 20.000 untuk MASING-MASING, dan file yang sudah
 * 783.090 segitiga nyaris tidak menyusut.
 */
const primTriangles = [];
for (const mesh of json.meshes) {
  for (const prim of mesh.primitives) {
    const n =
      prim.indices != null
        ? json.accessors[prim.indices].count
        : json.accessors[prim.attributes.POSITION].count;
    primTriangles.push(n / 3);
  }
}
const totalTriangles = primTriangles.reduce((a, b) => a + b, 0);
let primIndex = 0;

// --- 1..3: weld, simplify, compact ------------------------------------------

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

let trisBefore = 0;
let trisAfter = 0;
let vertsBefore = 0;
let vertsAfter = 0;

/** Data primitive setelah disederhanakan, menunggu dipaketkan ke buffer. */
const rebuilt = [];

for (const [mi, mesh] of json.meshes.entries()) {
  for (const [pi, prim] of mesh.primitives.entries()) {
    const names = Object.keys(prim.attributes).filter(
      (n) => !KEEP_ATTRS || KEEP_ATTRS.includes(n),
    );
    if (KEEP_ATTRS) {
      const dropped = Object.keys(prim.attributes).filter((n) => !names.includes(n));
      if (dropped.length) {
        console.log('mesh ' + mi + '.' + pi + ': buang atribut ' + dropped.join(', '));
      }
      for (const n of dropped) delete prim.attributes[n];
    }
    const attrs = new Map(names.map((n) => [n, readAccessor(json, bin, prim.attributes[n])]));
    const pos = attrs.get('POSITION');
    if (!pos) throw new Error(`mesh ${mi} primitive ${pi} tanpa POSITION`);
    const uv = attrs.get('TEXCOORD_0') ?? null;

    const vertexCount = pos.length / 3;
    const index = prim.indices != null
      ? Uint32Array.from(readAccessor(json, bin, prim.indices))
      : Uint32Array.from({ length: vertexCount }, (_, i) => i);

    trisBefore += index.length / 3;
    vertsBefore += vertexCount;

    // 1. Weld: posisi identik digabung supaya penyederhana melihat satu
    //    permukaan tersambung, bukan ribuan pulau UV yang tidak bisa
    //    dikerutkan. Ditukar dengan rusaknya atlas UV — lihat catatan di atas.
    const seen = new Map();
    const source = [];
    const remap = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
      const key = WELD ? `${pos[i * 3]},${pos[i * 3 + 1]},${pos[i * 3 + 2]}` : i;
      let v = seen.get(key);
      if (v === undefined) {
        v = source.length;
        seen.set(key, v);
        source.push(i);
      }
      remap[i] = v;
    }
    const welded = source.length;
    const take = (data, comps) => {
      const out = new Float32Array(welded * comps);
      for (let v = 0; v < welded; v++) {
        for (let c = 0; c < comps; c++) out[v * comps + c] = data[source[v] * comps + c];
      }
      return out;
    };
    const wpos = take(pos, 3);
    const wuv = uv ? take(uv, 2) : null;
    const windex = new Uint32Array(index.length);
    for (let i = 0; i < index.length; i++) windex[i] = remap[index[i]];

    // 2. Simplify. Dilewati kalau target 0 — kadang yang dibutuhkan cuma
    //    membuang tekstur/atribut mati dan memadatkan ulang file-nya.
    const share = primTriangles[primIndex++] / totalTriangles;
    // Dibatasi isi primitive itu sendiri: meshopt menolak target yang lebih
    // besar daripada jumlah indeks yang ada, dan aset dengan puluhan primitive
    // pasti punya beberapa yang cuma satu-dua segitiga.
    const target = Math.min(index.length, Math.max(3, Math.round(TARGET_TRIANGLES * share)) * 3);
    const [simplified, error] =
      TARGET_TRIANGLES <= 0 || target >= index.length
        ? [windex, 0]
        : wuv
          ? MeshoptSimplifier.simplifyWithAttributes(
              windex, wpos, 3, wuv, 2, [0.3, 0.3], null, target, TARGET_ERROR, [],
            )
          : MeshoptSimplifier.simplify(windex, wpos, 3, target, TARGET_ERROR, []);

    // 3. Compact: hanya vertex yang masih dirujuk yang ikut ditulis.
    const keep = new Map();
    const order = [];
    const finalIndex = new Uint32Array(simplified.length);
    for (let i = 0; i < simplified.length; i++) {
      const v = simplified[i];
      let n = keep.get(v);
      if (n === undefined) {
        n = order.length;
        keep.set(v, n);
        order.push(v);
      }
      finalIndex[i] = n;
    }

    const finalAttrs = new Map();
    for (const [name, data] of attrs) {
      const comps = COMPONENTS[json.accessors[prim.attributes[name]].type];
      const out = new Float32Array(order.length * comps);
      for (let v = 0; v < order.length; v++) {
        const src = source[order[v]];
        for (let c = 0; c < comps; c++) out[v * comps + c] = data[src * comps + c];
      }
      finalAttrs.set(name, { data: out, comps });
    }

    trisAfter += finalIndex.length / 3;
    vertsAfter += order.length;
    rebuilt.push({ mesh: mi, primitive: pi, index: finalIndex, attrs: finalAttrs });

    console.log(
      `mesh ${mi}.${pi}: ${num(index.length / 3)} -> ${num(finalIndex.length / 3)} segitiga, ` +
      `${num(vertexCount)} -> ${num(order.length)} vertex ` +
      `(weld ${num(vertexCount)} -> ${num(welded)}), error ${(error * 100).toFixed(2)}%`,
    );
  }
}

// --- 4: slot tekstur yang tidak dipakai renderer ------------------------------

if (KEEP_SLOTS) {
  for (const material of json.materials ?? []) {
    for (const [name, host, key] of TEXTURE_SLOTS) {
      if (KEEP_SLOTS.includes(name)) continue;
      const owner = host(material);
      if (owner && owner[key]) {
        delete owner[key];
        console.log(`buang slot tekstur "${name}" dari material ${material.name ?? ''}`);
      }
    }
  }
}

// --- lepas skin & animasi ----------------------------------------------------

/**
 * Referensi skin dilepas dari node.
 *
 * Keluaran skrip ini selalu statis: atribut JOINTS/WEIGHTS ikut terbuang saat
 * penyederhanaan, dan array `skins` tidak dibawa ke file baru. Kalau
 * `node.skin` dibiarkan, ia menunjuk ke array yang sudah tidak ada dan
 * GLTFLoader melempar TypeError saat memuat — file-nya lolos semua pemeriksaan
 * struktur tapi tidak bisa dibuka sama sekali.
 */
let skinsDropped = 0;
for (const node of json.nodes ?? []) {
  if (node.skin !== undefined) {
    delete node.skin;
    skinsDropped++;
  }
}
if (skinsDropped) {
  console.log(`lepas skin dari ${skinsDropped} node (keluaran selalu statis)`);
}

// --- padatkan material, tekstur, gambar --------------------------------------

const usedMaterial = new Set();
for (const mesh of json.meshes) {
  for (const p of mesh.primitives) if (p.material != null) usedMaterial.add(p.material);
}
const materialIndex = [];
const materials = [];
(json.materials ?? []).forEach((m, i) => {
  materialIndex[i] = usedMaterial.has(i) ? materials.push(m) - 1 : -1;
});

const usedTexture = new Set();
for (const m of materials) eachTextureRef(m, (ref) => usedTexture.add(ref.index));
const textureIndex = [];
const textures = [];
(json.textures ?? []).forEach((t, i) => {
  textureIndex[i] = usedTexture.has(i) ? textures.push({ ...t }) - 1 : -1;
});
for (const m of materials) eachTextureRef(m, (ref) => (ref.index = textureIndex[ref.index]));

const usedImage = new Set(textures.map((t) => t.source).filter((s) => s !== undefined));
const imageIndex = [];
const images = [];
(json.images ?? []).forEach((im, i) => {
  imageIndex[i] = usedImage.has(i) ? images.push({ ...im }) - 1 : -1;
});
for (const t of textures) if (t.source !== undefined) t.source = imageIndex[t.source];

// --- tulis buffer baru --------------------------------------------------------

const packer = new BufferPacker();
const accessors = [];

const pushAccessor = (data, comps, type, componentType, target, bounds) => {
  const bufferView = packer.push(data, { target });
  const a = { bufferView, componentType, count: data.length / comps, type };
  if (bounds) {
    a.min = bounds.min;
    a.max = bounds.max;
  }
  return accessors.push(a) - 1;
};

for (const r of rebuilt) {
  const prim = json.meshes[r.mesh].primitives[r.primitive];

  // Indeks diturunkan ke 16-bit kalau muat — separuh byte hilang begitu saja.
  const maxIndex = r.index.reduce((n, v) => (v > n ? v : n), 0);
  const indexData = maxIndex < 65536 ? Uint16Array.from(r.index) : r.index;
  prim.indices = pushAccessor(
    indexData, 1, 'SCALAR', maxIndex < 65536 ? 5123 : 5125, TARGET_ELEMENT_ARRAY_BUFFER,
  );

  const attributes = {};
  for (const [name, { data, comps }] of r.attrs) {
    let bounds;
    if (name === 'POSITION') {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < data.length / 3; v++) {
        for (let c = 0; c < 3; c++) {
          const x = data[v * 3 + c];
          if (x < min[c]) min[c] = x;
          if (x > max[c]) max[c] = x;
        }
      }
      bounds = { min, max };
    }
    attributes[name] = pushAccessor(
      data, comps, comps === 2 ? 'VEC2' : comps === 3 ? 'VEC3' : 'VEC4',
      5126, TARGET_ARRAY_BUFFER, bounds,
    );
  }
  prim.attributes = attributes;
  if (prim.material != null) prim.material = materialIndex[prim.material];
}

// --- 4b: kecilkan tekstur -----------------------------------------------------

for (const image of images) {
  const view = json.bufferViews[image.bufferView];
  const start = view.byteOffset ?? 0;
  let data = bin.subarray(start, start + view.byteLength);

  if (MAX_TEXTURE > 0) {
    const meta = await sharp(data).metadata();
    if (Math.max(meta.width, meta.height) > MAX_TEXTURE) {
      const resized = await sharp(data)
        .resize(MAX_TEXTURE, MAX_TEXTURE, { fit: 'inside' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      console.log(
        `tekstur ${meta.width}x${meta.height} -> ${MAX_TEXTURE}px, ${mb(data.length)} -> ${mb(resized.length)}`,
      );
      data = resized;
      image.mimeType = 'image/png';
    }
  }
  image.bufferView = packer.push(data);
}

const outBin = packer.bin;
const scene = json.scenes[json.scene ?? 0];
const outJson = {
  asset: json.asset,
  scene: 0,
  scenes: [scene],
  nodes: json.nodes,
  meshes: json.meshes,
  accessors,
  bufferViews: packer.bufferViews,
  buffers: [{ byteLength: outBin.length }],
  ...(materials.length ? { materials } : {}),
  ...(textures.length ? { textures } : {}),
  ...(images.length ? { images } : {}),
  ...(json.samplers ? { samplers: json.samplers } : {}),
  ...(json.extensionsUsed ? { extensionsUsed: json.extensionsUsed } : {}),
  ...(json.extensionsRequired ? { extensionsRequired: json.extensionsRequired } : {}),
};

const written = writeGlb(output, outJson, outBin);
console.log(`\nsegitiga  ${num(trisBefore)} -> ${num(trisAfter)}`);
console.log(`vertex    ${num(vertsBefore)} -> ${num(vertsAfter)}`);
console.log(`gambar    ${json.images?.length ?? 0} -> ${images.length}`);
console.log(`ukuran    ${mb(sourceSize)} -> ${mb(written)}`);
