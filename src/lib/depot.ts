import oracledb from 'oracledb';
import { PITCH, YARD } from './constants';
import { blockedCount } from './slots';
import type {
  BlockedCell,
  ContainerSize,
  ContainerStatus,
  ContainerType,
  BlockSide,
  YardBlock,
  YardContainer,
  YardData,
  YardLine,
} from './types';

/**
 * Sumber data sungguhan: database depot (Oracle 19c).
 *
 * Dua tabel yang dipakai:
 *   CORE_YARD_BLOCK  daftar blok: ukuran resmi, nama, dan posisinya di peta
 *                 lapangan (X/Y).
 *   YARD_ROWTIER  posisi slot — blok / slot / row / tier, dan kontainer apa
 *                 yang sedang menempatinya.
 *   CONTAINER     detail kontainer, disambung lewat CTR_KEY.
 *
 * Yang perlu diketahui tentang isi database ini — diverifikasi di lingkungan
 * dev maupun demo, bukan asumsi:
 *   - Join lewat CTR_KEY bisa tidak lengkap: sebagian slot menyebut kontainer
 *     yang barisnya sudah tidak ada. Join-nya inner, jadi slot itu dilewati.
 *   - CTR_OPR kosong di kedua lingkungan; yang terisi 100% adalah AGENT — itu
 *     yang dipakai sebagai shipping line.
 *   - GROSS kosong seluruhnya. TARE dipakai sebagai gantinya, tapi TARE pun
 *     sering kosong (118 dari 778 di demo), jadi berat 0 berarti TIDAK
 *     DIKETAHUI, bukan nol kilogram — HUD menampilkannya sebagai "—".
 *   - IS_REEFER, DG, dan IMO_CD kosong. Status reefer diambil dari digit
 *     ketiga ISO_CODE (22R2, 42R2) yang memang penanda reefer.
 *   - YARD_SLOT SELALU ganjil: 1, 3, 5, ..., 2n-1. Nol baris bernomor genap.
 *     Itu konvensi bay ISO — nomor genap disediakan untuk posisi 40ft yang
 *     membentang di antara dua yang ganjil. Posisi slotnya sendiri berurutan
 *     dan selebar 20ft, jadi bay = (slot-1)/2 dan jumlah posisinya persis
 *     CORE_YARD_BLOCK.YARD_SLOT.
 *   - SATU KONTAINER 40ft PUNYA DUA BARIS di YARD_ROWTIER, satu per slot yang
 *     ditempatinya. Terukur: 478 kontainer berbaris tunggal (20ft) dan 231
 *     berbaris ganda (40ft) — 478 + 231x2 = 940 baris. Tanpa dedup, tiap 40ft
 *     akan digambar dua kali di dua tempat. Kueri di bawah mengambil baris
 *     ber-slot terkecil saja untuk tiap CTR_KEY.
 */

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

const LOGGING = process.env.DEPOT_DB_LOGGING === 'true';

/**
 * Pool disimpan di globalThis, bukan di module scope.
 *
 * Next.js dev me-reload modul tiap kali file berubah. Kalau pool-nya hidup di
 * module scope, tiap reload membuka pool baru dan yang lama tidak pernah
 * ditutup — beberapa kali simpan file saja sudah cukup untuk menghabiskan
 * sesi yang diizinkan server.
 */
const globalForPool = globalThis as unknown as { depotPool?: Promise<oracledb.Pool> };

function pool(): Promise<oracledb.Pool> {
  if (!globalForPool.depotPool) {
    const user = process.env.DEPOT_DB_USER;
    const password = process.env.DEPOT_DB_PASS;
    const connectString = process.env.DEPOT_DB_CONNECT_STRING;
    if (!user || !password || !connectString) {
      return Promise.reject(
        new Error(
          'Kredensial database belum lengkap. Isi DEPOT_DB_USER, DEPOT_DB_PASS, ' +
            'dan DEPOT_DB_CONNECT_STRING di .env.local',
        ),
      );
    }
    globalForPool.depotPool = oracledb.createPool({
      user,
      password,
      connectString,
      poolMin: 0,
      poolMax: 4,
      poolTimeout: 60,
    });
  }
  return globalForPool.depotPool!;
}

