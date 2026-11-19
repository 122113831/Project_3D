/**
 * Langit menurut jam dan cuaca — murni angka dan warna, tanpa three maupun
 * React, supaya bisa diuji.
 *
 * Matahari terbit pukul 06.00 dan terbenam 18.00 (cukup tepat untuk lintang
 * Indonesia sepanjang tahun), melintas dari timur (+X) ke barat (-X) dengan
 * puncak elevasi 65°. Warna langit dan cahaya diinterpolasi antara tiga
 * keadaan — malam, senja, siang — menurut elevasi itu.
 */

export type Sky = {
  /** Elevasi matahari, -1..1 (sinus sudutnya). */
  elevation: number;
  /** Arah datangnya cahaya utama (matahari atau bulan), vektor satuan. */
  dir: [number, number, number];
  clear: string;
  fog: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  sunColor: string;
  sunIntensity: number;
  fillIntensity: number;
  /** Lampu tiang menyala. */
  night: boolean;
};

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: Rgb) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: string, b: string, t: number) => {
  const x = hex(a);
  const y = hex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

const NIGHT = {
  clear: '#0b1220',
  fog: '#0e1626',
  hemiSky: '#1a2742',
  hemiGround: '#3a3320',
  hemiIntensity: 0.55,
  sunColor: '#9fb4e6',
  sunIntensity: 0.35,
  fill: 0.08,
};
const DAY = {
  clear: '#a7c8e7',
  fog: '#bcd5ec',
  hemiSky: '#dbeaff',
  hemiGround: '#b6ad97',
  hemiIntensity: 1.25,
  sunColor: '#fff2de',
  sunIntensity: 1.95,
  fill: 0.42,
};
const DUSK = { clear: '#e9a77c', fog: '#e7b996', sunColor: '#ffad66' };

/** Langit tetap: siang atau malam penuh (mode tanpa jam). */
export function fixedSky(night: boolean): Sky {
  return skyAtHour(night ? 0 : 9.5);
}

export function skyAtHour(hour: number): Sky {
  const f = (hour - 6) / 12; // 0 = terbit, 1 = terbenam
  const elevation = Math.sin(f * Math.PI);
  // Terang naik cepat di sekitar cakrawala: pukul 17.45 (elevasi ±3°) langit
  // masih terang dan jingga, gelapnya baru datang setelah matahari terbenam.
  const day = smooth(-0.12, 0.15, elevation);
  // Senja paling kuat sedikit di atas cakrawala, hilang di siang dan malam.
  const dusk = Math.max(0, 1 - Math.abs(elevation - 0.08) / 0.22) * (elevation > -0.12 ? 1 : 0);

  let dir: [number, number, number];
  if (elevation > -0.05) {
    const az = Math.max(0, Math.min(1, f)) * Math.PI;
    const el = Math.max(0.05, elevation) * (65 / 90) * (Math.PI / 2);
    dir = [Math.cos(az) * Math.cos(el), Math.sin(el), -0.35 * Math.cos(el)];
  } else {
    // Bulan: rendah, dari arah tetap.
    dir = [-0.45, 0.75, 0.48];
  }
  const l = Math.hypot(...dir);
  dir = [dir[0] / l, dir[1] / l, dir[2] / l];

  const clear = mix(mix(NIGHT.clear, DAY.clear, day), DUSK.clear, dusk * 0.65);
  const fog = mix(mix(NIGHT.fog, DAY.fog, day), DUSK.fog, dusk * 0.6);
  return {
    elevation,
    dir,
    clear,
    fog,
    hemiSky: mix(NIGHT.hemiSky, DAY.hemiSky, day),
    hemiGround: mix(NIGHT.hemiGround, DAY.hemiGround, day),
    hemiIntensity: lerp(NIGHT.hemiIntensity, DAY.hemiIntensity, day),
    sunColor: mix(mix(NIGHT.sunColor, DAY.sunColor, day), DUSK.sunColor, dusk * 0.8),
    sunIntensity: lerp(NIGHT.sunIntensity, DAY.sunIntensity, day) * (1 - dusk * 0.25),
    fillIntensity: lerp(NIGHT.fill, DAY.fill, day),
    night: elevation < 0.04,
  };
}

/**
 * Cuaca menurunkan cahaya dan memudarkan langit ke abu-abu.
 * `cloud` 0..1; hujan dan kabut dihitung sebagai awan tebal.
 */
export function withWeather(s: Sky, cloud: number): Sky {
  const c = Math.max(0, Math.min(1, cloud));
  const grey = s.night ? '#141a24' : '#8f99a4';
  return {
    ...s,
    clear: mix(s.clear, grey, c * 0.65),
    fog: mix(s.fog, grey, c * 0.6),
    sunIntensity: s.sunIntensity * (1 - 0.6 * c),
    hemiIntensity: s.hemiIntensity * (1 - 0.15 * c),
  };
}
