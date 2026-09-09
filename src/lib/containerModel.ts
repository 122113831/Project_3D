import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three-stdlib';
import { BOX } from './constants';

/**
 * Aset kontainer GP, hasil olahan `scripts/decimate-glb.mjs` dari file asli.
 * Geometrinya tidak disentuh (8.379 segitiga); yang dibuang cuma yang memang
 * tidak pernah dibaca `MeshPhongMaterial` — tekstur metallicRoughness dan
 * occlusion, plus atribut TANGENT dan dua set UV cadangan. 7,9 MB -> 5,0 MB.
 */
export const CONTAINER_MODEL_URL = '/models/shipping_container.glb';

/**
 * Aset tank container, hasil olahan `scripts/prune-glb.mjs` dari file asli.
 * Aslinya 289.084 segitiga; sebagian besarnya baut dan gagang katup belasan
 * sentimeter yang tidak pernah kelihatan. Yang dipakai 78.630.
 */
export const TANK_MODEL_URL = '/models/tank_container.glb';

/**
 * Aset reefer: sebuah kotak 12 segitiga dengan satu tekstur 1024x256 yang
 * memuat seluruh livery-nya — badan bergelombang, pintu di satu ujung, dan
 * unit pendingin di ujung lainnya. Unit pendinginnya ada di TEKSTUR, bukan
 * geometri, jadi tidak ada tonjolan yang perlu dijaga saat diregangkan.
 */
export const REEFER_MODEL_URL = '/models/reefer_container.glb';

/**
 * Orientasi tiap aset berbeda, jadi ini bagian dari spec, bukan konstanta.
 *
 * Aset kontainer dan tank memanjang pada sumbu Z; lapangan ini memanjangkan
 * kontainer pada sumbu X, jadi diputar 90° pada Y. Aset reefer sudah memanjang
 * pada X tapi Z-up (kebiasaan CAD), jadi yang perlu diputar sumbu tingginya.
 *
 * Diputar sekali saat load, bukan lewat matriks instance, supaya matriks
 * instance tetap murni translasi.
 */
const ORIENT_LENGTH_ON_Z = new THREE.Matrix4().makeRotationY(-Math.PI / 2);

/**
 * Aset reefer datang dengan rotasi Y 140° terpanggang di node-nya — bukan
 * kelipatan 90°, jadi kalau dipasang apa adanya kontainernya berdiri miring
 * 40° terhadap grid lapangan dan bounding box-nya jadi hampir bujur sangkar
 * (8,4 x 9,2 m, bukan 9,5 x 3,0). Diluruskan dengan memutar balik 50°:
 * 140° untuk membatalkan rotasinya, dikurangi 90° untuk membawa sumbu
 * panjangnya ke X.
 */
const ORIENT_REEFER = new THREE.Matrix4().makeRotationY((-50 * Math.PI) / 180);

/**
 * Tingkat terang yang dituju material paling terang, dalam ruang LINEAR.
 *
 * Harus linear, bukan sRGB: warna instance dikalikan dengan map di ruang
 * linear, jadi map yang rata-rata sRGB-nya 0,77 sebenarnya cuma 0,55 linear —
 * kontainer LOD dekat akan tampak 45% lebih gelap daripada LOD jauh yang
 * tidak bermap, dan pergantian LOD-nya terlihat berkedip.
 */
export const TARGET_LINEAR = 0.85;

/**
 * Kompresi rentang antar material dalam satu model.
 *
 * Rangka tank warnanya biru sangat gelap (luminansi linear 0,09) sementara
 * baloknya 0,43. Kalau dinormalisasi apa adanya, rangkanya jadi hampir hitam
 * dan warna line-nya tidak terbaca. Gamma ini mengangkat yang gelap tanpa
 * membalik urutan terang-gelapnya.
 */
const CONTRAST_GAMMA = 0.45;

export type ModelPart = {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
};

export type InstancedModel = {
  /** Bagian model, sudah diskalakan ke kotak ISO 20ft. */
  parts20: ModelPart[];
  /** Varian 40ft. null untuk model yang memang tidak ada versi 40ft-nya. */
  parts40: ModelPart[] | null;
};

