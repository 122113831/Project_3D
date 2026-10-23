/**
 * Semua dimensi dalam meter (1 unit three.js = 1 meter).
 *
 * Tata letak lapangan penumpukan: blok disusun dalam grid kolom × baris.
 * Di dalam satu blok, slot memanjang pada sumbu X, row melebar pada sumbu Z,
 * tier menumpuk pada sumbu Y.
 *
 *        slot 0 ────────────────► slot N      (sumbu X)
 *   row 0 ┌────────────────────────────┐
 *   row 1 │                            │
 *   row 2 │      BLOK  A01             │
 *   row 3 │                            │
 *   row 4 │                            │
 *   row 5 └────────────────────────────┘
 *         ▼ sumbu Z
 */

/** Ukuran kontainer ISO */
export const BOX = {
  len20: 6.06,
  len40: 12.19,
  width: 2.44,
  height: 2.59,
} as const;

/** Jarak antar sumbu penumpukan (pitch), sudah termasuk celah kerja. */
export const PITCH = {
  /** Satu slot TEU sepanjang blok. 40ft = 2 slot. */
  teu: 6.4,
  /** Antar row dalam satu blok */
  row: 2.9,
  /** Antar tier */
  tier: 2.62,
} as const;

/**
 * Dimensi RTG.
 *
 * Dipakai bersama oleh geometri alatnya DAN marka rel di aspal. Kalau
 * keduanya menyimpan angka sendiri-sendiri, garis yang dicat tidak akan
 * sejajar dengan kaki yang berdiri di atasnya — dan selisih setengah meter
 * langsung kelihatan dari dekat.
 */
export const RTG = {
  /** Bentang portal pada sumbu Z. */
  span: 27,
  /** Jarak kaki dari sumbu portal pada sumbu X. */
  legX: 5.2,
  height: 21,
  /**
   * Pergeseran sumbu portal dari sumbu blok, pada sumbu Z.
   *
   * Bukan nol: RTG sungguhan menaungi blok DAN satu lajur truk di sisinya —
   * konfigurasi "6+1", enam row kontainer plus satu lajur layanan. Portalnya
   * digeser supaya kaki jauhnya berdiri di seberang lajur itu, bukan tepat di
   * tepi blok.
   */
  offsetZ: 2.3,
} as const;

/** Jarak roda RTG dari sumbu portal. */
export const RTG_RAIL_Z = RTG.span / 2 - 1;

/** Grid blok di lapangan */
export const YARD = {
  blockCols: 3,
  blockRows: 10,
  /** slot TEU per blok */
  slots: 40,
  rows: 6,
  tiers: 5,
  /** lajur truk antar kolom blok */
  gapX: 24,
  /** lajur RTG / jalan antar baris blok */
  gapZ: 26,
} as const;

export const BLOCK_LENGTH = YARD.slots * PITCH.teu;
export const BLOCK_WIDTH = YARD.rows * PITCH.row;

/**
 * Tata letak lajur di dalam lorong selebar `YARD.gapZ` antara dua baris blok.
 * Semua jarak diukur dari tepi blok di sisi -Z lorong.
 *
 *   0 ─ tepi blok
 *   │  lajur layanan truk (di bawah kantilever RTG blok ini)
 *   6.1 ─ rel RTG blok ini
 *   │  jalan dua arah
 *   24.5 ─ rel RTG blok berikutnya
 *   26 ─ tepi blok berikutnya
 *
 * Posisi kedua rel diturunkan dari RTG, bukan diketik ulang.
 */
export const LANE = {
  width: YARD.gapZ,
  /** Lajur layanan: truk berhenti di sini untuk dilayani RTG. */
  service: { from: 0.9, to: 5.1 },
  /** Jalan dua arah di tengah lorong. */
  road: { from: 8.2, to: 22.2 },
  /** Panjang satu ubin marka. BLOCK_LENGTH harus kelipatan angka ini. */
  tile: 16,
} as const;

/**
 * Jarak bebas kaki RTG dari tepi blok, pada sumbu Z.
 *
 * Portal RTG diskalakan mengikuti lebar bloknya (lihat rtgSpanScale), jadi
 * setengah-bentangnya selalu W/2 + jarak bebas ini. Akibatnya letak rel
 * TERHADAP TEPI BLOK sama untuk blok selebar apa pun — W-nya habis:
 *
 *   rel jauh  = (W/2 + offsetZ + (W/2 + clearance)) - W = offsetZ + clearance
 *
 * Itulah sebabnya satu tekstur lorong tetap benar untuk blok 5 row maupun
 * 11 row seperti di database depot.
 */
