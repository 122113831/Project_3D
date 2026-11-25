/**
 * Pembangun model bertahap.
 *
 * Model kontainer realistis per livery (geometri + kanvas marka + material)
 * mahal dibuat: puluhan livery × 20/40ft dalam SATU render React terukur
 * sebagai long task 1–2,5 detik saat halaman dibuka — layar membeku. Di sini
 * tiap model dibangun di slot idle-nya sendiri, satu per satu; pemanggil
 * memakai level jauh (kotak sederhana) sampai modelnya siap, lalu diberi tahu
 * lewat `onModelBuilt` untuk menggambar ulang.
 */
const built = new Set<string>();
const queue = new Map<string, () => void>();
const listeners = new Set<() => void>();
let scheduled = false;

type IdleWin = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };

function pump() {
  scheduled = false;
  const next = queue.entries().next();
  if (next.done) return;
  const [key, build] = next.value;
  queue.delete(key);
  try {
    build();
  } finally {
    built.add(key);
  }
  // Beri tahu sekali per model; React menggabungkan render yang berdekatan.
  for (const l of listeners) l();
  schedule();
}

function schedule() {
  if (scheduled || queue.size === 0) return;
  scheduled = true;
  const w = (typeof window !== 'undefined' ? window : undefined) as IdleWin | undefined;
  // timeout: tetap maju walau halaman tidak pernah benar-benar idle (kamera
  // terus berputar), supaya model detail tidak tertunda selamanya.
  if (w?.requestIdleCallback) w.requestIdleCallback(pump, { timeout: 120 });
  else setTimeout(pump, 16);
}

/**
 * true bila model `key` sudah dibangun (aman dipanggil langsung, dari cache).
 * Bila belum: dijadwalkan dibangun dengan `build`, dan false.
 */
export function ensureModel(key: string, build: () => void): boolean {
  if (built.has(key)) return true;
  if (!queue.has(key)) {
    queue.set(key, build);
    schedule();
  }
  return false;
}

let compiling = 0;

/**
 * Catat satu kompilasi shader latar belakang (renderer.compileAsync) yang
 * sedang berjalan, sampai promise-nya selesai.
 */
export function trackCompile<T>(p: Promise<T>): Promise<T> {
  compiling += 1;
  return p.finally(() => {
    compiling -= 1;
  });
}

/**
 * true selama masih ada model yang menunggu dibangun atau shader yang sedang
 * dikompilasi. Kualitas adaptif menahan perubahan dpr selama ini: frame yang
 * lambat di masa ini sementara, dan mengubah ukuran kanvas (setSize) memaksa
 * GPU menyelesaikan kompilasi yang sedang berjalan — terukur memblokir
 * 0,3–4,3 dtk saat zoom tepat setelah refresh.
 */
export function isWarming(): boolean {
  return queue.size > 0 || compiling > 0;
}

/** Berlangganan pemberitahuan "satu model selesai dibangun". */
export function onModelBuilt(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