type ModelSpec = {
  /**
   * Dimensi target dalam meter: panjang (X), tinggi (Y), lebar (Z).
   *
   * null berarti aset dipakai pada skala dan titik asalnya sendiri — itu yang
   * dibutuhkan aset yang BUKAN kontainer, seperti truk: memaksanya ke kotak
   * ISO akan meremasnya, dan memusatkannya ke origin akan memutus hubungan
   * koordinat dengan chassis yang disambungkan padanya.
   */
  fit: { length: number; height: number; width: number } | null;
  /** Buat juga varian 40ft dengan meregangkan sumbu X. */
  stretch40: boolean;
  /**
   * DoubleSide dibutuhkan model yang punya permukaan tanpa ketebalan —
   * pelat lantai tank tebalnya nol, dengan FrontSide separuh waktu tak terlihat.
   */
  side: THREE.Side;
  /** Rotasi yang membawa sumbu aset ke sumbu lapangan. */
  orient: THREE.Matrix4;
  /**
   * Turunkan aset sampai titik terendahnya menyentuh y = 0.
   *
   * Perlu karena titik asal aset tidak selalu di dasarnya — STS crane misalnya
   * bagian terendahnya 38,6 m di atas origin, dan tanpa ini ia melayang.
   */
  ground?: boolean;
  /**
   * Ubah base color jadi abu-abu supaya warna per instance yang menentukan hue.
   *
   * Benar untuk kontainer, yang memang diwarnai menurut line/status/tier.
   * Salah untuk truk: truk tidak ikut mode pewarnaan apa pun, jadi warnanya
   * dipakai apa adanya.
   */
  tint: boolean;
  /**
   * Panjang bagian di ujung -X yang TIDAK boleh ikut meregang saat varian
   * 40ft dibuat, dalam meter setelah fit.
   *
   * Unit pendingin reefer ukurannya sama di kontainer 20ft maupun 40ft. Kalau
   * seluruh geometri diskalakan, unitnya ikut melebar dua kali lipat dan
   * reefer 40ft terlihat salah. 0 berarti seluruhnya boleh meregang.
   */
  rigidEnd: number;
};

const CONTAINER_SPEC: ModelSpec = {
  fit: { length: BOX.len20, height: BOX.height, width: BOX.width },
  stretch40: true,
  side: THREE.FrontSide,
  orient: ORIENT_LENGTH_ON_Z,
  rigidEnd: 0,
  tint: true,
};

const TANK_SPEC: ModelSpec = {
  fit: { length: BOX.len20, height: BOX.height, width: BOX.width },
  stretch40: false,
  side: THREE.DoubleSide,
  orient: ORIENT_LENGTH_ON_Z,
  rigidEnd: 0,
  tint: true,
};

/**
 * Aset reefar 6,658 m — badan 20ft 6,058 m plus unit mesin ~0,6 m yang
 * dimodelkan menonjol keluar. Difit ke kotak ISO seperti aset lain, jadi
 * seluruhnya disusutkan 9% pada sumbu panjang; menonjolkannya keluar kotak
 * akan menabrak slot sebelahnya, dan pada reefer sungguhan unit mesin itu
 * memang berada DI DALAM envelope kontainernya.
 */
const REEFER_SPEC: ModelSpec = {
  fit: { length: BOX.len20, height: BOX.height, width: BOX.width },
  stretch40: true,
  // DoubleSide: aset ini ditandai doubleSided dan cuma 12 segitiga, jadi tidak
  // ada gunanya berjudi pada arah winding-nya demi penghematan yang nol.
  side: THREE.DoubleSide,
  orient: ORIENT_REEFER,
  tint: true,
  // 0: unit pendingin ada di tekstur muka ujung, bukan geometri yang menonjol.
  // Muka ujung tegak lurus sumbu panjang, jadi meregangkan ke 40ft memindahkan
  // muka itu tanpa melebarkannya — yang meregang cuma gelombang dinding samping.
  rigidEnd: 0,
};

