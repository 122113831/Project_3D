import { LANE, PITCH, ROAD, ROAD_ARMS, type RoadKind } from './constants';
import { aroundBlock, laneSide } from './yard';

/**
 * Menentukan di mana sebuah ubin jalan mendarat, supaya jalur terbentuk sendiri
 * tanpa mengetik angka.
 *
 * Ada dua sumber tempelan, dan keduanya perlu:
 *
 * 1. UBIN LAIN. Tiap ubin yang sudah ada menawarkan empat petak tetangga —
 *    kiri, kanan, depan, belakang menurut sudutnya sendiri. Tanpa ini, belokan
 *    yang baru ditaruh tidak punya hubungan apa pun dengan ubin lurus
 *    berikutnya, dan satu-satunya cara menyambungkannya adalah mengetik
 *    koordinat.
 *
 * 2. JALAN DI LORONG SAMPING BLOK. Ubin menyambung ke ujung jalan itu dan
 *    MELANJUTKANNYA keluar dari blok. Bukan menimpanya: jalan lorong sudah
 *    tergambar sepanjang bloknya, dan menaruh ubin di atasnya cuma menggandakan
 *    jalan yang sama sambil menutupi marka di bawahnya.
 *
 * Sudut ubin ikut diputar supaya salah satu lengannya menghadap ke arah asal
 * tempelan. Itu yang membuat "belokan lalu lurus" langsung nyambung: ubin lurus
 * yang ditaruh di sisi keluar belokan otomatis berdiri melintang, bukan
 * sejajar.
 */

/** Jarak garis tengah jalan lorong dari TEPI blok. */
const ROAD_MID = (LANE.road.from + LANE.road.to) / 2;

/** Sedekat apa harus diklik supaya ubin menempel ke ubin tetangga. */
const REACH = ROAD.tile * 0.85;

/**
 * Untuk jalan lorong yang diukur adalah jarak TEGAK LURUS ke garisnya, bukan
 * jarak lurus ke petak tujuan.
 *
 * Bedanya menentukan. Dengan jarak lurus, klik di tengah lorong terlalu jauh
 * dari petak di ujung blok, jadi tidak ada kandidat yang lolos dan ubin jatuh
 * ke kisi global — tepat di atas jalan lorong yang justru tidak boleh
 * ditimpa. Dengan jarak tegak lurus, membidik lorong di mana pun sepanjangnya
 * tetap terbaca sebagai "sambungkan ke lorong ini", dan ubinnya pergi ke ujung
 * blok tempat ia benar-benar menyambung.
 */
const LANE_AIM = ROAD.width * 0.75;

/** Dua ubin dianggap menempati petak yang sama kalau sedekat ini. */
const SAME = 0.4;

/** Sependek apa sebuah potongan masih pantas digambar. */
export const MIN_LEN = 0.4;

/**
 * Panjang sebuah ubin searah lengannya.
 *
 * Hanya jalan LURUS yang boleh dipendekkan. Belokan, pertigaan, dan perempatan
 * harus tetap persegi: kotak persimpangannya seukuran lebar jalan, jadi
 * memendekkannya akan memotong lengan yang justru menjadi bentuknya.
 */
export const roadLen = (r: { kind: RoadKind; len?: number }) =>
  r.kind === 'straight' && r.len ? Math.max(MIN_LEN, r.len) : ROAD.tile;

/**
 * Kedua ujung garis tengah jalan lorong sebuah blok, dalam koordinat dunia.
 *
 * Dipakai dua kali: sebagai tempat menempel, dan sebagai penghalang saat
 * mengukur sisa ruang — sebuah potongan tidak boleh menembus lorong blok lain.
 */
function laneEnds(b: SnapBlock): [[number, number], [number, number]] {
  const length = b.slots * PITCH.teu;
  const width = b.rows * PITCH.row;
  const off = laneSide(b) * (width / 2 + ROAD_MID);
  return [aroundBlock(b, -length / 2, off), aroundBlock(b, length / 2, off)];
}

export const snapTile = (v: number) =>
  (Math.round(v / ROAD.tile - 0.5) + 0.5) * ROAD.tile;

export type SnapBlock = {
  originX: number;
  originZ: number;
  slots: number;
  rows: number;
  rot?: number;
  truckLane?: 'L' | 'R';
};

export type SnapRoad = {
  id: string;
  kind: RoadKind;
  x: number;
  z: number;
  ry: number;
  len?: number;
};

