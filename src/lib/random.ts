/**
 * PRNG deterministik — tata letak yard harus identik di server dan client,
 * dan sama persis setiap reload supaya bisa dibandingkan saat profiling.
 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export const pick = <T,>(rng: Rng, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)];

/** Bilangan bulat dalam [lo, hi] inklusif. */
export const randInt = (rng: Rng, lo: number, hi: number) =>
  lo + Math.floor(rng() * (hi - lo + 1));

/** Pilih berdasarkan bobot; `weights` sejajar dengan `arr`. */
export function weighted<T>(rng: Rng, arr: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let t = rng() * total;
  for (let i = 0; i < arr.length; i++) {
    t -= weights[i];
    if (t <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}