/**
 * Traktor Volvo FH16, hasil olahan scripts/decimate-glb.mjs.
 *
 * Aslinya 783.090 segitiga dan 33 MB — 92% di material bodi luar, bukan
 * interior seperti dugaan awal. Vertex-nya terpecah berat (V/T 0,95), jadi
 * penyederhana mentok di 197.000 sampai posisi yang sama digabung; setelah
 * weld V/T jadi 0,54 dan sisanya lancar. Kedua teksturnya dibuang karena cuma
 * menutupi 8% segitiga dan justru itu yang menghalangi weld. Hasilnya 33.418
 * segitiga, 0,72 MB.
 *
 * Aset ini traktor SAJA, tanpa chassis. Chassis-nya dibangun prosedural di
 * createChassisGeometry() dan disambungkan pada koordinat yang sama.
 */
export const TRUCK_MODEL_URL = '/models/truck_tractor.glb';

/**
 * Alat berat dari folder aset: ITV, RTG, dan STS crane.
 *
 * Ketiganya diolah scripts/decimate-glb.mjs dengan weld — dua di antaranya
 * tanpa tekstur sama sekali, jadi weld sepenuhnya aman dan penyederhanaannya
 * bisa bekerja penuh. Tekstur ITV dibuang karena cuma menutupi 16% segitiga
 * dan justru itu yang akan tercoreng oleh weld.
 */
export const ITV_MODEL_URL = '/models/itv.glb';
export const RTG_CRANE_MODEL_URL = '/models/rtg_crane.glb';
export const STS_MODEL_URL = '/models/sts_crane.glb';

// --- konversi warna ---------------------------------------------------------

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const linearToSrgbByte = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Porsi piksel yang tidak sepenuhnya buram.
 *
 * Dipakai untuk membedakan layer decal dari badan kontainer. Tidak bisa
 * mengandalkan flag `transparent` saja: ada aset yang menandai SEMUA
 * material-nya alphaMode=BLEND padahal base color-nya PNG tanpa kanal alpha.
 * Kalau badan ikut dianggap decal, ia ikut mendapat polygonOffset yang sama —
 * dan offset yang mestinya memisahkan decal dari badan jadi saling
 * meniadakan, z-fighting-nya tidak terselesaikan.
 */
function alphaCoverage(pixels: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) n++;
  return n / (pixels.length / 4);
}

/** Luminansi linear rata-rata sebuah tekstur, ditimbang alpha. */
function meanLuminance(pixels: Uint8ClampedArray): number {
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] / 255;
    if (a === 0) continue;
    sum +=
      (LUMA[0] * SRGB_TO_LINEAR[pixels[i]] +
        LUMA[1] * SRGB_TO_LINEAR[pixels[i + 1]] +
        LUMA[2] * SRGB_TO_LINEAR[pixels[i + 2]]) *
      a;
    weight += a;
  }
  return weight > 0 ? sum / weight : 0;
}

type PixelRead = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  data: ImageData;
};

function readPixels(texture: THREE.Texture): PixelRead {
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0, image.width, image.height);
  return { canvas, ctx, data: ctx.getImageData(0, 0, image.width, image.height) };
}

/**
 * Mengubah base color map jadi peta detail abu-abu pada tingkat terang tertentu.
 *
 * Base color kedua aset ini berwarna pekat — biru tua. Kalau dipakai apa
 * adanya, seluruh mode pewarnaan (line / status / tier) ikut kebiruan karena
 * instanceColor DIKALIKAN dengan map. Jadi cuma luminansinya yang diambil:
 * karat, panel, huruf, dan marka tetap terlihat, sementara hue-nya sepenuhnya
 * ditentukan warna per instance.
 */