export type RoadSnap = {
  x: number;
  z: number;
  /** Sudut hasil tempelan, atau null kalau jatuh ke kisi global. */
  ry: number | null;
  /**
   * Panjang potongan, sudah dipaskan ke ruang yang benar-benar tersisa.
   *
   * Sama dengan ROAD.tile kalau ruangnya lapang. Lebih pendek kalau di depan
   * sana ada ubin lain atau lorong blok yang lebih dekat daripada satu ubin —
   * dan justru itu yang membuat jalan bisa menyatu di antara blok yang
   * panjangnya berbeda.
   */
  len: number;
};

/** Arah tiap lengan pada kerangka lokal ubin, sebagai vektor (x, z). */
const ARM_DIR = {
  E: [1, 0],
  W: [-1, 0],
  N: [0, -1],
  S: [0, 1],
} as const;

/** Memutar vektor lokal ke dunia, memakai konvensi Matrix4.makeRotationY. */
function toWorld(dx: number, dz: number, ry: number): [number, number] {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return [dx * c + dz * s, -dx * s + dz * c];
}

/**
 * Sudut yang membuat salah satu lengan `kind` menghadap arah `bx, bz`.
 *
 * Dicoba empat kelipatan 90 derajat dari `base`, dan yang paling dekat dengan
 * base menang — jadi ubin tidak berputar lebih jauh dari yang perlu.
 */