/**
 * Meminjam satu koneksi dari pool yang sama dengan yang dipakai membaca.
 *
 * Diekspor supaya lapisan tulis (depotWrite.ts) tidak membuka pool keduanya
 * sendiri — dua pool ke server yang sama akan menghabiskan jatah sesi persis
 * seperti masalah reload yang sudah dijelaskan di atas.
 */
export async function borrowConnection() {
  return (await pool()).getConnection();
}

export const depotLogging = () => LOGGING;

async function query<T>(label: string, sql: string): Promise<T[]> {
  const started = Date.now();
  const connection = await (await pool()).getConnection();
  try {
    const result = await connection.execute<T>(sql);
    if (LOGGING) {
      console.log(`[depot] ${label}: ${result.rows?.length ?? 0} baris, ${Date.now() - started} ms`);
    }
    return result.rows ?? [];
  } finally {
    await connection.close();
  }
}

// --- pemetaan kolom ---------------------------------------------------------

/** ISO tank hanya CTR_TYPE 'TK'; sisanya digambar sebagai box biasa. */
/** Kolomnya CHAR(1) tanpa constraint, jadi apa pun selain R dianggap L. */
const side = (v: string | null): BlockSide => (v?.trim().toUpperCase() === 'R' ? 'R' : 'L');

const typeOf = (ctrType: string | null): ContainerType =>
  ctrType?.trim().toUpperCase() === 'TK' ? 'tank' : 'gp';

/**
 * Lapangan ini hanya mengenal 20ft dan 40ft. Yang 45ft digambar sebagai 40ft —
 * selisih 0,9 m, jauh lebih kecil daripada menaruhnya di slot yang salah.
 */
const sizeOf = (ctrSize: number | null): ContainerSize => (Number(ctrSize) >= 40 ? 40 : 20);

/** Kode CTR_TYPE untuk kontainer berpendingin. */
const REEFER_TYPES = new Set(['RE', 'RF', 'RH', 'RT']);

/**
 * Reefer dikenali dari DUA sumber, dan itu perlu.
 *
 * Semula hanya digit ketiga ISO 6346 (R = reefer, mis. 22R2). Di database
 * produksi cara itu cuma menangkap 27 dari 238 reefer — sisanya ber-ISO_CODE
 * gaya lain seperti "40HC" tapi CTR_TYPE-nya jelas RH atau RF. CTR_TYPE jauh
 * lebih dapat diandalkan di sini; digit ISO dipertahankan sebagai cadangan
 * untuk baris yang CTR_TYPE-nya kosong.
 */
const isReefer = (row: DepotRow) =>
  REEFER_TYPES.has(row.CTR_TYPE?.trim().toUpperCase() ?? '') ||
  row.ISO_CODE?.charAt(2)?.toUpperCase() === 'R';

/**
 * Urutan pemeriksaan menentukan hasilnya: satu kontainer bisa sekaligus rusak
 * DAN reefer, dan yang lebih penting untuk operasional yang menang.
 */
const isDangerous = (row: DepotRow) =>
  row.DG === 'Y' || (row.IMO_CD !== null && row.IMO_CD.trim() !== '');

function statusOf(row: DepotRow): ContainerStatus {
  if (isDangerous(row)) return 'dangerous';
  if (row.IS_DAMAGE === 'Y') return 'damaged';
  if (isReefer(row)) return 'reefer';
  return row.CTR_STATUS?.trim().toUpperCase() === 'F' ? 'full' : 'empty';
}

/**
 * Tanggal saja dari sebuah Date, dibaca pada zona waktu SERVER.
 *
 * Bukan toISOString().slice(0, 10). Cara itu mengonversi ke UTC lebih dulu, dan
 * di WIB (UTC+7) setiap jam masuk sebelum pukul 07:00 mundur satu hari.
 * Terukur di database ini: 9 kontainer masuk sebelum jam 7 pagi, dan yang
 * tercatat 23-04-2026 00:31 tampil sebagai 22-04-2026.
 *
 * RECEIV_DATE datang dari Oracle sebagai DATE tanpa zona waktu — angka yang
 * ditulis operator apa adanya — jadi yang benar adalah membacanya apa adanya
 * juga.
 */
const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Satu baris hasil CONTAINER_SQL menjadi YardContainer.
 *
 * Dipakai dua kali: saat memuat seluruh lapangan, dan saat aliran langsung
 * bertanya tentang SATU kontainer yang baru ditangani. Kalau pemetaannya
 * ditulis dua kali, cepat atau lambat keduanya berselisih — dan selisihnya
 * baru terlihat sebagai kontainer yang berubah rupa setelah halaman dimuat ulang.
 */
