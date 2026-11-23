import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelPart } from './containerModel';
import { hazardTexture } from './rtgDetail';
import {
  CANOPY_DEPTH,
  DOCK_DEPTH,
  dockCount,
  OFFICE_DEPTH,
  roofRise,
  warehouseBounds,
  warehouseSpec,
  type WarehouseSpec,
} from './warehouseSpec';

/**
 * Gudang prosedural (dinding seng gelombang, atap pelana/datar/gergaji, pintu
 * gulung + dock, kanopi, kantor, papan nama, lampu malam) — pola yang sama
 * dengan mockup yang disetujui. Ukuran & warna dari WarehouseSpec, jadi satu
 * fungsi melayani semua ukuran.
 *
 * Bagian dikelompokkan per material dan digabung: satu gudang = belasan draw
 * call, berapa pun ukurannya. UV ditulis dalam METER (proyeksi menurut arah
 * normal), jadi tekstur rusuk seng berjarak sama di dinding sepanjang apa pun.
 *
 * Titik nol model = tengah TAPAK (lihat warehouseBounds), sumbu X = panjang.
 */

type Key = 'wall' | 'roof' | 'trim' | 'concrete' | 'door' | 'glass' | 'lamp' | 'office' | 'hazard' | 'rubber' | 'metal' | 'pool';
type Bucket = Record<Key, THREE.BufferGeometry[]>;
const bucket = (): Bucket => ({
  wall: [], roof: [], trim: [], concrete: [], door: [], glass: [], lamp: [], office: [], hazard: [], rubber: [], metal: [], pool: [],
});

/** UV planar dalam meter / `period`, menurut arah normal tiap verteks. */
function meterUv(g: THREE.BufferGeometry, period = 1) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i);
      v = p.getY(i);
    } else {
      u = p.getX(i);
      v = p.getY(i);
    }
    uv[i * 2] = u / period;
    uv[i * 2 + 1] = v / period;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function box(out: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  out.push(g);
  return g;
}
function cyl(out: THREE.BufferGeometry[], r: number, h: number, x: number, y: number, z: number, seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, seg).toNonIndexed();
  g.translate(x, y, z);
  out.push(g);
}