function toDetailMap(src: THREE.Texture, read: PixelRead, gain: number): THREE.Texture {
  const { canvas, ctx, data } = read;
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l =
      LUMA[0] * SRGB_TO_LINEAR[d[i]] +
      LUMA[1] * SRGB_TO_LINEAR[d[i + 1]] +
      LUMA[2] * SRGB_TO_LINEAR[d[i + 2]];
    const v = linearToSrgbByte(Math.min(1, l * gain));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(data, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // GLTF memakai UV dengan flipY=false; CanvasTexture defaultnya true.
  tex.flipY = false;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// --- pembangun --------------------------------------------------------------

type Raw = {
  name: string;
  geometry: THREE.BufferGeometry;
  source: THREE.MeshStandardMaterial;
};

function buildInstancedModel(gltf: GLTF, spec: ModelSpec): InstancedModel {
  gltf.scene.updateWorldMatrix(true, true);

  const raw: Raw[] = [];
  gltf.scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.applyMatrix4(spec.orient);
    // Sebagian eksporter menaruh sampai tiga set UV dan tangent; yang dipakai
    // cuma uv. Untuk belasan ribu instance, atribut mati tetap makan memori GPU.
    geometry.deleteAttribute('uv1');
    geometry.deleteAttribute('uv2');
    geometry.deleteAttribute('tangent');
    raw.push({ name: mesh.name, geometry, source: mesh.material as THREE.MeshStandardMaterial });
  });

  // Satu bounding box untuk SEMUA bagian: kalau tiap bagian dinormalisasi
  // sendiri-sendiri, rangka dan barel tank tidak lagi sejajar.
  const bounds = new THREE.Box3();
  for (const r of raw) {
    r.geometry.computeBoundingBox();
    bounds.union(r.geometry.boundingBox!);
  }
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  // fit null: skala dan titik asal aset dipakai apa adanya, kecuali kalau
  // diminta menapak tanah.
  const fit = spec.fit
    ? new THREE.Matrix4()
        .makeScale(spec.fit.length / size.x, spec.fit.height / size.y, spec.fit.width / size.z)
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    : spec.ground
      ? new THREE.Matrix4().makeTranslation(0, -bounds.min.y, 0)
      : new THREE.Matrix4();

  // Tingkat terang tiap material diukur lebih dulu, baru dinormalisasi
  // bersama-sama — supaya rangka yang memang lebih gelap dari barel tetap
  // lebih gelap setelah semuanya diubah jadi abu-abu.
  const sources = [...new Set(raw.map((r) => r.source))];
  // Piksel disimpan supaya tekstur 1024x1024 tidak perlu digambar ulang ke
  // canvas untuk kedua kalinya saat map detailnya dibuat.
  const pixels = new Map<THREE.MeshStandardMaterial, PixelRead>();
  const luminance = new Map<THREE.MeshStandardMaterial, number>();
  const cutout = new Set<THREE.MeshStandardMaterial>();

  for (const src of sources) {
    // Tanpa tint, tekstur tidak perlu dibaca ke canvas sama sekali.
    if (src.map && spec.tint) {
      const read = readPixels(src.map);
      pixels.set(src, read);
      luminance.set(src, meanLuminance(read.data.data));
      if (src.transparent && alphaCoverage(read.data.data) > 0.01) cutout.add(src);
    } else {
      // baseColorFactor glTF sudah berada di ruang linear.
      const c = src.color ?? new THREE.Color(1, 1, 1);
      luminance.set(src, LUMA[0] * c.r + LUMA[1] * c.g + LUMA[2] * c.b);
    }
  }
  const brightest = Math.max(...luminance.values(), 1e-4);
  const levelFor = (src: THREE.MeshStandardMaterial) => {
    const l = luminance.get(src)!;
    return TARGET_LINEAR * (l / brightest) ** CONTRAST_GAMMA;
  };

  // Layer decal (branding, grafiti) menempel rata di kulit badan kontainer.
  // alphaTest dipakai, bukan blending: belasan ribu instance transparan
  // berarti sorting per objek tiap frame dan overdraw penuh.
  const isDecal = (m: THREE.MeshStandardMaterial) => cutout.has(m);

  const materials = new Map<THREE.Material, THREE.Material>();
  // Sebagian aset datang tanpa normal. Ditandai di sini karena material yang
  // dibuat harus tahu, bukan geometrinya.
  const withoutNormals = new Set(
    raw.filter((r) => !r.geometry.getAttribute('normal')).map((r) => r.source),
  );

  const materialFor = (src: THREE.MeshStandardMaterial) => {
    const cached = materials.get(src);
    if (cached) return cached;
    const hasNormals = !withoutNormals.has(src);

    const decal = isDecal(src);
    const level = levelFor(src);
    const gain = level / Math.max(1e-4, luminance.get(src)!);

    const mat = new THREE.MeshPhongMaterial({
      map: spec.tint
        ? src.map
          ? toDetailMap(src.map, pixels.get(src)!, gain)
          : null
        : (src.map ?? null),
      normalMap: src.normalMap ?? null,
      // Disamakan dengan material kontainer prosedural supaya kedua level
      // detail terlihat menyatu saat LOD bertukar.
      shininess: 14,
      specular: new THREE.Color('#20242a'),
      side: decal ? THREE.DoubleSide : spec.side,
      transparent: false,
      alphaTest: decal ? 0.5 : 0,
      depthWrite: true,
      // Layer decal nyaris sebidang dengan badan kontainer — tanpa ini
      // z-fighting-nya terlihat jelas dari jauh.
      polygonOffset: decal,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      // Aset reefer tidak punya atribut NORMAL sama sekali; GLTFLoader
      // menanganinya dengan flatShading, yang menghitung normal dari turunan
      // layar. Tanpa flag ini dibawa serta, permukaannya jadi hitam.
      flatShading: src.flatShading === true || !hasNormals,
    });
    // Material tanpa map dibuat abu-abu lewat warnanya sendiri, dengan tingkat
    // terang yang sama seperti kalau ia punya map. Kalau tint mati, warna
    // aslinya yang dipakai — truk tidak ikut mode pewarnaan apa pun.
    if (!spec.tint) mat.color.copy(src.color ?? new THREE.Color(1, 1, 1));
    else if (!src.map) mat.color.setRGB(level, level, level, THREE.LinearSRGBColorSpace);
    materials.set(src, mat);
    return mat;
  };

  // Mesh digabung per material sebelum di-instance. Aset tank datang sebagai
  // 10 mesh terpisah di atas 5 material; tanpa penggabungan, satu blok
  // bermodel penuh membayar 10 draw call hanya untuk tank-nya. Kunci
  // penggabungan ikut memuat daftar atribut karena mergeGeometries menolak
  // geometri yang set atributnya berbeda — sebagian mesh tank tidak ber-UV.
  const groups = new Map<string, { material: THREE.Material; parts: THREE.BufferGeometry[] }>();
  for (const r of raw) {
    r.geometry.applyMatrix4(fit);
    const material = materialFor(r.source);
    const key = `${material.uuid}|${Object.keys(r.geometry.attributes).sort().join(',')}`;
    const group = groups.get(key);
    if (group) group.parts.push(r.geometry);
    else groups.set(key, { material, parts: [r.geometry] });
  }

  const parts20: ModelPart[] = [];
  const parts40: ModelPart[] | null = spec.stretch40 ? [] : null;

  /**
   * Varian 40ft dibuat sebagai geometri sendiri (bukan skala di matriks
   * instance) supaya writeMatrices tetap menulis translasi murni.
   *
   * Bukan sekadar skala: bagian sepanjang rigidEnd di ujung -X digeser utuh,
   * dan hanya sisanya yang diregangkan. Tanpa itu unit pendingin reefer ikut
   * melebar dua kali lipat di varian 40ft.
   */
  const shift = (BOX.len40 - BOX.len20) / 2;
  const splitX = -BOX.len20 / 2 + spec.rigidEnd;
  const bodyScale = (BOX.len40 / 2 - (splitX - shift)) / (BOX.len20 / 2 - splitX);

  const stretchTo40 = (g: THREE.BufferGeometry) => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setX(i, x <= splitX ? x - shift : splitX - shift + (x - splitX) * bodyScale);
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    return g;
  };

  let n = 0;
  for (const { material, parts } of groups.values()) {
    const name = `part${n++}`;
    const g20 = parts.length === 1 ? parts[0] : mergeGeometries(parts, false)!;
    g20.computeBoundingSphere();
    parts20.push({ name, geometry: g20, material });

    if (parts40) parts40.push({ name, geometry: stretchTo40(g20.clone()), material });
  }

  return { parts20, parts40 };
}