function toContainer(r: DepotRow, blockId: string): YardContainer {
  return {
    no: r.CTR_NO?.trim() || '(tanpa nomor)',
    size: sizeOf(r.CTR_SIZE),
    type: typeOf(r.CTR_TYPE),
    status: statusOf(r),
    line: r.AGENT?.trim() || 'LAIN',
    block: blockId,
    // Slot ganjil 1, 3, 5, … -> indeks posisi 0, 1, 2, … Sebuah 40ft
    // membentang dari sini ke posisi berikutnya, sesuai dua barisnya di
    // YARD_ROWTIER.
    bay: Math.max(0, (Number(r.YARD_SLOT) - 1) / 2),
    row: Math.max(0, Number(r.YARD_ROW) - 1),
    tier: Math.max(1, Number(r.YARD_TIER)),
    weightKg: weightOf(r),
    vessel: r.VESSEL_NAME?.trim() || '—',
    inDate: isoDate(r.RECEIV_DATE ?? new Date()),
    filled: r.CTR_STATUS?.trim().toUpperCase() === 'F',
    damaged: r.IS_DAMAGE?.trim().toUpperCase() === 'Y',
    typeCode: r.CTR_TYPE?.trim().toUpperCase() || '',
    isoCode: r.ISO_CODE?.trim().toUpperCase() || '',
    reefer: isReefer(r),
    dangerous: isDangerous(r),
  };
}

const weightOf = (row: DepotRow): number => {
  if (row.GROSS !== null) return Math.round(Number(row.GROSS));
  const tare = Number(row.TARE);
  return Number.isFinite(tare) ? Math.round(tare) : 0;
};

type DepotRow = {
  YARD_BLOCK: string;
  YARD_SLOT: number;
  YARD_ROW: number;
  YARD_TIER: number;
  SLOT_ROWS: number;
  CTR_NO: string | null;
  CTR_SIZE: number | null;
  CTR_TYPE: string | null;
  CTR_STATUS: string | null;
  AGENT: string | null;
  ISO_CODE: string | null;
  IS_DAMAGE: string | null;
  DG: string | null;
  IMO_CD: string | null;
  GROSS: number | null;
  TARE: string | null;
  VESSEL_NAME: string | null;
  RECEIV_DATE: Date | null;
  RN: number;
};

type BlockRow = {
  YARD_BLOCK: string;
  BLOCK_NAME: string | null;
  SLOTS: number;
  ROWS_: number;
  TIERS: number;
  MAP_X: number | null;
  MAP_Y: number | null;
  ROT_DEG: number | null;
  TRUCK_LANE: string | null;
  SLOT_START: string | null;
};

// --- kueri ------------------------------------------------------------------

/**
 * Daftar blok diambil dari CORE_YARD_BLOCK, bukan dari MAX() atas
 * YARD_ROWTIER. Itu daftar resminya: blok yang sedang kosong tetap ada, dan
 * ukurannya tidak menyusut mengikuti isinya.
 *
 * Hanya blok fisik (PHYS_VIRTUAL = 'P') yang punya tempat di lapangan.
 */
const BLOCK_SQL = `
  SELECT TRIM(yard_block)                         AS yard_block,
         TRIM(NVL(yard_block_name, yard_block))   AS block_name,
         TO_NUMBER(TRIM(yard_slot))               AS slots,
         TO_NUMBER(TRIM(yard_row))                AS rows_,
         TO_NUMBER(TRIM(yard_tier))               AS tiers,
         x                                        AS map_x,
         y                                        AS map_y,
         NVL(rot_deg, 0)                          AS rot_deg,
         TRIM(NVL(truck_lane, 'L'))              AS truck_lane,
         TRIM(NVL(slot_start, 'L'))              AS slot_start
    FROM core_yard_block
   WHERE NVL(phys_virtual, 'P') = 'P'
   ORDER BY y, x`;