/**
 * Jalan dibangun dari UBIN PERSEGI, bukan pita panjang.
 *
 * Pita panjang tidak bisa berbelok, dan dua pita yang bersilangan cuma saling
 * menimpa tanpa marka persimpangan. Dengan ubin seukuran sama, lurus, belokan,
 * pertigaan, dan perempatan bisa disambung berderet dan marka di tepinya
 * bertemu tepat di batas ubin.
 *
 * UBIN HARUS CUKUP LEBIH BESAR DARIPADA BADAN JALANNYA.
 *
 * Ini bukan soal selera. Kotak persimpangan seukuran lebar jalan, jadi kalau
 * jalan hampir selebar ubin, persimpangan hampir menutupi seluruh ubin dan
 * belokan tergambar sebagai sepetak aspal penuh — tikungannya tidak kelihatan
 * sama sekali. Terukur: ubin 16 m dengan jalan 14 m membuat belokan menutupi
 * 87% ubin. Dengan 20 m dan 10 m, belokan menutupi 50% dan bentuk L-nya jelas.
 *
 * Periode marka putus-putus 4 m, dan tile harus kelipatannya supaya pola
 * dashnya menyambung mulus dari ubin ke ubin.
 */
export const ROAD = {
  /** Sisi satu ubin, meter. */
  tile: 24,
  /**
   * Lebar badan jalan, DITURUNKAN dari jalan di lorong samping blok — bukan
   * angka lepas.
   *
   * Ubin jalan harus bisa menyambung mulus ke lorong itu. Kalau lebarnya
   * diketik terpisah, cukup satu kali salah ketik untuk membuat sambungannya
   * berundak, dan cacat seperti itu sulit dilihat tapi mudah dibuat.
   */
  width: LANE.road.to - LANE.road.from,
  /**
   * Tebal marka tepi, meter.
   *
   * Satu angka untuk ubin jalan DAN untuk jalan di lorong blok. Keduanya
   * bersambungan di ujung blok, jadi tebal yang berbeda — atau garis yang ada
   * di satu sisi tapi tidak di sisi lain — langsung terlihat sebagai patahan
   * tepat di sambungannya.
   */
  line: 0.22,
} as const;

/**
 * Ukuran gate.
 *
 * Truk lewat sepanjang sumbu X, jadi `depth` adalah panjang yang dilalui dan
 * `span` lebar melintang yang menampung lajur-lajurnya.
 *
 * `span` DITURUNKAN dari lebar badan jalan, bukan angka lepas: gate berdiri di
 * atas jalan, dan kalau lebarnya diketik terpisah ia akan menggantung keluar
 * atau menyisakan celah begitu lebar jalan berubah.
 *
 * Empat lajur, bukan tiga. Satu jalan lurus membawa DUA arus, jadi gate ini
 * melayani keduanya sekaligus: dua lajur masuk di separuh -Z, dua lajur keluar
 * di separuh +Z. Karena jumlahnya genap, pos petugas di tengah jatuh tepat di
 * garis pemisah kedua arus itu.
 */
export const GATE = {
  /** Panjang searah jalan. */
  depth: 9,
  /** Lebar melintang; pas dengan badan jalan. */
  span: ROAD.width,
  /** Tinggi bawah kanopi — cukup untuk truk bermuatan kontainer high cube. */
  clear: 6.2,
  lanes: 4,
} as const;

export const ROAD_KINDS = ['straight', 'corner', 'tee', 'cross'] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

export const ROAD_LABEL: Record<RoadKind, string> = {
  straight: 'Jalan lurus',
  corner: 'Belokan',
  tee: 'Pertigaan',
  cross: 'Perempatan',
};

/**
 * Lengan tiap jenis ubin pada orientasi bakunya, dalam arah mata angin tekstur:
 * E = +X, W = -X, N = -Z, S = +Z. Memutar ubin kelipatan 90 derajat memberi
 * semua orientasi lain, jadi tidak perlu varian "belok kiri" dan "belok kanan"
 * terpisah.
 */
export const ROAD_ARMS: Record<RoadKind, readonly ('E' | 'W' | 'N' | 'S')[]> = {
  straight: ['E', 'W'],
  corner: ['E', 'S'],
  tee: ['E', 'W', 'S'],
  cross: ['E', 'W', 'N', 'S'],
};

/** Kotak dalam meter, titik nol di sudut ubin, y menuju +Z. */
export type RoadRect = { x: number; y: number; w: number; h: number };