function build(s: WarehouseSpec): Bucket {
  const b = bucket();
  const { w: L, d: W, h: H } = s;
  const wallMid = 1.7 + (H - 1.2) / 2 - 0.5;

  // Pelat dasar & plint beton, dinding seng empat sisi, tiang sudut, lis atas.
  box(b.concrete, L + 2, 0.5, W + 2, 0, 0.25, 0);
  box(b.concrete, L + 0.2, 1.2, W + 0.2, 0, 1.1, 0);
  box(b.wall, L, H - 1.2, 0.25, 0, wallMid, W / 2);
  box(b.wall, L, H - 1.2, 0.25, 0, wallMid, -W / 2);
  box(b.wall, 0.25, H - 1.2, W, L / 2, wallMid, 0);
  box(b.wall, 0.25, H - 1.2, W, -L / 2, wallMid, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(b.trim, 0.5, H, 0.5, (sx * L) / 2, H / 2, (sz * W) / 2);
  for (const sz of [-1, 1]) box(b.trim, L + 0.6, 0.35, 0.4, 0, H, (sz * W) / 2);

  // Atap.
  const rise = roofRise(s);
  if (s.roof === 'gable') {
    const half = W / 2 + 0.8;
    const slope = Math.hypot(half, rise);
    for (const sz of [-1, 1]) {
      box(b.roof, L + 1.6, 0.15, slope, 0, H + rise / 2, sz * (W / 4 + 0.2), sz * Math.atan2(rise, half));
    }
    box(b.trim, L + 1.7, 0.35, 0.6, 0, H + rise + 0.05, 0);
    // Dinding segitiga di kedua ujung.
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2, 0);
    tri.lineTo(W / 2, 0);
    tri.lineTo(0, rise);
    tri.closePath();
    for (const sx of [-1, 1]) {
      const t = new THREE.ShapeGeometry(tri).toNonIndexed();
      // Dua muka supaya terlihat dari dalam dan luar tanpa material DoubleSide.
      const back = t.clone();
      const idx = back.getAttribute('position');
      for (let i = 0; i < idx.count; i += 3) {
        const x1 = idx.getX(i + 1), y1 = idx.getY(i + 1), z1 = idx.getZ(i + 1);
        idx.setXYZ(i + 1, idx.getX(i + 2), idx.getY(i + 2), idx.getZ(i + 2));
        idx.setXYZ(i + 2, x1, y1, z1);
      }
      back.computeVertexNormals();
      for (const g of [t, back]) {
        g.rotateY((sx * Math.PI) / 2);
        g.translate((sx * L) / 2 + sx * 0.13, H, 0);
        b.wall.push(g);
      }
    }
    for (let x = -L / 2 + 8; x <= L / 2 - 8; x += 12) cyl(b.metal, 0.6, 1.0, x, H + rise + 0.7, 0, 14);
  } else if (s.roof === 'flat') {
    box(b.roof, L, 0.3, W, 0, H + 0.15, 0);
    for (const sz of [-1, 1]) box(b.trim, L + 0.4, 1.2, 0.3, 0, H + 0.6, (sz * W) / 2);
    for (const sx of [-1, 1]) box(b.trim, 0.3, 1.2, W, (sx * L) / 2, H + 0.6, 0);
    for (let x = -L / 2 + 6; x < L / 2 - 4; x += 10) box(b.metal, 2.4, 1.3, 1.6, x, H + 0.95, -W / 4);
  } else {
    const teeth = Math.max(2, Math.round(W / 8));
    const tw = W / teeth;
    for (let i = 0; i < teeth; i++) {
      const z0 = -W / 2 + i * tw;
      box(b.roof, L + 0.8, 0.15, Math.hypot(tw, rise), 0, H + rise / 2, z0 + tw / 2, -Math.atan2(rise, tw));
      box(b.glass, L + 0.4, rise, 0.12, 0, H + rise / 2, z0 + tw);
    }
  }

  // Jendela lajur atas di kedua sisi panjang.
  for (const sz of [-1, 1]) for (let x = -L / 2 + 4; x <= L / 2 - 4; x += 4) box(b.glass, 2.6, 0.9, 0.1, x, H - 1.4, sz * (W / 2 + 0.14));

  // Dock + pintu gulung di sisi +Z.
  const doors = dockCount(s);
  if (s.docks) {
    box(b.concrete, L - 4, 1.2, DOCK_DEPTH, 0, 0.6, W / 2 + DOCK_DEPTH / 2);
    box(b.hazard, L - 4, 0.25, 0.12, 0, 1.08, W / 2 + DOCK_DEPTH + 0.02);
    for (let i = 0; i < doors; i++) {
      const x = -((doors - 1) * 9) / 2 + i * 9;
      box(b.door, 4.4, 4.8, 0.12, x, 1.2 + 2.4, W / 2 + 0.16);
      box(b.trim, 4.9, 0.5, 0.5, x, 1.2 + 5.0, W / 2 + 0.3);
      for (const sx of [-1, 1]) box(b.trim, 0.25, 4.8, 0.3, x + sx * 2.35, 1.2 + 2.4, W / 2 + 0.2);
      for (const sx of [-1, 1]) box(b.rubber, 0.45, 0.6, 0.35, x + sx * 1.6, 0.9, W / 2 + DOCK_DEPTH + 0.15);
      box(b.lamp, 0.6, 0.3, 0.5, x, 1.2 + 5.6, W / 2 + 0.5);
      // Genangan cahaya malam di depan pintu.
      const pool = new THREE.CircleGeometry(4.5, 24).toNonIndexed();
      pool.rotateX(-Math.PI / 2);
      pool.translate(x, 0.07, W / 2 + DOCK_DEPTH + 3);
      b.pool.push(pool);
    }
    if (s.canopy) {
      const cy = 1.2 + 6.2;
      box(b.roof, L - 2, 0.2, CANOPY_DEPTH, 0, cy, W / 2 + CANOPY_DEPTH / 2, 0.06);
      for (let x = -L / 2 + 3; x <= L / 2 - 3; x += 9) {
        const strut = new THREE.CylinderGeometry(0.06, 0.06, 4, 6).toNonIndexed();
        strut.rotateX(-0.95);
        strut.translate(x, cy + 1.2, W / 2 + 2.6);
        b.trim.push(strut);
      }
    }
  }

  // Pintu personel di sisi belakang, talang/pipa turun di keempat sudut.
  box(b.door, 1.1, 2.3, 0.1, L / 2 - 3, 1.2 + 1.15, -W / 2 - 0.15);
  for (const sz of [-1, 1]) for (const x of [-L / 2 + 0.6, L / 2 - 0.6]) cyl(b.metal, 0.12, H, x, H / 2, sz * (W / 2 + 0.35), 8);

  // Kantor kecil di ujung -X.
  if (s.office) {
    const ow = Math.min(W * 0.55, 14);
    const od = OFFICE_DEPTH;
    const oh = 6.5;
    const oz = W / 2 - ow / 2 - 1;
    box(b.office, od, oh, ow, -L / 2 - od / 2, oh / 2, oz);
    box(b.trim, od + 0.6, 0.35, ow + 0.6, -L / 2 - od / 2, oh + 0.1, oz);
    for (let z = oz - ow / 2 + 1.6; z < oz + ow / 2 - 1.2; z += 2.6) {
      for (const y of [1.8, 4.2]) box(b.glass, 0.1, 1.4, 1.8, -L / 2 - od - 0.06, y, z);
    }
    box(b.door, 0.1, 2.3, 1.2, -L / 2 - od - 0.07, 1.15, oz + ow / 2 - 1.2);
  }

  // Lampu sorot dinding + genangan cahayanya.
  for (let x = -L / 2 + 6; x <= L / 2 - 6; x += 12) {
    for (const sz of [-1, 1]) {
      box(b.lamp, 0.7, 0.35, 0.6, x, H - 0.6, sz * (W / 2 + 0.45));
      if (sz < 0 || !s.docks) {
        const pool = new THREE.CircleGeometry(5, 24).toNonIndexed();
        pool.rotateX(-Math.PI / 2);
        pool.translate(x, 0.06, sz * (W / 2 + 4.5));
        b.pool.push(pool);
      }
    }
  }
  return b;
}