const CONTAINER_SQL = `
  SELECT * FROM (
  SELECT TRIM(y.yard_block)                  AS yard_block,
         TO_NUMBER(TRIM(y.yard_slot))        AS yard_slot,
         TO_NUMBER(TRIM(y.yard_row))         AS yard_row,
         TO_NUMBER(TRIM(y.yard_tier))        AS yard_tier,
         TRIM(NVL(k.ctr_no, y.container_number)) AS ctr_no,
         k.ctr_size                          AS ctr_size,
         TRIM(k.ctr_type)                    AS ctr_type,
         TRIM(k.ctr_status)                  AS ctr_status,
         TRIM(k.agent)                       AS agent,
         k.iso_code                          AS iso_code,
         k.is_damage                         AS is_damage,
         k.dg                                AS dg,
         k.imo_cd                            AS imo_cd,
         k.gross                             AS gross,
         TRIM(k.tare)                        AS tare,
         TRIM(k.vessel_name)                 AS vessel_name,
         k.receiv_date                       AS receiv_date,
         -- Kontainer 40ft punya satu baris per slot yang ditempatinya; yang
         -- dipakai baris paling awal, karena itu pangkal bentangannya.
         ROW_NUMBER() OVER (
           PARTITION BY y.container_key
           ORDER BY TO_NUMBER(TRIM(y.yard_slot))
         ) AS rn,
         -- Berapa slot yang BENAR-BENAR tercatat atas nama kontainer ini.
         -- Di produksi 40ft punya dua; di dev hampir semuanya cuma satu.
         COUNT(*) OVER (PARTITION BY y.container_key) AS slot_rows
    FROM yard_rowtier y
    JOIN container k ON k.ctr_key = y.container_key
  ) WHERE rn = 1
    ORDER BY yard_block, yard_slot, yard_row, yard_tier`;

// --- tata letak -------------------------------------------------------------

/**
 * Tata letak blok dari kolom X/Y CORE_YARD_BLOCK.
 *
 * Satuan X/Y tidak diketahui. Nilainya — A(124,127), B(121,283), C(127,567) —
 * terlalu renggang untuk meter: jarak A ke B 156 satuan sementara blok A cuma
 * 5 row (14,5 m), yang berarti lorong 140 meter. Kemungkinan besar itu
 * koordinat peta 2D di layar TOS-nya.
 *
 * Yang bisa dipercaya dari kolom itu adalah SUSUNAN RELATIFNYA: ketiga blok
 * berjajar pada sumbu Y, hampir sejajar pada X, semuanya horizontal. Jadi
 * skalanya diturunkan dari datanya sendiri — angka terkecil yang membuat
 * lorong TERSEMPIT selebar YARD.gapZ. Perbandingan jarak antar blok tetap apa
 * adanya: lorong B ke C memang lebih lebar daripada A ke B, dan itu informasi
 * dari database, bukan karangan.
 *
 * Kalau ternyata X/Y punya satuan yang pasti, yang perlu diubah cuma fungsi
 * ini: pakai skala tetap, bukan yang diturunkan.
 */
