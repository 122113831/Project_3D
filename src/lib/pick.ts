/**
 * Uji klik editor: sinar dari kamera terhadap kotak sebuah objek.
 *
 * Dulu uji klik menembakkan sinar ke bidang tanah lalu mencocokkan kotak alas.
 * Akibatnya benda tinggi hanya bisa dipilih dari telapak kakinya — mengklik
 * badan tiang lampu setinggi 34 m tidak memilih apa pun, karena titik di tanah
 * yang ditunjuk sinar itu jatuh jauh dari kaki tiangnya.
 *
 * Dipisah ke modul sendiri karena isinya geometri murni tanpa React maupun
 * three: tandanya bisa salah tanpa terlihat, dan yang seperti itu harus bisa
 * diuji langsung.
 */

/** Kotak sebuah objek: alas, tinggi, dan rotasinya terhadap sumbu Y. */
export type Rect = {
  cx: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
};

export type Ray = {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
};

/** Kelonggaran klik, meter. Objek tipis pun tetap bisa dikenai. */
export const PICK_PAD = 0.5;

/**
 * Jarak sepanjang sinar sampai menyentuh kotak, atau null kalau meleset.
 *
 * Sinarnya dipindah ke kerangka lokal kotak lebih dulu — memutar sinar jauh
 * lebih murah daripada memutar kotaknya — lalu diuji dengan metode slab biasa.
 *
 * Kotak BERDIRI di atas tanah, jadi rentang y-nya 0..sy, bukan simetris seperti
 * x dan z. Salah di sini membuat objek bisa dipilih dari bawah tanah.
 */
export function rayHit(rect: Rect, ray: Ray, pad = PICK_PAD): number | null {
  // Membalik rotasi three.js: kalau titik dunia P = C + R(ry)*d, maka
  // d = R(-ry)*(P-C), yang terurai jadi dx*cos - dz*sin dan dx*sin + dz*cos.
  // Tanda ini HARUS sepasang dengan aroundBlock di yard.ts; kalau tidak, kotak
  // kliknya miring ke arah yang berlawanan dengan bendanya.
  const c = Math.cos(rect.ry);
  const s = Math.sin(rect.ry);
  const ox = ray.origin.x - rect.cx;
  const oz = ray.origin.z - rect.cz;

  const o = [ox * c - oz * s, ray.origin.y, ox * s + oz * c];
  const d = [
    ray.direction.x * c - ray.direction.z * s,
    ray.direction.y,
    ray.direction.x * s + ray.direction.z * c,
  ];
  const lo = [-rect.sx / 2 - pad, -pad, -rect.sz / 2 - pad];
  const hi = [rect.sx / 2 + pad, rect.sy + pad, rect.sz / 2 + pad];

  let tMin = -Infinity;
  let tMax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      // Sinar sejajar sumbu ini: entah selalu di dalam, entah tidak pernah.
      if (o[i] < lo[i] || o[i] > hi[i]) return null;
      continue;
    }
    let t1 = (lo[i] - o[i]) / d[i];
    let t2 = (hi[i] - o[i]) / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMax < tMin) return null;
  }
  // Kotak sepenuhnya di belakang kamera.
  if (tMax < 0) return null;
  // tMin negatif berarti kameranya ada DI DALAM kotak.
  return tMin >= 0 ? tMin : tMax;
}