/**
 * Hasil olahan disimpan per GLTF. useGLTF sendiri sudah men-cache file-nya,
 * tapi tanpa cache ini mematikan lalu menyalakan lagi toggle "model detail"
 * akan membangun ulang geometri dan tekstur — dan yang lama tidak pernah
 * di-dispose, jadi bocor puluhan MB tiap kali.
 */
const cache = new WeakMap<GLTF, Map<ModelSpec, InstancedModel>>();

function modelFor(gltf: GLTF, spec: ModelSpec): InstancedModel {
  // Dikunci per (gltf, spec), bukan per gltf saja.
  //
  // Satu berkas kini diolah DUA KALI dengan spec berbeda: sekali dinormalkan
  // abu-abu untuk diwarnai, sekali apa adanya untuk menampilkan cat aslinya.
  // Dengan kunci lama, panggilan kedua akan menerima hasil olahan pertama dan
  // spec-nya diam-diam diabaikan.
  let perSpec = cache.get(gltf);
  if (!perSpec) {
    perSpec = new Map<ModelSpec, InstancedModel>();
    cache.set(gltf, perSpec);
  }
  let model = perSpec.get(spec);
  if (!model) {
    model = buildInstancedModel(gltf, spec);
    perSpec.set(spec, model);
  }
  return model;
}