function layout(rows: BlockRow[]) {
  const sized = rows
    .map((r) => {
      // CORE_YARD_BLOCK.YARD_SLOT = jumlah posisi slot, masing-masing selebar
      // 20ft. Penomorannya yang ganjil, bukan posisinya yang berjarak.
      const slots = Number(r.SLOTS);
      const rowCount = Number(r.ROWS_);
      return {
        id: r.YARD_BLOCK?.trim() ?? '',
        tiers: Number(r.TIERS),
        slots,
        rowCount,
        length: slots * PITCH.teu,
        width: rowCount * PITCH.row,
        mapX: Number(r.MAP_X),
        mapY: Number(r.MAP_Y),
        rotDeg: Number(r.ROT_DEG) || 0,
        truckLane: side(r.TRUCK_LANE),
        slotStart: side(r.SLOT_START),
      };
    })
    .filter((b) => b.id && b.slots > 0 && b.rowCount > 0);

  sized.sort((a, b) => a.mapY - b.mapY || a.mapX - b.mapX);

  // Koordinat baru bisa dipakai kalau ada dan urutannya benar-benar menaik;
  // kalau tidak, blok ditumpuk berurutan seperti sebelumnya.
  const usable =
    sized.length > 1 &&
    sized.every((b) => Number.isFinite(b.mapX) && Number.isFinite(b.mapY)) &&
    sized.every((b, i) => i === 0 || b.mapY > sized[i - 1].mapY);

  // Skala PETA -> METER.
  //
  // Dulu selalu diturunkan dari jarak antar blok: angka terkecil yang membuat
  // lorong tersempit selebar YARD.gapZ. Itu memadai selama lapangan hanya
  // dibaca. Begitu blok bisa digeser dan disimpan, skala turunan jadi
  // berbahaya — menggeser satu blok mendekat MENGUBAH skalanya, dan seluruh
  // lapangan ikut memuai atau menyusut. Simpan lalu muat tidak akan pernah
  // kembali ke tempat yang sama.
  //
  // Karena itu skala bisa dipaku lewat DEPOT_MAP_SCALE. Kalau tidak diisi,
  // skala tetap diturunkan seperti dulu dan lapangan tampil benar, tapi
  // menyimpan posisi ditolak: hasilnya tidak akan bulat kembali.
  const pinned = Number(process.env.DEPOT_MAP_SCALE);
  const fixedScale = Number.isFinite(pinned) && pinned > 0;

  let scale = fixedScale ? pinned : 0;
  if (!fixedScale && usable) {
    for (let i = 0; i < sized.length - 1; i++) {
      scale = Math.max(scale, (sized[i].width + YARD.gapZ) / (sized[i + 1].mapY - sized[i].mapY));
    }
  }
  const mapped = (usable || fixedScale) && scale > 0;

  let cursor = 0;
  const blocks: YardBlock[] = sized.map((b) => {
    const originZ = mapped ? b.mapY * scale : cursor;
    const originX = mapped ? b.mapX * scale - b.length / 2 : -b.length / 2;
    cursor += b.width + YARD.gapZ;
    return {
      id: b.id,
      originX,
      originZ,
      slots: b.slots,
      // Nomor slot naik 2 tiap posisi: 1, 3, 5, … Hanya soal penomoran;
      // posisinya sendiri berurutan dan selebar 20ft.
      slotStep: 2,
      rows: b.rowCount,
      tiers: b.tiers,
      // Sudut disimpan dalam DERAJAT di database (kolom ROT_DEG) tapi dipakai
      // dalam RADIAN di seluruh kode 3D. Konversinya cuma di sini.
      rot: (b.rotDeg * Math.PI) / 180,
      truckLane: b.truckLane,
      slotStart: b.slotStart,
      containers: [],
    };
  });

  // Luas lapangan diukur dari kotak nyata blok-bloknya, bukan dari konstanta
  // grid demo.
  const minX = Math.min(...blocks.map((b) => b.originX));
  const maxX = Math.max(...blocks.map((b, i) => b.originX + sized[i].length));
  const minZ = Math.min(...blocks.map((b) => b.originZ));
  const maxZ = Math.max(...blocks.map((b, i) => b.originZ + sized[i].width));

  // Lapangan TIDAK digeser ke origin.
  //
  // Dulu digeser, dan itu benar selama lapangan cuma dibaca. Tapi pergeserannya
  // dihitung dari batas semua blok, jadi menambah atau memindahkan satu blok
  // mengubahnya — dan seluruh lapangan ikut bergeser. Terukur saat diuji:
  // menambah satu blok di sisi selatan memindahkan ketiga blok lain 18,8 m,
  // sehingga blok yang baru saja dijatuhkan muncul di tempat yang berbeda dari
  // yang diklik.
  //
  // Sekarang koordinat dunia = koordinat peta x skala, titik. Absolut, dan
  // simpan-lalu-muat selalu kembali ke tempat yang sama. Yang menyesuaikan diri
  // adalah kamera, aspal, dan grid editor — semuanya memakai center di bawah.
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  if (LOGGING) {
    const cara = mapped
      ? `X/Y CORE_YARD_BLOCK, skala ${scale.toFixed(6)} (${fixedScale ? 'dipaku DEPOT_MAP_SCALE' : 'turunan — posisi tidak bisa disimpan'})`
      : 'berurutan (X/Y tidak terpakai)';
    console.log(`[depot] tata letak: ${cara}`);
  }

  // Transform yang SAMA dipakai untuk membalik arah saat menyimpan posisi,
  // jadi apa yang terlihat persis itu yang tersimpan. Sekarang isinya cuma
  // skala: sejak lapangan tidak lagi digeser ke origin, tidak ada offset yang
  // perlu dibawa-bawa.
  const transform = mapped && fixedScale ? { scale } : null;

  return {
    blocks,
    extentX: maxX - minX,
    extentZ: maxZ - minZ,
    centerX,
    centerZ,
    transform,
  };
}