// --- material -------------------------------------------------------------------

const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};

let shared: {
  ribs: THREE.Texture;
  slats: THREE.Texture;
  pool: THREE.Texture;
  trim: THREE.Material;
  concrete: THREE.Material;
  door: THREE.Material;
  glass: THREE.MeshPhongMaterial;
  lamp: THREE.MeshPhongMaterial;
  office: THREE.Material;
  hazard: THREE.Material;
  rubber: THREE.Material;
  metal: THREE.Material;
  poolMat: THREE.MeshBasicMaterial;
} | null = null;

function sharedMats() {
  if (shared) return shared;
  // Rusuk seng: satu gelombang per meter UV (UV dalam meter / 0,8 → 0,8 m).
  const ribs = canvasTex(64, 8, (g) => {
    for (let x = 0; x < 64; x++) {
      const v = 200 + 55 * Math.cos((x / 64) * Math.PI * 2);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, 0, 1, 8);
    }
  });
  const slats = canvasTex(8, 64, (g) => {
    for (let y = 0; y < 64; y++) {
      const v = 205 + 45 * Math.cos((y / 8) * Math.PI * 2);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(0, y, 8, 1);
    }
  });
  const pool = canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  });
  pool.wrapS = pool.wrapT = THREE.ClampToEdgeWrapping;
  const doorTex = slats.clone();
  doorTex.needsUpdate = true;
  shared = {
    ribs,
    slats,
    pool,
    trim: new THREE.MeshPhongMaterial({ color: '#3a4044', shininess: 30 }),
    concrete: new THREE.MeshPhongMaterial({ color: '#b9b8b1', shininess: 6 }),
    door: new THREE.MeshPhongMaterial({ color: '#e3e6e8', map: doorTex, shininess: 45 }),
    glass: new THREE.MeshPhongMaterial({ color: '#2b3a44', shininess: 90, specular: new THREE.Color('#9fb3c2'), emissive: new THREE.Color('#000000') }),
    lamp: new THREE.MeshPhongMaterial({ color: '#2a2c2e', shininess: 40, emissive: new THREE.Color('#000000') }),
    office: new THREE.MeshPhongMaterial({ color: '#f1f2ef', shininess: 10 }),
    hazard: new THREE.MeshPhongMaterial({ map: hazardTexture(), shininess: 18 }),
    rubber: new THREE.MeshPhongMaterial({ color: '#1f1f1f', shininess: 4 }),
    metal: new THREE.MeshPhongMaterial({ color: '#c3c9cd', shininess: 70, specular: new THREE.Color('#9aa0a6') }),
    poolMat: new THREE.MeshBasicMaterial({
      map: pool,
      color: '#ffe0a3',
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  };
  applyNight(shared);
  return shared;
}

let nightOn = false;
function applyNight(m: NonNullable<typeof shared>) {
  m.lamp.emissive.set(nightOn ? '#fff1c8' : '#000000');
  m.glass.emissive.set(nightOn ? '#5a4a22' : '#000000');
  m.poolMat.visible = nightOn;
}

/** Lampu gudang menyala (mode malam) — material bersama semua gudang. */
export function setWarehouseNight(on: boolean) {
  nightOn = on;
  if (shared) applyNight(shared);
}

const paintCache = new Map<string, THREE.MeshPhongMaterial>();
function paint(color: string, kind: 'wall' | 'roof') {
  const k = `${kind}|${color}`;
  let m = paintCache.get(k);
  if (!m) {
    const t = sharedMats().ribs.clone();
    t.needsUpdate = true;
    m = new THREE.MeshPhongMaterial({ color: new THREE.Color(color), map: t, shininess: kind === 'roof' ? 40 : 30, specular: new THREE.Color('#4a5058') });
    paintCache.set(k, m);
  }
  return m;
}

/** Papan nama: tekstur per label. */
const signCache = new Map<string, THREE.Material>();
function signMaterial(label: string) {
  let m = signCache.get(label);
  if (!m) {
    const t = canvasTex(1024, 160, (g) => {
      g.fillStyle = '#1e2a33';
      g.fillRect(0, 0, 1024, 160);
      g.fillStyle = '#f0b52e';
      g.fillRect(0, 146, 1024, 14);
      g.fillStyle = '#ffffff';
      g.font = "700 96px 'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";
      g.textBaseline = 'middle';
      g.fillText(label.toUpperCase(), 36, 76, 960);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    m = new THREE.MeshPhongMaterial({ map: t, shininess: 20 });
    signCache.set(label, m);
  }
  return m;
}

// --- model ----------------------------------------------------------------------

const specKey = (s: WarehouseSpec) =>
  [s.w, s.d, s.h, s.roof, s.wall, s.roofColor, s.docks, s.canopy, s.office, s.label].join('|');
const modelCache = new Map<string, ModelPart[]>();

/** Bagian model gudang untuk spesifikasi parsial (di-cache per isian). */
export function warehouseModel(p?: Partial<WarehouseSpec> | null): ModelPart[] {
  const s = warehouseSpec(p);
  const key = specKey(s);
  const hit = modelCache.get(key);
  if (hit) return hit;
  const m = sharedMats();
  const b = build(s);
  const bounds = warehouseBounds(s);
  const mats: Record<Key, THREE.Material> = {
    wall: paint(s.wall, 'wall'),
    roof: paint(s.roofColor, 'roof'),
    trim: m.trim,
    concrete: m.concrete,
    door: m.door,
    glass: m.glass,
    lamp: m.lamp,
    office: m.office,
    hazard: m.hazard,
    rubber: m.rubber,
    metal: m.metal,
    pool: m.poolMat,
  };
  const periods: Partial<Record<Key, number>> = { wall: 0.8, roof: 0.9, door: 1 };
  const parts: ModelPart[] = [];
  for (const k of Object.keys(b) as Key[]) {
    if (!b[k].length) continue;
    const merged = mergeGeometries(
      b[k].map((g) => {
        // Semua bagian disamakan atributnya: posisi, normal, uv.
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
        return periods[k] ? meterUv(g, periods[k]) : k === 'hazard' ? meterUv(g, 1.2) : g;
      }),
      false,
    )!;
    merged.translate(-bounds.cx, 0, -bounds.cz);
    merged.computeBoundingSphere();
    parts.push({ name: `wh-${key}-${k}`, geometry: merged, material: mats[k] } as ModelPart);
  }
  // Papan nama di dinding panjang BELAKANG (-Z): sisi dock tertutup kanopi
  // dan pintu gulung, jadi papannya menimpa pintu.
  const sw = Math.min(s.w * 0.5, 26);
  const sh = (sw * 160) / 1024;
  const sign = new THREE.PlaneGeometry(sw, sh);
  sign.rotateY(Math.PI);
  // Sisi kiri (jauh dari pintu personel di kanan), di bawah jendela lajur atas.
  sign.translate(-s.w / 2 + sw / 2 + 2 - bounds.cx, s.h - 2.1 - sh / 2, -s.d / 2 - 0.17 - bounds.cz);
  parts.push({ name: `wh-${key}-sign`, geometry: sign, material: signMaterial(s.label) } as ModelPart);
  modelCache.set(key, parts);
  return parts;
}

/** Jumlah segitiga satu gudang (untuk kartu palet / uji). */
export function warehouseTriangles(p?: Partial<WarehouseSpec> | null) {
  return warehouseModel(p).reduce((n, part) => n + part.geometry.getAttribute('position').count / 3, 0);
}
