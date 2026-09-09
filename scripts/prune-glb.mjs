/**
 * Membuang mesh kecil dari sebuah GLB, lalu menulis ulang file-nya secara
 * padat — accessor, bufferView, material, dan tekstur yang jadi yatim ikut
 * dibuang.
 *
 * Kenapa perlu: aset tank container aslinya 289.084 segitiga, dan sebagian
 * besarnya baut, flensa, dan gagang katup berukuran belasan sentimeter — satu
 * mesh bisa 22.842 segitiga di dalam kotak 11x14x7 cm. Detail sebesar itu
 * sudah tenggelam di bawah satu piksel jauh sebelum LOD dekat menyala,
 * sementara ongkosnya dibayar penuh oleh setiap instance.
 *
 * Pemakaian:
 *   node scripts/prune-glb.mjs <in.glb> <out.glb> --min-diagonal=1.0 [--length=6.06]
 *
 *   --min-diagonal  ambang diagonal bounding box mesh, dalam meter
 *   --length        panjang model di dunia nyata (meter), dipakai untuk
 *                   mengubah satuan file jadi meter; default 6.06 (20ft)
 */
import {
  BufferPacker,
  COMPONENT_BYTES,
  COMPONENTS,
  eachTextureRef,
  mb,
  num,
  readGlb,
  TARGET_ARRAY_BUFFER,
  TARGET_ELEMENT_ARRAY_BUFFER,
  writeGlb,
} from './lib/glb.mjs';

const [input, output, ...flags] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node scripts/prune-glb.mjs <in.glb> <out.glb> --min-diagonal=1.0');
  process.exit(1);
}
const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? Number(hit.slice(name.length + 3)) : fallback;
};
const MIN_DIAGONAL = flag('min-diagonal', 1);
const REAL_LENGTH = flag('length', 6.06);

const { json, bin, size: sourceSize } = readGlb(input);

const axes = [0, 1, 2];

const meshBox = (mesh) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.primitives) {
    const a = json.accessors[p.attributes.POSITION];
    for (const k of axes) {
      min[k] = Math.min(min[k], a.min[k]);
      max[k] = Math.max(max[k], a.max[k]);
    }
  }
  return { min, max };
};

const triangles = (mesh) =>
  mesh.primitives.reduce((n, p) => {
    const count =
      p.indices != null
        ? json.accessors[p.indices].count
        : json.accessors[p.attributes.POSITION].count;
    return n + count / 3;
  }, 0);

// Satuan file diubah ke meter lewat sisi terpanjang seluruh model.
const world = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const mesh of json.meshes) {
  const b = meshBox(mesh);
  for (const k of axes) {
    world.min[k] = Math.min(world.min[k], b.min[k]);
    world.max[k] = Math.max(world.max[k], b.max[k]);
  }
}
const unit = REAL_LENGTH / Math.max(...axes.map((k) => world.max[k] - world.min[k]));

const keepMesh = json.meshes.map((mesh) => {
  const b = meshBox(mesh);
  return Math.hypot(...axes.map((k) => (b.max[k] - b.min[k]) * unit)) >= MIN_DIAGONAL;
});

const before = json.meshes.reduce((n, m) => n + triangles(m), 0);
const after = json.meshes.reduce((n, m, i) => n + (keepMesh[i] ? triangles(m) : 0), 0);

// --- buang node yang menunjuk mesh terbuang ---------------------------------
// Node tanpa mesh (induk pembawa transform) selalu dipertahankan.

const keepNode = json.nodes.map((n) => n.mesh === undefined || keepMesh[n.mesh]);

const nodeIndex = [];
let seen = 0;
json.nodes.forEach((_, i) => {
  nodeIndex[i] = keepNode[i] ? seen++ : -1;
});

const meshIndex = [];
seen = 0;
json.meshes.forEach((_, i) => {
  meshIndex[i] = keepMesh[i] ? seen++ : -1;
});

const nodes = json.nodes
  .filter((_, i) => keepNode[i])
  .map((n) => {
    const out = { ...n };
    if (out.mesh !== undefined) out.mesh = meshIndex[out.mesh];
    if (out.children) {
      const kids = out.children.map((c) => nodeIndex[c]).filter((c) => c >= 0);
      if (kids.length) out.children = kids;
      else delete out.children;
    }
    return out;
  });

const meshes = json.meshes.filter((_, i) => keepMesh[i]).map((m) => ({ ...m }));

// --- padatkan material, tekstur, gambar --------------------------------------

const usedAccessor = new Set();
const usedMaterial = new Set();
for (const mesh of meshes) {
  for (const p of mesh.primitives) {
    for (const a of Object.values(p.attributes)) usedAccessor.add(a);
    if (p.indices != null) usedAccessor.add(p.indices);
    if (p.material != null) usedMaterial.add(p.material);
  }
}