/**
 * Membuang kontainer yang jejaknya bertindihan dengan kontainer lain pada row
 * dan tier yang sama.
 *
 * Perlu karena konvensi datanya berbeda antar lingkungan. Di produksi satu 40ft
 * punya DUA baris YARD_ROWTIER dan slot sebelahnya tidak pernah dipakai orang
 * lain. Di dev, 67 dari 70 unit 40ft cuma punya satu baris, dan 15 di antaranya
 * slot sebelahnya ditempati kontainer LAIN — dua benda di satu tempat, yang
 * secara fisik mustahil.
 *
 * Yang menang adalah KLAIM YANG TERCATAT, bukan yang kebetulan lebih dulu.
 * Sebuah 40ft dengan dua baris YARD_ROWTIER memang memesan dua slot; yang cuma
 * punya satu baris hanya memesan satu, dan slot keduanya sekadar simpulan dari
 * panjangnya. Jadi kalau slot itu sudah dipesan kontainer lain, yang mengalah
 * adalah si 40ft.
 *
 * Aturan urutan-slot yang lebih naif sempat dipakai dan ternyata sistematis
 * menjatuhkan yang 20ft — di dev itu berarti SELURUH reefer hilang dari layar.
 *
 * Yang dibuang DIHITUNG dan ditampilkan, bukan dihilangkan diam-diam: lapangan
 * yang menggambar dua kontainer saling menembus lebih menyesatkan daripada
 * lapangan yang mengaku ada yang bentrok.
 */
function dropOverlaps(blocks: YardBlock[], slotRows: Map<YardContainer, number>): number {
  let dropped = 0;
  /** Slot yang benar-benar tercatat atas nama kontainer ini. */
  const firmBays = (c: YardContainer) =>
    c.size === 40 && (slotRows.get(c) ?? 1) >= 2 ? [c.bay, c.bay + 1] : [c.bay];

  for (const block of blocks) {
    // Kelompokkan per (row, tier); sebuah 40ft memakai bay dan bay + 1.
    const lanes = new Map<string, YardContainer[]>();
    for (const c of block.containers) {
      const key = c.row + ':' + c.tier;
      const lane = lanes.get(key);
      if (lane) lane.push(c);
      else lanes.set(key, [c]);
    }

    const kept: YardContainer[] = [];
    for (const lane of lanes.values()) {
      lane.sort((a, b) => a.bay - b.bay);

      // Babak 1 — klaim yang tercatat. Bentrok di sini benar-benar mustahil
      // secara fisik, dan yang datang belakangan yang gugur.
      const owner = new Map<number, YardContainer>();
      const standing: YardContainer[] = [];
      for (const c of lane) {
        const bays = firmBays(c);
        if (bays.some((b) => owner.has(b))) {
          dropped++;
          continue;
        }
        for (const b of bays) owner.set(b, c);
        standing.push(c);
      }

      // Babak 2 — bentangan yang cuma disimpulkan. Sebuah 40ft berbaris tunggal
      // butuh slot berikutnya untuk bisa digambar utuh; kalau sudah ada yang
      // punya, ia yang dibuang.
      for (const c of standing) {
        if (c.size === 40 && (slotRows.get(c) ?? 1) < 2) {
          const holder = owner.get(c.bay + 1);
          if (holder && holder !== c) {
            dropped++;
            continue;
          }
          owner.set(c.bay + 1, c);
        }
        kept.push(c);
      }
    }
    block.containers = kept;
  }
  return dropped;
}

/** Nomor yang dipakai lebih dari satu kontainer — masalah data, bukan gambar. */
function countDuplicateNumbers(blocks: readonly YardBlock[]): number {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const b of blocks) {
    for (const c of b.containers) {
      if (seen.has(c.no)) dup.add(c.no);
      seen.add(c.no);
    }
  }
  return dup.size;
}

// --- publik -----------------------------------------------------------------

/** Semua sel yang PUNYA baris di YARD_ROWTIER — kosong maupun berisi. */
const CELL_SQL = `
  SELECT TRIM(yard_block)              AS yard_block,
         TO_NUMBER(TRIM(yard_slot))    AS yard_slot,
         TO_NUMBER(TRIM(yard_row))     AS yard_row,
         TO_NUMBER(TRIM(yard_tier))    AS yard_tier
    FROM yard_rowtier`;

type CellRow = { YARD_BLOCK: string; YARD_SLOT: number; YARD_ROW: number; YARD_TIER: number };