/**
 * Bentuk satu ubin jalan sebagai kumpulan kotak.
 *
 * Marka tepi tidak digambar garis per garis. `outer` adalah badan jalan yang
 * dicat warna garis lebih dulu; `inner` menimpanya dengan aspal. Yang tersisa
 * persis KELILING badan jalan itu — berapa pun bentuknya. Itu sebabnya belokan
 * mendapat garis yang ikut membelok dan perempatan mendapat empat sudut yang
 * benar, tanpa satu pun kasus khusus.
 *
 * Dua detail yang menentukan hasilnya:
 *
 * - `outer` MELEWATI tepi ubin sejauh tebal garis, supaya tutup ujungnya
 *   terpotong keluar dan tidak meninggalkan garis melintang di sambungan
 *   antar-ubin.
 * - `inner` memanjang mundur MELINTASI kotak persimpangan, supaya bagian dalam
 *   sambungan ikut tertimpa aspal dan tidak menyisakan palang kuning di tengah.
 *
 * `junction` adalah kotak yang dipakai menghapus marka tengah di persimpangan,
 * sudah dikecilkan setebal garis supaya keliling yang baru dibentuk tidak ikut
 * terhapus. Untuk ubin lurus tidak ada persimpangan, jadi null.
 */
export function roadTileParts(kind: RoadKind, line: number = ROAD.line) {
  const t = ROAD.tile;
  const c = t / 2;
  const half = ROAD.width / 2;
  const outer: RoadRect[] = [];
  const inner: RoadRect[] = [];

  // Tiap lengan membentang dari SISI SEBERANG kotak persimpangan sampai
  // melewati tepi ubin.
  //
  // Kalau lengan hanya dimulai dari titik pusat, belokan kehilangan seperempat
  // kotak persimpangan — sisi luar tikungannya tidak teraspal dan tergambar
  // sumbing. Terukur waktu diuji, sebelum ini diperbaiki.
  //
  // Versi dalamnya mundur setebal garis LEBIH SEDIKIT, yaitu berhenti di
  // c - half + line, bukan c - half. Selisih setipis itu yang menyelamatkan
  // garis tepi di sisi persimpangan yang tidak punya lengan: kalau inner
  // mundur sejauh outer, garis tepi itu ikut tertimpa aspal dan pertigaan
  // kehilangan garis lurusnya.
  const near = -line;
  const far = t + line;
  for (const d of ROAD_ARMS[kind]) {
    if (d === 'E') {
      outer.push({ x: c - half, y: c - half, w: far - (c - half), h: 2 * half });
      inner.push({
        x: c - half + line,
        y: c - half + line,
        w: far - (c - half + line),
        h: 2 * (half - line),
      });
    } else if (d === 'W') {
      outer.push({ x: near, y: c - half, w: c + half - near, h: 2 * half });
      inner.push({
        x: near,
        y: c - half + line,
        w: c + half - line - near,
        h: 2 * (half - line),
      });
    } else if (d === 'N') {
      outer.push({ x: c - half, y: near, w: 2 * half, h: c + half - near });
      inner.push({
        x: c - half + line,
        y: near,
        w: 2 * (half - line),
        h: c + half - line - near,
      });
    } else {
      outer.push({ x: c - half, y: c - half, w: 2 * half, h: far - (c - half) });
      inner.push({
        x: c - half + line,
        y: c - half + line,
        w: 2 * (half - line),
        h: far - (c - half + line),
      });
    }
  }

  const junction: RoadRect | null =
    kind === 'straight'
      ? null
      : {
          x: c - half + line,
          y: c - half + line,
          w: 2 * (half - line),
          h: 2 * (half - line),
        };

  return { outer, inner, junction, line };
}

/**
 * Batas umur kontainer di lapangan sebelum dianggap lewat batas, hari.
 *
 * Dipakai penanda peringatan di lapangan DAN kueri KPI di server, dari satu
 * angka — kalau keduanya punya angkanya sendiri, panel akan menghitung jumlah
 * yang berbeda dari yang ditandai di lapangan.
 */
export const DWELL_ALERT_DAYS = 30;

export const RTG_CLEARANCE = 3.8;

/** Skala sumbu Z geometri RTG supaya portalnya menaungi blok selebar `width`. */
export const rtgSpanScale = (width: number) => (width / 2 + RTG_CLEARANCE) / RTG_RAIL_Z;