/**
 * Truk dipakai pada skala dan titik asalnya sendiri: aset ini sudah dalam
 * meter (5,90 x 4,13 x 3,01 setelah diputar), dan chassis prosedural
 * disambungkan memakai koordinat itu apa adanya.
 */
const TRUCK_SPEC: ModelSpec = {
  fit: null,
  stretch40: false,
  side: THREE.FrontSide,
  orient: ORIENT_LENGTH_ON_Z,
  rigidEnd: 0,
  tint: false,
};

export const containerModelFor = (gltf: GLTF) => modelFor(gltf, CONTAINER_SPEC);
export const tankModelFor = (gltf: GLTF) => modelFor(gltf, TANK_SPEC);
export const reeferModelFor = (gltf: GLTF) => modelFor(gltf, REEFER_SPEC);

/**
 * Varian TANPA normalisasi warna: tekstur dan warna material aset dipakai apa
 * adanya.
 *
 * Ini yang dipakai saat pewarnaan dimatikan. Satu nilai tint tidak akan pernah
 * bisa menampilkan aset yang catnya lebih dari satu warna — tank misalnya
 * bertabung putih dengan rangka biru pekat, dan tint mengalikan seluruh model
 * secara seragam. Satu-satunya cara menampilkan cat aslinya adalah tidak
 * mengubahnya sejak awal.
 *
 * Geometrinya memang dibangun dua kali, tapi teksturnya TIDAK berlipat: varian
 * ini memakai map bawaan aset, sedangkan varian bertint yang membuat tekstur
 * baru di canvas.
 */
const plain = (s: ModelSpec): ModelSpec => ({ ...s, tint: false });
const CONTAINER_PLAIN = plain(CONTAINER_SPEC);
const TANK_PLAIN = plain(TANK_SPEC);
const REEFER_PLAIN = plain(REEFER_SPEC);

export const containerModelPlainFor = (gltf: GLTF) => modelFor(gltf, CONTAINER_PLAIN);
export const tankModelPlainFor = (gltf: GLTF) => modelFor(gltf, TANK_PLAIN);
export const reeferModelPlainFor = (gltf: GLTF) => modelFor(gltf, REEFER_PLAIN);
/** Alat berat: skala dan warna aslinya, hanya diturunkan ke tanah. */
const propSpec = (orient: THREE.Matrix4): ModelSpec => ({
  fit: null,
  stretch40: false,
  side: THREE.FrontSide,
  orient,
  rigidEnd: 0,
  tint: false,
  ground: true,
});

// ITV memanjang pada Z seperti aset kontainer; RTG dan STS sudah pada sumbu
// lapangan (X melintang jalur, Y ke atas, Z bentang).
const ITV_SPEC = propSpec(ORIENT_LENGTH_ON_Z);
const CRANE_SPEC = propSpec(new THREE.Matrix4());

export const truckModelFor = (gltf: GLTF) => modelFor(gltf, TRUCK_SPEC);
export const itvModelFor = (gltf: GLTF) => modelFor(gltf, ITV_SPEC);
export const craneModelFor = (gltf: GLTF) => modelFor(gltf, CRANE_SPEC);