/**
 * Slot terkunci = sel di dalam ukuran blok yang barisnya TIDAK ADA di
 * YARD_ROWTIER (lihat lockSlot di depotWrite.ts).
 *
 * Per kolom (slot, row), dasar kuncinya adalah tier terendah yang dari situ
 * sampai tier teratas semuanya tidak punya baris. Lubang di tengah kolom yang
 * di atasnya masih ada baris tidak dihitung kunci — tumpukan memang tidak bisa
 * melompatinya, tapi itu data yang rusak, bukan kunci yang disengaja.
 *
 * Blok yang sama sekali tidak punya baris dilewati: itu bukan "seluruhnya
 * terkunci", melainkan blok yang inventaris slotnya belum pernah dibuat.
 */
function lockedFromRowtier(blocks: YardBlock[], cells: CellRow[]) {
  const have = new Map<string, Set<string>>();
  for (const c of cells) {
    const id = c.YARD_BLOCK?.trim();
    if (!id) continue;
    let s = have.get(id);
    if (!s) have.set(id, (s = new Set()));
    s.add(`${Number(c.YARD_SLOT)}:${Number(c.YARD_ROW)}:${Number(c.YARD_TIER)}`);
  }
  for (const b of blocks) {
    const s = have.get(b.id);
    if (!s || s.size === 0) continue;
    const out: BlockedCell[] = [];
    for (let bay = 0; bay < b.slots; bay++) {
      const slot = bay * 2 + 1;
      for (let row = 1; row <= b.rows; row++) {
        let base = b.tiers + 1;
        while (base > 1 && !s.has(`${slot}:${row}:${base - 1}`)) base--;
        if (base <= b.tiers) out.push({ bay, row: row - 1, tier: base });
      }
    }
    b.blocked = out;
  }
}

export async function fetchDepotYard(): Promise<YardData> {
  const started = Date.now();
  const [blockRows, rows, cells] = await Promise.all([
    query<BlockRow>('daftar blok', BLOCK_SQL),
    query<DepotRow>('kontainer di slot', CONTAINER_SQL),
    query<CellRow>('sel slot', CELL_SQL),
  ]);

  const { blocks, extentX, extentZ, centerX, centerZ, transform } = layout(blockRows);
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const lines = new Map<string, YardLine>();

  const slotRows = new Map<YardContainer, number>();
  let totalTeu = 0;
  let skipped = 0;

  for (const r of rows) {
    const block = byId.get(r.YARD_BLOCK?.trim());
    // Slot yang bloknya tidak terdaftar tidak punya tempat di lapangan.
    if (!block) {
      skipped++;
      continue;
    }
    const container = toContainer(r, block.id);
    const { size, line } = container;
    if (!lines.has(line)) lines.set(line, { code: line, name: line });
    slotRows.set(container, Number(r.SLOT_ROWS) || 1);
    block.containers.push(container);
    totalTeu += size === 40 ? 2 : 1;
  }

  const conflicts = dropOverlaps(blocks, slotRows);
  const duplicateNumbers = countDuplicateNumbers(blocks);

  // TEU dihitung ULANG setelah pembuangan: okupansi harus mencerminkan apa yang
  // benar-benar berdiri di lapangan, bukan jumlah baris di database.
  totalTeu = blocks.reduce(
    (n, b) => n + b.containers.reduce((m, c) => m + (c.size === 40 ? 2 : 1), 0),
    0,
  );

  lockedFromRowtier(blocks, cells);

  const totalContainers = blocks.reduce((n, b) => n + b.containers.length, 0);
  const capacityTeu = blocks.reduce(
    (n, b) => n + b.slots * b.rows * b.tiers - blockedCount(b.blocked, b),
    0,
  );

  if (LOGGING) {
    console.log(
      `[depot] ${totalContainers} kontainer di ${blocks.length} blok` +
        `${skipped ? `, ${skipped} dilewati (blok tidak dikenal)` : ''}, total ${Date.now() - started} ms`,
    );
  }

  return {
    blocks,
    meta: {
      generatedAt: new Date().toISOString(),
      fill: capacityTeu > 0 ? totalTeu / capacityTeu : 0,
      totalContainers,
      totalTeu,
      capacityTeu,
      extentX,
      extentZ,
      source: 'depot',
      mapTransform: transform,
      centerX,
      centerZ,
      conflicts,
      duplicateNumbers,
      lines: [...lines.values()].sort((a, b) => a.code.localeCompare(b.code)),
    },
  };
}

