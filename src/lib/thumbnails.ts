import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Pratinjau kartu palet, dirender dari geometri yang SAMA dengan yang dipakai
 * di lapangan.
 *
 * Bukan gambar tempelan: kalau aset diganti, kartunya ikut berubah sendiri dan
 * tidak akan pernah berbohong tentang apa yang akan diletakkan.
 *
 * Satu renderer kecil dipakai untuk semua kartu lalu dibuang. Membuat
 * WebGLRenderer per kartu akan menghabiskan konteks WebGL — peramban cuma
 * mengizinkan segelintir konteks hidup sekaligus, dan konteks scene utama
 * termasuk di dalamnya.
 */

export type ThumbnailSource = {
  id: string;
  /** Objek prosedural, dibangun langsung. */
  build?: () => THREE.Object3D;
  /** Atau berkas GLB, dimuat lebih dulu. */
  model?: string;
};

const loader = new GLTFLoader();
const modelCache = new Map<string, Promise<THREE.Object3D>>();

function loadModel(url: string): Promise<THREE.Object3D> {
  let p = modelCache.get(url);
  if (!p) {
    p = new Promise<THREE.Object3D>((resolve, reject) => {
      loader.load(url, (g) => resolve(g.scene), undefined, reject);
    });
    modelCache.set(url, p);
  }
  return p;
}

export async function renderThumbnails(
  items: readonly ThumbnailSource[],
  size = { w: 176, h: 116 },
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (typeof document === 'undefined') return out;

  // Model dimuat lebih dulu supaya renderer hidup sesingkat mungkin — konteks
  // WebGL kedua tidak perlu menganggur menunggu unduhan.
  const objects = new Map<string, THREE.Object3D>();
  for (const item of items) {
    try {
      if (item.build) objects.set(item.id, item.build());
      else if (item.model) objects.set(item.id, (await loadModel(item.model)).clone(true));
    } catch {
      // Satu aset gagal tidak boleh menjatuhkan seluruh palet; kartunya jatuh
      // ke label teks saja.
    }
  }
  if (objects.size === 0) return out;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  } catch {
    return out;
  }
  renderer.setSize(size.w, size.h, false);
  renderer.setPixelRatio(2);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdbeaff, 0xb6ad97, 1.5));
  const sun = new THREE.DirectionalLight(0xfff2de, 2.1);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(32, size.w / size.h, 0.1, 6000);
  const holder = new THREE.Group();
  scene.add(holder);

  for (const [id, object] of objects) {
    holder.add(object);

    // Bingkai objek dari bola pembatasnya, jadi benda sepanjang 114 m dan
    // setinggi 3 m sama-sama pas tanpa angka yang disetel manual.
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = (sphere.radius * 1.45) / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(
      sphere.center.x + dist * 0.62,
      sphere.center.y + dist * 0.46,
      sphere.center.z + dist * 0.64,
    );
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    out[id] = renderer.domElement.toDataURL('image/png');
    holder.remove(object);
  }

  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