const materialIndex = [];
const materials = [];
(json.materials ?? []).forEach((m, i) => {
  materialIndex[i] = usedMaterial.has(i) ? materials.push(structuredClone(m)) - 1 : -1;
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

// --- salin ulang isi buffer --------------------------------------------------
// Disalin per accessor, bukan per bufferView. File ini menaruh SELURUH 103
// accessor di dalam tiga bufferView raksasa, jadi menyalin view secara utuh
// akan ikut membawa geometri mesh yang baru saja dibuang — segitiganya turun
// 73% tapi ukuran file tidak bergerak sama sekali.

const packer = new BufferPacker();
const pushView = (data, extra = {}) => packer.push(data, extra);

const readRange = (a) => {
  const view = json.bufferViews[a.bufferView];
  const element = COMPONENT_BYTES[a.componentType] * COMPONENTS[a.type];
  const stride = view.byteStride ?? element;
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (stride === element) return { element, data: bin.subarray(base, base + a.count * element) };
  // Layout interleaved: dirapatkan supaya bufferView baru bisa tanpa stride.
  const out = Buffer.alloc(a.count * element);
  for (let i = 0; i < a.count; i++) {
    bin.copy(out, i * element, base + i * stride, base + i * stride + element);
  }
  return { element, data: out };
};

const indicesOf = new Set();
for (const mesh of meshes) {
  for (const p of mesh.primitives) if (p.indices != null) indicesOf.add(p.indices);
}

const accessorIndex = [];
const accessors = [];
for (const i of [...usedAccessor].sort((a, b) => a - b)) {
  const a = { ...json.accessors[i] };
  if (a.sparse) throw new Error('accessor sparse belum didukung');
  if (a.bufferView === undefined) {
    accessorIndex[i] = accessors.push(a) - 1;
    continue;
  }

  const isIndex = indicesOf.has(i);
  let { data } = readRange(a);

  // Indeks 32-bit diturunkan ke 16-bit kalau muat — separuh byte hilang
  // begitu saja, dan tiap mesh di sini jauh di bawah 65.536 vertex.
  if (isIndex && a.componentType === 5125) {
    const src32 = new Uint32Array(data.buffer, data.byteOffset, a.count);
    let max = 0;
    for (const v of src32) if (v > max) max = v;
    if (max < 65536) {
      const out = Buffer.alloc(a.count * 2);
      for (let k = 0; k < a.count; k++) out.writeUInt16LE(src32[k], k * 2);
      data = out;
      a.componentType = 5123;
    }
  }

  delete a.byteOffset;
  a.bufferView = pushView(data, {
    target: isIndex ? TARGET_ELEMENT_ARRAY_BUFFER : TARGET_ARRAY_BUFFER,
  });
  accessorIndex[i] = accessors.push(a) - 1;
}

const viewIndex = [];
for (const im of images) {
  if (im.bufferView === undefined) continue;
  const v = json.bufferViews[im.bufferView];
  const start = v.byteOffset ?? 0;
  viewIndex[im.bufferView] = pushView(bin.subarray(start, start + v.byteLength));
}

for (const mesh of meshes) {
  mesh.primitives = mesh.primitives.map((p) => {
    const out = { ...p, attributes: { ...p.attributes } };
    for (const k of Object.keys(out.attributes)) {
      out.attributes[k] = accessorIndex[out.attributes[k]];
    }
    if (out.indices != null) out.indices = accessorIndex[out.indices];
    if (out.material != null) out.material = materialIndex[out.material];
    return out;
  });
}
for (const im of images) if (im.bufferView !== undefined) im.bufferView = viewIndex[im.bufferView];

// --- tulis GLB ---------------------------------------------------------------

const outBin = packer.bin;
const bufferViews = packer.bufferViews;
const scene = json.scenes[json.scene ?? 0];
const outJson = {
  asset: json.asset,
  scene: 0,
  scenes: [{ nodes: scene.nodes.map((n) => nodeIndex[n]).filter((n) => n >= 0) }],
  nodes,
  meshes,
  accessors,
  bufferViews,
  buffers: [{ byteLength: outBin.length }],
  ...(materials.length ? { materials } : {}),
  ...(textures.length ? { textures } : {}),
  ...(images.length ? { images } : {}),
  ...(json.samplers ? { samplers: json.samplers } : {}),
  ...(json.extensionsUsed ? { extensionsUsed: json.extensionsUsed } : {}),
  ...(json.extensionsRequired ? { extensionsRequired: json.extensionsRequired } : {}),
};

const written = writeGlb(output, outJson, outBin);
console.log(`mesh      ${json.meshes.length} -> ${meshes.length}`);
console.log(`segitiga  ${num(before)} -> ${num(after)}`);
console.log(`material  ${json.materials?.length ?? 0} -> ${materials.length}`);
console.log(`ukuran    ${mb(sourceSize)} -> ${mb(written)}`);