/** Ditutup saat proses berhenti supaya sesi di server tidak menggantung. */
export async function closeDepotPool() {
  const p = globalForPool.depotPool;
  if (!p) return;
  globalForPool.depotPool = undefined;
  (await p).close(0).catch(() => {});
}

// --- perjalanan truk (GATE_HIST) ---------------------------------------------

/**
 * Satu baris GATE_HIST = satu perjalanan truk, lengkap dengan tiga titik
 * waktunya: gate in, ditangani di lapangan, gate out.
 *
 * Dipakai pemutar ulang di HUD, dan kelak sebagai pemulih keadaan saat
 * aliran MQTT tersambung — perjalanan yang sudah gate in tapi belum gate out
 * harus sudah punya truk di lapangan sebelum pesan berikutnya datang.
 */
export type GateTrip = {
  jobNo: string;
  ctrNo: string;
  truckNo: string;
  /** R = bongkar masuk (receiving), D = ambil keluar (delivery). */
  flow: 'R' | 'D';
  gateInNo: number | null;
  gateOutNo: number | null;
  gateIn: string | null;
  /** Saat kontainer ditangani di lapangan — ditumpuk (R) atau diangkat ke truk (D). */
  handled: string | null;
  gateOut: string | null;
};

type GateRow = {
  JOB_NO: string | null;
  CTR_NO: string | null;
  TRUCK_NO: string | null;
  RECEIV_DELIV: string | null;
  GATI_NO: number | null;
  GATO_NO: number | null;
  GATI_DT: Date | null;
  STACK_ON_YARD: Date | null;
  STACK_ON_TRK: Date | null;
  GATO_DT: Date | null;
};

export async function readGateTrips(limit: number, openOnly = false): Promise<GateTrip[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit) || 20));
  // openOnly: perjalanan yang sudah gate in tapi belum gate out — truk yang
  // SEHARUSNYA sedang ada di lapangan saat peramban baru tersambung.
  const open = openOnly ? 'AND gato_dt IS NULL' : '';
  const rows = await query<GateRow>(
    'gate_hist',
    `SELECT * FROM (
       SELECT TRIM(job_no) AS job_no, TRIM(ctr_no) AS ctr_no, TRIM(truck_no) AS truck_no,
              TRIM(receiv_deliv) AS receiv_deliv, gati_no, gato_no,
              gati_dt, stack_on_yard, stack_on_trk, gato_dt
         FROM gate_hist
        WHERE gati_dt IS NOT NULL ${open}
        ORDER BY gati_dt DESC)
      WHERE ROWNUM <= ${n}`,
  );
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return rows.map((r) => ({
    jobNo: r.JOB_NO ?? '',
    ctrNo: r.CTR_NO ?? '',
    truckNo: r.TRUCK_NO ?? '',
    flow: r.RECEIV_DELIV?.toUpperCase() === 'D' ? 'D' : 'R',
    gateInNo: r.GATI_NO,
    gateOutNo: r.GATO_NO,
    gateIn: iso(r.GATI_DT),
    // Untuk delivery kolom yang terisi bisa STACK_ON_TRK — kontainer diangkat
    // ke atas truk, bukan ditumpuk.
    handled: iso(r.STACK_ON_YARD ?? r.STACK_ON_TRK),
    gateOut: iso(r.GATO_DT),
  }));
}

/**
 * Satu kontainer menurut nomornya, beserta posisinya sekarang — null kalau
 * tidak sedang menempati slot mana pun (sudah keluar, atau belum ditumpuk).
 *
 * Memakai CONTAINER_SQL yang sama dengan pemuat lapangan, jadi dedup baris
 * 40ft dan semua pemetaan kolomnya ikut tanpa ditulis ulang.
 */
export async function readContainer(no: string): Promise<YardContainer | null> {
  const clean = no.trim().toUpperCase();
  // Dimasukkan ke SQL sebagai literal, jadi bentuknya dibatasi ketat dulu.
  if (!/^[A-Z0-9]{1,20}$/.test(clean)) return null;
  const rows = await query<DepotRow>(
    'container ' + clean,
    `SELECT * FROM (${CONTAINER_SQL}) WHERE ctr_no = '${clean}'`,
  );
  const r = rows[0];
  return r ? toContainer(r, r.YARD_BLOCK?.trim() ?? '') : null;
}