/**
 * Ukuran aset RTG (public/models/rtg_crane.glb), DIUKUR dari berkasnya sendiri.
 *
 * Dua hal yang tidak bisa ditebak dan harus datang dari pengukuran:
 *
 * 1. Gauge-nya 15,20 m — jauh lebih sempit daripada portal prosedural yang
 *    relnya 25 m. Dipakai apa adanya, aset ini berdiri DI DALAM blok alih-alih
 *    menaunginya.
 * 2. Titik nolnya ada di SUDUT model, bukan di sumbu portal: badannya
 *    membentang Z -17,54..0 dan X -0,02..9,44. Ditaruh apa adanya, cranenya
 *    berdiri sembilan meter di samping titik yang diklik — dan kotak uji-kliknya
 *    pun tidak menempel pada badannya.
 *
 * Angkanya diukur dari titik terbawah model: dua kelompok roda selebar 0,97 m
 * berpusat di Z -17,05 dan -1,85.
 */
export const RTG_ASSET = {
  /** Setengah jarak rel ke rel. */
  railZ: 7.601,
  /** Titik tengah antar rel pada sumbu Z model. */
  midZ: -9.449,
  /** Titik tengah bodi pada sumbu X model. */
  midX: 4.713,
  /** Tinggi model apa adanya. */
  height: 16.7,
  /** Panjang bodi searah jalur (X) dan bentang penuh (Z), apa adanya. */
  bodyX: 9.46,
  spanZ: 17.54,
} as const;

/**
 * Skala SERAGAM aset RTG supaya relnya jatuh di tempat yang sama dengan rel RTG
 * prosedural pada blok selebar `width`.
 *
 * Seragam, bukan hanya sumbu Z. Portal prosedural memang dibangun dari kotak
 * dan dirancang untuk diregangkan; aset ini tidak — meregangkan Z-nya 1,6 kali
 * akan menggepengkan kaki dan rodanya. Karena skalanya seragam, tingginya ikut
 * naik mengikuti perbandingan aslinya.
 */
export const rtgAssetScale = (width: number) =>
  (width / 2 + RTG_CLEARANCE) / RTG_ASSET.railZ;

/** Rel RTG blok ini, relatif terhadap tepi blok. */
export const LANE_RAIL_NEAR = RTG.offsetZ + RTG_CLEARANCE;
/**
 * Rel RTG blok berikutnya, relatif terhadap tepi blok yang sama.
 *
 * TIDAK digambar di tekstur lorong: rel itu milik blok di seberang, dan blok
 * itu menggambar strip lorongnya sendiri. Angkanya dipertahankan karena ia yang
 * menjelaskan dari mana lebar lorong berasal.
 */
export const LANE_RAIL_FAR = YARD.gapZ - (RTG_CLEARANCE - RTG.offsetZ);

export const YARD_EXTENT_X =
  YARD.blockCols * BLOCK_LENGTH + (YARD.blockCols - 1) * YARD.gapX;
export const YARD_EXTENT_Z =
  YARD.blockRows * BLOCK_WIDTH + (YARD.blockRows - 1) * YARD.gapZ;

/** Margin aspal di sekeliling grid blok */
export const APRON = 60;

/** Shipping line yang muncul di lapangan, beserta bobot kemunculannya. */
export const LINES = [
  { code: 'MSC', name: 'Mediterranean Shipping Co', prefix: 'MSCU', weight: 16 },
  { code: 'MAERSK', name: 'Maersk Line', prefix: 'MRKU', weight: 15 },
  { code: 'CMACGM', name: 'CMA CGM', prefix: 'CMAU', weight: 11 },
  { code: 'EVERGREEN', name: 'Evergreen Line', prefix: 'EGHU', weight: 10 },
  { code: 'ONE', name: 'Ocean Network Express', prefix: 'ONEU', weight: 9 },
  { code: 'COSCO', name: 'COSCO Shipping', prefix: 'CSNU', weight: 9 },
  { code: 'HAPAG', name: 'Hapag-Lloyd', prefix: 'HLXU', weight: 7 },
  { code: 'OOCL', name: 'OOCL', prefix: 'OOLU', weight: 6 },
  { code: 'SPIL', name: 'Salam Pacific Indonesia Lines', prefix: 'SPNU', weight: 9 },
  { code: 'TEMAS', name: 'Temas Line', prefix: 'TMSU', weight: 8 },
] as const;

export const VESSELS = [
  'MV BINTANG SAMUDERA',
  'MV NUSANTARA PERSADA',
  'MSC ANNA',
  'EVER GIVEN',
  'ONE COLUMBA',
  'CMA CGM MARCO POLO',
  'MERATUS TOMINI',
  'TANTO EXPRESS',
] as const;

/** Kamera awal — pandangan miring dari sudut lapangan. */
export const CAMERA = {
  position: [YARD_EXTENT_X * 0.56, 640, YARD_EXTENT_X * 0.84] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
  fov: 45,
  near: 1,
  far: 6000,
} as const;