function orientToward(kind: RoadKind, base: number, bx: number, bz: number): number {
  for (const turn of [0, Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const ry = base + turn;
    for (const arm of ROAD_ARMS[kind]) {
      const [ax, az] = ARM_DIR[arm];
      const [wx, wz] = toWorld(ax, az, ry);
      if (wx * bx + wz * bz > 0.9) return ry;
    }
  }
  return base;
}

/**
 * Tempat sebuah potongan baru bisa MULAI, bukan tempat pusatnya jatuh.
 *
 * Pusatnya baru bisa dihitung setelah panjangnya diketahui, dan panjangnya
 * bergantung pada sisa ruang di depan titik mulai ini.
 */
type Anchor = {
  /** Titik tempat jalan yang sudah ada berakhir. */
  ex: number;
  ez: number;
  /** Arah menjauh dari jalan itu, sudah dinormalkan. */
  dx: number;
  dz: number;
  /** Sudut acuan sebelum diputar menghadap tempelan. */
  base: number;
  /** Jarak penilai kelayakan kalau bukan jarak ke pusat — dipakai lorong blok. */
  aim: number | null;
  limit: number;
};

/**
 * Sisa ruang bebas dari titik mulai sebuah tempelan, dibatasi satu ubin.
 *
 * Inilah yang membuat jalannya dinamis. Ubin berukuran tetap 24 m tidak akan
 * pernah bisa menutup celah antar blok: panjang blok kelipatan 6,4 m dan
 * 24 / 6,4 = 3,75, jadi ujung blok dan kisi ubin tidak pernah sefase. Blok A
 * (121,6 m) dan blok B (128 m) di lapangan ini menyisakan 0,40 m di ujung timur
 * dan 6,00 m di ujung barat — dua-duanya jauh di bawah satu ubin, dan tidak ada
 * ubin utuh yang muat. Dengan sisa ruang diukur, potongannya tinggal dipotong
 * sepanjang celah itu.
 */
function freeRun(
  a: Anchor,
  others: readonly SnapRoad[],
  blocks: readonly SnapBlock[],
): number {
  // Tidak perlu melihat lebih jauh dari satu ubin: itu panjang maksimum sebuah
  // potongan.
  // Bertipe number, bukan literal 24: nilainya memang akan mengecil.
  let run: number = ROAD.tile;
  const closer = (t: number) => {
    if (t >= 0 && t < run) run = t;
  };

  /** Jarak sepanjang arah kita, dan simpangan tegak lurusnya. */
  const project = (px: number, pz: number) => {
    const rx = px - a.ex;
    const rz = pz - a.ez;
    return [rx * a.dx + rz * a.dz, Math.abs(rx * -a.dz + rz * a.dx)] as const;
  };

  for (const r of others) {
    const [t, p] = project(r.x, r.z);
    if (t <= 0 || p > ROAD.width / 2) continue;
    // Ubin yang sumbunya sejajar arah kita menghadang selebar panjangnya;
    // yang melintang menghadang selebar satu ubin.
    const [ux, uz] = toWorld(1, 0, r.ry);
    const along = Math.abs(ux * a.dx + uz * a.dz) > 0.7;
    closer(t - (along ? roadLen(r) : ROAD.tile) / 2);
  }

  // Lorong blok lain: potongan berhenti tepat di ujungnya, tidak menimpanya.
  for (const b of blocks) {
    for (const [px, pz] of laneEnds(b)) {
      const [t, p] = project(px, pz);
      if (t <= 0 || p > ROAD.width / 2) continue;
      closer(t);
    }
  }

  return run;
}

export function snapRoad(
  blocks: readonly SnapBlock[],
  roads: readonly SnapRoad[],
  kind: RoadKind,
  x: number,
  z: number,
  selfId?: string,
): RoadSnap {
  const others = roads.filter((r) => r.id !== selfId);
  const anchors: Anchor[] = [];

  // --- 1. sisi tiap ubin yang sudah ada -------------------------------------
  for (const r of others) {
    for (const arm of ['E', 'W', 'N', 'S'] as const) {
      const [ax, az] = ARM_DIR[arm];
      const [wx, wz] = toWorld(ax, az, r.ry);
      // Sisi ubin itu sendiri, bukan pusat petak tetangga: potongan baru mulai
      // menempel di sini, dan panjangnya baru ditentukan sesudahnya.
      const half = ax !== 0 ? roadLen(r) / 2 : ROAD.tile / 2;
      anchors.push({
        ex: r.x + wx * half,
        ez: r.z + wz * half,
        dx: wx,
        dz: wz,
        base: r.ry,
        aim: null,
        limit: REACH,
      });
    }
  }

  // --- 2. lanjutan jalan di lorong samping blok -----------------------------
  for (const b of blocks) {
    const length = b.slots * PITCH.teu;
    const [[ax, az], [ex, ez]] = laneEnds(b);
    const dx = ex - ax;
    const dz = ez - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;

    const along = (x - ax) * ux + (z - az) * uz;
    const perp = Math.abs((x - ax) * -uz + (z - az) * ux);

    // Ubin ditaruh DI LUAR rentang blok, melanjutkan jalannya — tidak pernah
    // di atasnya. Ujung mana yang dipakai ditentukan sisi klik, dan mengklik
    // beberapa ubin jauh dari ujungnya tetap menaruhnya di sana, bukan
    // memaksanya menempel di ujung.
    const beyondEnd = along > length / 2;
    const n = beyondEnd
      ? Math.max(0, Math.round((along - length) / ROAD.tile - 0.5))
      : Math.max(0, Math.round(-along / ROAD.tile - 0.5));
    const start = beyondEnd ? length + n * ROAD.tile : -n * ROAD.tile;

    anchors.push({
      ex: ax + ux * start,
      ez: az + uz * start,
      dx: beyondEnd ? ux : -ux,
      dz: beyondEnd ? uz : -uz,
      base: b.rot ?? 0,
      aim: perp,
      limit: LANE_AIM,
    });
  }

  // Petak yang sudah terisi tidak ditawarkan lagi. Ambangnya ikut potongan
  // TERPENDEK di antara keduanya: dengan ambang tetap seukuran ubin, sebuah
  // penutup celah 0,4 m tidak akan pernah lolos karena tetangganya yang utuh
  // selalu terlalu dekat.
  const free = (cx: number, cz: number, len: number) =>
    !others.some(
      (r) => Math.hypot(r.x - cx, r.z - cz) < Math.min(roadLen(r), len) * SAME,
    );

  // Kelayakan dinilai dengan `aim` masing-masing, tapi PERINGKATNYA memakai
  // jarak sebenarnya ke petak tujuan — supaya kalau ubin tetangga dan lorong
  // sama-sama layak, yang menang adalah yang benar-benar lebih dekat.
  let best: (RoadSnap & { ry: number; d: number }) | null = null;
  for (const a of anchors) {
    const run = freeRun(a, others, blocks);
    // Hanya jalan lurus yang bisa menyusut; bentuk lain harus tetap persegi.
    const len = kind === 'straight' ? Math.min(ROAD.tile, run) : ROAD.tile;
    if (len < MIN_LEN) continue;

    const cx = a.ex + (a.dx * len) / 2;
    const cz = a.ez + (a.dz * len) / 2;
    const d = Math.hypot(x - cx, z - cz);
    if ((a.aim ?? d) > a.limit || !free(cx, cz, len)) continue;
    if (!best || d < best.d) {
      best = {
        x: cx,
        z: cz,
        ry: orientToward(kind, a.base, -a.dx, -a.dz),
        len,
        d,
      };
    }
  }

  if (best) return { x: best.x, z: best.z, ry: best.ry, len: best.len };
  return { x: snapTile(x), z: snapTile(z), ry: null, len: ROAD.tile };
}
