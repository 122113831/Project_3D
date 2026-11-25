import oracledb from 'oracledb';
import { borrowConnection, depotLogging } from './depot';
import type { BlockSide } from './types';

/** Kolomnya CHAR(1) tanpa constraint; apa pun selain R disimpan sebagai L. */
const side = (v: unknown): BlockSide =>
  String(v ?? '').trim().toUpperCase() === 'R' ? 'R' : 'L';

/**
 * Menulis tata letak lapangan ke database depot.
 *
 * Ini satu-satunya berkas di aplikasi yang menjalankan INSERT atau UPDATE.
 * Semua jalur lain hanya SELECT, dan sebaiknya tetap begitu — kalau nanti ada
 * yang perlu ditulis, tambahkan fungsinya di sini supaya seluruh penulisan
 * tetap bisa dibaca dalam satu tempat.
 *
 * Penulisan mengikuti koneksi yang sedang aktif di .env, bukan daftar host
 * yang ditanam di kode: kalau DEPOT_DB_CONNECT_STRING diarahkan ke produksi,
 * ke situlah tulisannya pergi. Saklarnya satu, DEPOT_DB_WRITE, dan default-nya
 * MATI — jadi memindahkan koneksi ke lingkungan lain tidak dengan sendirinya
 * ikut membuka izin menulis di sana.
 */

const enabled = () => process.env.DEPOT_DB_WRITE === 'true';

/** Siapa yang tercatat di CRT_BY / UPD_BY. */
const author = () => (process.env.DEPOT_DB_WRITE_USER || 'yard3d').slice(0, 100);

/** Tujuan penulisan, untuk ditampilkan sebelum pengguna menekan simpan. */
export function writeTarget() {
  return {
    enabled: enabled(),
    target: process.env.DEPOT_DB_CONNECT_STRING || '(not set)',
  };
}

export class WriteRefused extends Error {}

function assertEnabled() {
  if (!enabled()) {
    throw new WriteRefused(
      'Database writes are disabled. Set DEPOT_DB_WRITE=true in .env to enable them ' +
        `on the connection in use (${process.env.DEPOT_DB_CONNECT_STRING ?? '?'}).`,
    );
  }
}

// --- batas yang datang dari skema, bukan dari selera --------------------------
//
// YARD_SLOT CHAR(3) menampung nomor slot sampai 999, dan nomor slot tertinggi
// sebuah blok adalah 2n-1 — jadi 500 posisi. YARD_ROW dan YARD_TIER CHAR(2),
// jadi 99. Batas kapasitas totalnya sendiri buatan saya: satu blok berarti satu
// baris YARD_ROWTIER per slot per row per tier, dan 20.000 baris dalam satu
// klik terlalu mudah dibuat tanpa sengaja.
const MAX_SLOTS = 500;
const MAX_ROWS = 99;
const MAX_TIERS = 99;
const MAX_CELLS = 5000;

export type NewBlock = {
  code: string;
  name: string;
  slots: number;
  rows: number;
  tiers: number;
  mapX: number;
  mapY: number;
  rotDeg: number;
  truckLane: BlockSide;
  slotStart: BlockSide;
};

const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

/** Melempar pesan yang bisa langsung dibaca pengguna, bukan ORA-xxxxx. */
export function validateBlock(input: NewBlock) {
  const code = String(input.code ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(code)) {
    throw new WriteRefused('Block code must be 1–5 letters or digits, no spaces.');
  }
  const slots = int(input.slots);
  const rows = int(input.rows);
  const tiers = int(input.tiers);
  if (!(slots >= 1 && slots <= MAX_SLOTS)) {
    throw new WriteRefused(`Slot count must be 1–${MAX_SLOTS}.`);
  }
  if (!(rows >= 1 && rows <= MAX_ROWS)) {
    throw new WriteRefused(`Row count must be 1–${MAX_ROWS}.`);
  }
  if (!(tiers >= 1 && tiers <= MAX_TIERS)) {
    throw new WriteRefused(`Tier count must be 1–${MAX_TIERS}.`);
  }
  if (slots * rows * tiers > MAX_CELLS) {
    throw new WriteRefused(
      `Block ${slots}x${rows}x${tiers} = ${slots * rows * tiers} slots, over the limit of ${MAX_CELLS}. ` +
        'Each slot becomes one YARD_ROWTIER row.',
    );
  }
  const mapX = Number(input.mapX);
  const mapY = Number(input.mapY);
  if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
    throw new WriteRefused('Invalid block position.');
  }
  const rotDeg = Number.isFinite(Number(input.rotDeg)) ? Number(input.rotDeg) : 0;
  const name = (String(input.name ?? '').trim() || code).slice(0, 20);
  return {
    code,
    name,
    slots,
    rows,
    tiers,
    mapX,
    mapY,
    rotDeg,
    truckLane: side(input.truckLane),
    slotStart: side(input.slotStart),
  };
}

const BLOCK_INSERT = `
  INSERT INTO core_yard_block (
    id, site_id, yard_block, yard_block_name, yard_slot, yard_row, yard_tier,
    x, y, rot_deg, phys_virtual, horz_vert, truck_lane, slot_start,
    teus_ava, teus_used, crt_ts, crt_by, upd_ts, upd_by
  ) VALUES (
    TO_CHAR(SYSDATE,'YYMMDDMISS') || LPAD(seq_id.NEXTVAL, 10, '0'),
    :site, :code, :name, :slots, :rows_, :tiers,
    :mapX, :mapY, :rotDeg, 'P', 'H', :truckLane, :slotStart,
    :cap, 0, SYSDATE, :who, SYSDATE, :who
  )`;

/**
 * ID di YARD_ROWTIER mengikuti pola yang sudah ada di tabelnya: YYMMDD + menit
 * + detik + 10 digit dari SEQ_ID, unik per baris (2.765 baris, 2.765 ID unik).
 *
 * Dirakit di SQL, bukan di JavaScript: angkanya 20 digit, jauh di atas batas
 * presisi Number, dan merakitnya di sini akan diam-diam membulatkannya.
 */
// Tanpa CY_LOC: kolom itu tidak ada di CORE_YARD_BLOCK maupun YARD_ROWTIER
// database ini (diperiksa lewat USER_TAB_COLUMNS), dan menyebutnya membuat
// seluruh penyisipan gagal. PCH dibiarkan NULL seperti hampir semua baris yang
// sudah ada (970 dari 1.008 di blok D).
const SLOT_INSERT = `
  INSERT INTO yard_rowtier (
    id, site_id, yard_block, yard_slot, yard_row, yard_tier,
    status, container_key, container_number, update_time, pch
  ) VALUES (
    TO_NUMBER(TO_CHAR(SYSDATE,'YYMMDDMISS') || LPAD(seq_id.NEXTVAL, 10, '0')),
    :site, :code, :slot, :row_, :tier, :st, NULL, NULL, SYSDATE, :pch
  )`;

const SLOT_BIND_DEFS = {
  site: { type: oracledb.STRING, maxSize: 20 },
  code: { type: oracledb.STRING, maxSize: 5 },
  slot: { type: oracledb.STRING, maxSize: 3 },
  row_: { type: oracledb.STRING, maxSize: 2 },
  tier: { type: oracledb.STRING, maxSize: 2 },
  st: { type: oracledb.STRING, maxSize: 3 },
  pch: { type: oracledb.STRING, maxSize: 1 },
};

/** SITE_ID diambil dari blok yang sudah ada, bukan ditanam di kode. */
async function siteOf(c: oracledb.Connection) {
  const r = await c.execute<{ SITE_ID: string | null }>(
    `SELECT site_id FROM core_yard_block WHERE ROWNUM = 1`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return { site: r.rows?.[0]?.SITE_ID ?? null };
}

type RowTemplate = { SITE_ID: string | null; STATUS: string | null; PCH: string | null };

/**
 * Nilai kolom pendamping untuk baris slot baru, disalin dari baris yang sudah
 * ada — di blok yang sama kalau ada, kalau tidak dari blok mana pun. Baris yang
 * dikarang nilainya akan tampak sah tapi berbeda dari tetangganya.
 */
async function templateOf(c: oracledb.Connection, code: string): Promise<RowTemplate | null> {
  const pick = async (sql: string, binds: oracledb.BindParameters) =>
    (await c.execute<RowTemplate>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows?.[0] ?? null;
  return (
    (await pick(
      `SELECT site_id, status, pch FROM yard_rowtier WHERE TRIM(yard_block) = :code AND ROWNUM = 1`,
      { code },
    )) ?? (await pick(`SELECT site_id, status, pch FROM yard_rowtier WHERE ROWNUM = 1`, {}))
  );
}

/** Sel yang sudah punya baris di satu blok, sebagai kunci "slot:row:tier". */
async function existingCells(c: oracledb.Connection, code: string) {
  const r = await c.execute<{ S: number; R: number; T: number }>(
    `SELECT TO_NUMBER(TRIM(yard_slot)) AS s, TO_NUMBER(TRIM(yard_row)) AS r,
            TO_NUMBER(TRIM(yard_tier)) AS t
       FROM yard_rowtier WHERE TRIM(yard_block) = :code`,
    { code },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  return new Set(r.rows?.map((x) => `${x.S}:${x.R}:${x.T}`) ?? []);
}

/** Menyisipkan baris slot; `cells` berisi {slot, row, tier} dalam bentuk tabel. */
async function insertCells(
  c: oracledb.Connection,
  code: string,
  site: string | null,
  tpl: RowTemplate | null,
  cells: { slot: number; row: number; tier: number }[],
) {
  if (cells.length === 0) return 0;
  if (cells.length > MAX_CELLS) {
    throw new WriteRefused(`${cells.length} rows is too many for one write (limit ${MAX_CELLS}).`);
  }
  const rows: oracledb.BindParameters[] = cells.map((x) => ({
    site: tpl?.SITE_ID ?? site,
    code,
    slot: String(x.slot),
    row_: String(x.row),
    tier: String(x.tier),
    st: tpl ? (tpl.STATUS?.trim() ?? null) : 'DRY',
    pch: tpl ? (tpl.PCH?.trim() ?? null) : null,
  }));
  const res = await c.executeMany(SLOT_INSERT, rows, { bindDefs: SLOT_BIND_DEFS });
  if ((res.rowsAffected ?? 0) !== rows.length) {
    throw new Error(`Only ${res.rowsAffected} of ${rows.length} slot rows were inserted.`);
  }
  return rows.length;
}

export type CreateResult = { code: string; slotRows: number; ms: number };

/**
 * Membuat blok: satu baris CORE_YARD_BLOCK, plus satu baris YARD_ROWTIER untuk
 * SETIAP kombinasi slot x row x tier.
 *
 * Baris slot itu bukan pilihan gaya. Di database ini YARD_ROWTIER adalah
 * inventaris slot, bukan daftar isi: blok A, B, dan C punya persis 665, 1540,
 * dan 560 baris — sama dengan kapasitasnya — dan slot kosong tetap punya baris
 * dengan CONTAINER_KEY NULL. Blok tanpa baris slot akan tampil di TOS sebagai
 * blok yang tidak punya tempat menaruh apa pun.
 *
 * Semuanya dalam SATU transaksi: kalau penyisipan baris slot gagal di tengah
 * jalan, baris bloknya ikut dibatalkan, jadi tidak pernah ada blok setengah
 * jadi yang harus dibersihkan tangan.
 */
export async function createBlock(input: NewBlock): Promise<CreateResult> {
  assertEnabled();
  const b = validateBlock(input);
  const started = Date.now();
  const c = await borrowConnection();
  try {
    const dup = await c.execute<{ N: number }>(
      `SELECT COUNT(*) AS n FROM core_yard_block WHERE TRIM(UPPER(yard_block)) = :code`,
      { code: b.code },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    if ((dup.rows?.[0]?.N ?? 0) > 0) {
      throw new WriteRefused(`Block "${b.code}" already exists in CORE_YARD_BLOCK.`);
    }

    const { site } = await siteOf(c);
    const cap = b.slots * b.rows * b.tiers;

    await c.execute(BLOCK_INSERT, {
      site,
      code: b.code,
      name: b.name,
      slots: String(b.slots),
      rows_: String(b.rows),
      tiers: String(b.tiers),
      mapX: b.mapX,
      mapY: b.mapY,
      rotDeg: b.rotDeg,
      truckLane: b.truckLane,
      slotStart: b.slotStart,
      cap,
      who: author(),
    });

    // Nomor slot ganjil: 1, 3, 5, … 2n-1. Itu konvensi YARD_SLOT di database
    // ini — nol baris bernomor genap di ketiga blok yang sudah ada.
    const cells: { slot: number; row: number; tier: number }[] = [];
    for (let s = 0; s < b.slots; s++) {
      for (let r = 1; r <= b.rows; r++) {
        for (let t = 1; t <= b.tiers; t++) cells.push({ slot: s * 2 + 1, row: r, tier: t });
      }
    }
    const inserted = await insertCells(c, b.code, site, await templateOf(c, b.code), cells);

    await c.commit();
    const ms = Date.now() - started;
    if (depotLogging()) {
      console.log(`[depot] blok ${b.code} dibuat: ${inserted} baris slot, ${ms} ms`);
    }
    return { code: b.code, slotRows: inserted, ms };
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    await c.close();
  }
}

export type Placement = {
  code: string;
  mapX: number;
  mapY: number;
  rotDeg: number;
  truckLane: BlockSide;
  slotStart: BlockSide;
};

/** Menyimpan posisi dan sudut blok setelah digeser atau diputar. */
export async function updatePlacement(p: Placement): Promise<void> {
  assertEnabled();
  const code = String(p.code ?? '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(code)) throw new WriteRefused('Invalid block code.');
  if (!Number.isFinite(p.mapX) || !Number.isFinite(p.mapY)) {
    throw new WriteRefused('Invalid block position.');
  }
  // Sudut dinormalkan ke 0–360 supaya nilainya tidak merayap naik tiap kali
  // pengguna memutar blok ke arah yang sama berulang-ulang.
  const rotDeg = (((Number(p.rotDeg) || 0) % 360) + 360) % 360;

  const c = await borrowConnection();
  try {
    const r = await c.execute(
      `UPDATE core_yard_block
          SET x = :mapX, y = :mapY, rot_deg = :rotDeg,
              truck_lane = :truckLane, slot_start = :slotStart,
              upd_ts = SYSDATE, upd_by = :who
        WHERE TRIM(UPPER(yard_block)) = :code`,
      {
        mapX: p.mapX,
        mapY: p.mapY,
        rotDeg,
        truckLane: side(p.truckLane),
        slotStart: side(p.slotStart),
        who: author(),
        code,
      },
    );
    if ((r.rowsAffected ?? 0) === 0) {
      throw new WriteRefused(`Block "${code}" does not exist in CORE_YARD_BLOCK.`);
    }
    await c.commit();
    if (depotLogging()) {
      console.log(`[depot] blok ${code} dipindah: x=${p.mapX} y=${p.mapY} rot=${rotDeg}`);
    }
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    await c.close();
  }
}

// --- tata letak lapangan (YARD_LAYOUT) ---------------------------------------
//
// Bacanya ikut ditaruh di sini, bukan di depot.ts, karena membaca dan menulis
// satu tabel yang sama harus bisa dibaca berdampingan — termasuk aturan revisi,
// yang hanya masuk akal kalau kedua sisinya terlihat sekaligus.

/** Sumber data yang dilayani satu baris tata letak. */
export type LayoutCode = 'DEPOT' | 'DEMO';

/**
 * Batas ukuran JSON tata letak.
 *
 * Tata letak berisi puluhan objek kecil; yang paling padat sekalipun tidak
 * sampai 200 KB. Batas ini menahan kiriman yang jelas bukan tata letak agar
 * tidak menjadi CLOB raksasa di tabel yang isinya cuma beberapa baris.
 */
const MAX_LAYOUT_BYTES = 2 * 1024 * 1024;

export const layoutCode = (v: unknown): LayoutCode =>
  String(v ?? '').trim().toUpperCase() === 'DEMO' ? 'DEMO' : 'DEPOT';

export type StoredLayout = {
  code: LayoutCode;
  /** JSON mentah; klien yang mengurai, server tidak perlu tahu bentuknya. */
  json: string | null;
  revision: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

/**
 * Membaca tata letak bersama. Selalu boleh — saklar DEPOT_DB_WRITE hanya
 * menjaga penulisan.
 *
 * Baris yang belum ada bukan galat: itu keadaan wajar sebelum ada orang yang
 * pernah menyimpan, dan dijawab dengan json null plus revisi 0.
 */
export async function readLayout(code: LayoutCode): Promise<StoredLayout> {
  const c = await borrowConnection();
  try {
    const r = await c.execute<{
      LAYOUT_JSON: string | null;
      REVISION: number;
      UPD_TS: Date | null;
      UPD_BY: string | null;
    }>(
      `SELECT layout_json, revision, upd_ts, upd_by
         FROM yard_layout WHERE layout_code = :code`,
      { code },
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        // CLOB ditarik sebagai string biasa: tata letak paling besar pun masih
        // ratusan kilobyte, jadi streaming lewat Lob hanya menambah rumit.
        fetchInfo: { LAYOUT_JSON: { type: oracledb.STRING } },
      },
    );
    const row = r.rows?.[0];
    if (!row) return { code, json: null, revision: 0, updatedAt: null, updatedBy: null };
    return {
      code,
      json: row.LAYOUT_JSON,
      revision: Number(row.REVISION) || 0,
      updatedAt: row.UPD_TS ? row.UPD_TS.toISOString() : null,
      updatedBy: row.UPD_BY?.trim() ?? null,
    };
  } finally {
    await c.close();
  }
}

/** Penyimpanan ditolak karena baris di database sudah lebih baru. */
export class LayoutConflict extends Error {
  constructor(public current: StoredLayout) {
    super(
      `The layout was changed elsewhere (revision ${current.revision}` +
        `${current.updatedBy ? ` by ${current.updatedBy}` : ''}). ` +
        'Reload the page before editing again so those changes are not overwritten.',
    );
  }
}

/**
 * Menyimpan tata letak bersama, satu baris per sumber data.
 *
 * `baseRevision` adalah revisi yang menjadi dasar suntingan ini. Kalau baris di
 * database sudah melewatinya, penyimpanan DITOLAK — dua orang yang menyunting
 * lapangan yang sama dari PC berbeda tidak boleh saling menimpa diam-diam, dan
 * kehilangan itu tidak akan pernah terlihat kalau kita cuma menulis ulang.
 *
 * MERGE dipakai supaya baris pertama dan pembaruan berikutnya satu pernyataan
 * yang sama; INSERT terpisah hanya menambah jalur yang bisa balapan.
 */
export async function writeLayout(
  code: LayoutCode,
  json: string,
  baseRevision: number,
): Promise<StoredLayout> {
  assertEnabled();
  if (typeof json !== 'string' || !json.trim()) {
    throw new WriteRefused('Layout is empty.');
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_LAYOUT_BYTES) {
    throw new WriteRefused(
      `Layout is ${Math.round(Buffer.byteLength(json, 'utf8') / 1024)} KB, over the limit of ` +
        `${MAX_LAYOUT_BYTES / 1024} KB.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Kolomnya ber-constraint IS JSON, jadi ini toh akan ditolak database —
    // tapi ORA-02290 tidak memberi tahu siapa pun apa yang salah.
    throw new WriteRefused('Layout is not valid JSON.');
  }
  // "null" lolos JSON.parse dan lolos constraint IS JSON. Tanpa pemeriksaan
  // ini, kiriman tanpa field layout akan menimpa tata letak bersama dengan
  // baris kosong yang sah menurut database.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WriteRefused('Layout must be an object.');
  }

  const current = await readLayout(code);

  /**
   * Barisnya HILANG, bukan berubah.
   *
   * Ini bukan bentrokan dan tidak boleh ditolak. Aturan revisi ada untuk
   * menjaga pekerjaan orang lain agar tidak tertimpa diam-diam — kalau barisnya
   * tidak ada, tidak ada pekerjaan siapa pun yang bisa tertimpa.
   *
   * Menolaknya justru merugikan: klien yang sedang menyunting memegang revisi
   * lama, jadi SETIAP penyimpanan berikutnya gagal dan tata letaknya tidak
   * pernah masuk lagi sampai halamannya dimuat ulang. Itu persis gejala yang
   * dilaporkan — baris dihapus dari luar aplikasi, lalu suntingan berikutnya
   * diam saja sampai halaman di-refresh.
   */
  const gone = current.json === null;
  if (!gone && current.revision !== baseRevision) throw new LayoutConflict(current);

  // Baris yang baru dibuat kembali mulai dari 1, bukan melanjutkan nomor lama:
  // nomor itu ikut terhapus bersama barisnya, dan klien menerima nomor barunya
  // dari jawaban ini.
  const next = gone ? 1 : current.revision + 1;
  const c = await borrowConnection();
  try {
    await c.execute(
      `MERGE INTO yard_layout t
         USING (SELECT :code AS layout_code FROM dual) s
            ON (t.layout_code = s.layout_code)
       WHEN MATCHED THEN
         UPDATE SET layout_json = :json, revision = :next,
                    upd_ts = SYSDATE, upd_by = :who
       WHEN NOT MATCHED THEN
         INSERT (layout_code, layout_json, revision, crt_ts, crt_by, upd_ts, upd_by)
         VALUES (:code, :json, :next, SYSDATE, :who, SYSDATE, :who)`,
      { code, json, next, who: author() },
    );
    await c.commit();
    if (depotLogging()) {
      console.log(`[depot] tata letak ${code} disimpan: revisi ${next}, ${json.length} karakter`);
    }
    return {
      code,
      json,
      revision: next,
      updatedAt: new Date().toISOString(),
      updatedBy: author(),
    };
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    await c.close();
  }
}

// --- kunci slot: baris YARD_ROWTIER dihapus / disisipkan kembali -------------
//
// YARD_ROWTIER adalah inventaris slot: tiap sel slot x row x tier punya satu
// baris, kosong atau berisi. Menu stack/unstack TOS memilih tempat dari baris
// itu, jadi sel yang barisnya TIDAK ADA tidak bisa ditumpuki — itulah kuncinya.
// Tidak ada tabel atau kolom baru; aplikasi 3D membaca kunci dari baris yang
// hilang (lihat lockedFromRowtier di depot.ts), jadi tampilan dan TOS tidak
// mungkin berselisih.
//
// Sebelum dipakai sudah diperiksa: tidak ada foreign key yang menunjuk ke
// YARD_ROWTIER, tidak ada trigger, dan tidak ada procedure di skema ini yang
// menyebut tabelnya.

export type SlotRef = { block: string; slot: number; row: number; tier?: number };

const blockCode = (v: unknown) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(s)) throw new WriteRefused(`Invalid block code "${s}".`);
  return s;
};

/** Ukuran blok dari CORE_YARD_BLOCK — batas yang boleh dikunci dan disisipkan. */
async function blockDims(c: oracledb.Connection, code: string) {
  const r = await c.execute<{ SLOTS: number; ROWS_: number; TIERS: number }>(
    `SELECT TO_NUMBER(TRIM(yard_slot)) AS slots, TO_NUMBER(TRIM(yard_row)) AS rows_,
            TO_NUMBER(TRIM(yard_tier)) AS tiers
       FROM core_yard_block WHERE TRIM(yard_block) = :code`,
    { code },
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const row = r.rows?.[0];
  if (!row) throw new WriteRefused(`Block ${code} does not exist in CORE_YARD_BLOCK.`);
  return { slots: Number(row.SLOTS), rows: Number(row.ROWS_), tiers: Number(row.TIERS) };
}

function checkRef(p: SlotRef, d: { slots: number; rows: number; tiers: number }) {
  const slot = Number(p.slot);
  const row = Number(p.row);
  // YARD_SLOT ganjil 1, 3, … 2n-1 — lihat createBlock.
  if (!Number.isInteger(slot) || slot < 1 || slot > d.slots * 2 - 1 || slot % 2 === 0) {
    throw new WriteRefused(`Slot ${p.slot} is outside the block (1..${d.slots * 2 - 1}, odd).`);
  }
  if (!Number.isInteger(row) || row < 1 || row > d.rows) {
    throw new WriteRefused(`Row ${p.row} is outside the block (1..${d.rows}).`);
  }
  return { slot, row };
}

/**
 * Mengunci slot: menghapus baris tier `tier` sampai tier teratas di satu
 * (blok, slot, row).
 *
 * Hanya baris KOSONG yang boleh hilang. Kalau masih ada kontainer di tier itu
 * atau di atasnya — termasuk 40ft dari slot sebelahnya yang membentang ke slot
 * ini — penguncian ditolak seluruhnya, bukan dikerjakan sebagian.
 */
export async function lockSlot(p: SlotRef): Promise<{ deleted: number }> {
  assertEnabled();
  const code = blockCode(p.block);
  const c = await borrowConnection();
  try {
    const d = await blockDims(c, code);
    const { slot, row } = checkRef(p, d);
    const tier = Number(p.tier);
    if (!Number.isInteger(tier) || tier < 1 || tier > d.tiers) {
      throw new WriteRefused(`Tier ${p.tier} is outside the block (1..${d.tiers}).`);
    }

    const busy = await c.execute<{ TIER: number; NO: string | null; SLOT: number }>(
      `SELECT TO_NUMBER(TRIM(y.yard_tier)) AS tier, TRIM(NVL(k.ctr_no, y.container_number)) AS no,
              TO_NUMBER(TRIM(y.yard_slot)) AS slot
         FROM yard_rowtier y
         LEFT JOIN container k ON k.ctr_key = y.container_key
        WHERE TRIM(y.yard_block) = :code
          AND TO_NUMBER(TRIM(y.yard_row)) = :row_
          AND TO_NUMBER(TRIM(y.yard_tier)) >= :tier
          AND y.container_key IS NOT NULL
          AND (TO_NUMBER(TRIM(y.yard_slot)) = :slot
               -- 40ft di slot sebelah kiri membentang ke slot ini HANYA kalau
               -- ia tercatat satu baris. Di database ini 40ft lazimnya punya
               -- dua baris (slot 1 dan 3), dan baris keduanya sudah tertangkap
               -- syarat pertama; menghitungnya lagi lewat slot-2 membuat 40ft
               -- di 1+3 tampak menempati slot 5.
               OR (TO_NUMBER(TRIM(y.yard_slot)) = :slot - 2 AND k.ctr_size >= 40
                   AND (SELECT COUNT(*) FROM yard_rowtier y2 WHERE y2.container_key = y.container_key) = 1))
        ORDER BY 1`,
      { code, row_: row, tier, slot },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const hit = busy.rows?.[0];
    if (hit) {
      throw new WriteRefused(
        `Cannot lock: tier ${hit.TIER} ${hit.SLOT !== slot ? `(40ft from slot ${hit.SLOT}) ` : ''}` +
          `still holds ${hit.NO ?? 'a container'}. A lock may only start above the topmost container.`,
      );
    }

    const res = await c.execute(
      `DELETE FROM yard_rowtier
        WHERE TRIM(yard_block) = :code
          AND TO_NUMBER(TRIM(yard_slot)) = :slot
          AND TO_NUMBER(TRIM(yard_row)) = :row_
          AND TO_NUMBER(TRIM(yard_tier)) >= :tier
          AND container_key IS NULL`,
      { code, slot, row_: row, tier },
    );
    await c.commit();
    const deleted = res.rowsAffected ?? 0;
    if (depotLogging()) {
      console.log(`[depot] kunci ${code} slot ${slot} row ${row} tier ${tier}+: ${deleted} baris dihapus`);
    }
    return { deleted };
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    await c.close();
  }
}

/**
 * Menyisipkan kembali baris yang hilang. Tanpa `slot`/`row` = seluruh blok.
 * Kolom pendamping disalin dari baris tetangga (lihat templateOf).
 */
async function insertMissing(code: string, slot: number | null, row: number | null) {
  assertEnabled();
  const c = await borrowConnection();
  try {
    const d = await blockDims(c, code);
    if (slot !== null && row !== null) checkRef({ block: code, slot, row }, d);
    const have = await existingCells(c, code);
    const cells: { slot: number; row: number; tier: number }[] = [];
    for (let i = 0; i < d.slots; i++) {
      const s = i * 2 + 1;
      if (slot !== null && s !== slot) continue;
      for (let r = 1; r <= d.rows; r++) {
        if (row !== null && r !== row) continue;
        for (let t = 1; t <= d.tiers; t++) {
          if (!have.has(`${s}:${r}:${t}`)) cells.push({ slot: s, row: r, tier: t });
        }
      }
    }
    const inserted = await insertCells(c, code, (await siteOf(c)).site, await templateOf(c, code), cells);
    await c.commit();
    if (depotLogging()) {
      console.log(
        `[depot] buka kunci ${code}${slot !== null ? ` slot ${slot} row ${row}` : ' (seluruh blok)'}: ${inserted} baris disisipkan`,
      );
    }
    return { inserted };
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    await c.close();
  }
}

// --- ubah ukuran blok ---------------------------------------------------------

export type Resize = { code: string; slots: number; rows: number; tiers: number };
export type ResizeResult = {
  code: string;
  from: { slots: number; rows: number; tiers: number };
  to: { slots: number; rows: number; tiers: number };
  deleted: number;
  inserted: number;
};

/**
 * Mengubah slot / row / tier sebuah blok di database: CORE_YARD_BLOCK diperbarui,
 * baris YARD_ROWTIER di luar ukuran baru dihapus, dan baris untuk daerah yang
 * BARU disisipkan.
 *
 * Hanya daerah baru yang disisipkan — bukan "semua yang hilang" — supaya slot
 * yang sengaja dikunci (barisnya dihapus) tidak diam-diam terbuka lagi hanya
 * karena bloknya diperbesar.
 *
 * Mengecilkan ditolak kalau ada kontainer di luar ukuran baru: baris berisi
 * tidak pernah dihapus, dan blok yang ukurannya tidak memuat isinya sendiri
 * adalah data yang berbohong. TEUS_AVA / TEUS_USED tidak disentuh — kolom itu
 * dipelihara TOS.
 */
export async function resizeBlock(input: Resize): Promise<ResizeResult> {
  assertEnabled();
  const code = blockCode(input.code);
  const to = { slots: Number(input.slots), rows: Number(input.rows), tiers: Number(input.tiers) };
  for (const [k, v, max] of [
    ['slot', to.slots, MAX_SLOTS],
    ['row', to.rows, MAX_ROWS],
    ['tier', to.tiers, MAX_TIERS],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > max) throw new WriteRefused(`${k} count must be 1..${max}.`);
  }
  if (to.slots * to.rows * to.tiers > MAX_CELLS * 4) {
    throw new WriteRefused(`Capacity of ${to.slots * to.rows * to.tiers} slots is too large.`);
  }

  const c = await borrowConnection();
  try {
    const from = await blockDims(c, code);
    const maxSlot = to.slots * 2 - 1;

    const busy = await c.execute<{ N: number; NO: string | null }>(
      `SELECT COUNT(*) AS n, MIN(TRIM(container_number)) AS no
         FROM yard_rowtier
        WHERE TRIM(yard_block) = :code AND container_key IS NOT NULL
          AND (TO_NUMBER(TRIM(yard_slot)) > :maxSlot
               OR TO_NUMBER(TRIM(yard_row)) > :rows_
               OR TO_NUMBER(TRIM(yard_tier)) > :tiers)`,
      { code, maxSlot, rows_: to.rows, tiers: to.tiers },
      { outFormat: oracledb.OUT_FORMAT_OBJECT },
    );
    const outside = busy.rows?.[0];
    if (outside && Number(outside.N) > 0) {
      throw new WriteRefused(
        `Cannot shrink: ${outside.N} containers lie outside the new size` +
          `${outside.NO ? ` (including ${outside.NO})` : ''}. Move them via the TOS first.`,
      );
    }

    const del = await c.execute(
      `DELETE FROM yard_rowtier
        WHERE TRIM(yard_block) = :code AND container_key IS NULL
          AND (TO_NUMBER(TRIM(yard_slot)) > :maxSlot
               OR TO_NUMBER(TRIM(yard_row)) > :rows_
               OR TO_NUMBER(TRIM(yard_tier)) > :tiers)`,
      { code, maxSlot, rows_: to.rows, tiers: to.tiers },
    );

    const have = await existingCells(c, code);
    const cells: { slot: number; row: number; tier: number }[] = [];
    for (let i = 0; i < to.slots; i++) {
      const s = i * 2 + 1;
      for (let r = 1; r <= to.rows; r++) {
        for (let t = 1; t <= to.tiers; t++) {
          const fresh = i >= from.slots || r > from.rows || t > from.tiers;
          if (fresh && !have.has(`${s}:${r}:${t}`)) cells.push({ slot: s, row: r, tier: t });
        }
      }
    }
    const inserted = await insertCells(c, code, (await siteOf(c)).site, await templateOf(c, code), cells);

    await c.execute(
      `UPDATE core_yard_block
          SET yard_slot = :slots, yard_row = :rows_, yard_tier = :tiers,
              upd_ts = SYSDATE, upd_by = :who
        WHERE TRIM(yard_block) = :code`,
      { slots: String(to.slots), rows_: String(to.rows), tiers: String(to.tiers), who: author(), code },
    );
    await c.commit();
    const deleted = del.rowsAffected ?? 0;
    if (depotLogging()) {
      console.log(
        `[depot] blok ${code} ${from.slots}x${from.rows}x${from.tiers} → ${to.slots}x${to.rows}x${to.tiers}: ` +
          `${deleted} baris dihapus, ${inserted} disisipkan`,
      );
    }
    return { code, from, to, deleted, inserted };
  } catch (e) {
    await c.rollback().catch(() => {});
    throw e;
  } finally {
    await c.close();
  }
}

/** Membuka satu kolom (blok, slot, row): semua tier yang hilang disisipkan kembali. */
export async function unlockSlot(p: SlotRef): Promise<{ inserted: number }> {
  return insertMissing(blockCode(p.block), Number(p.slot), Number(p.row));
}

/** Membuka seluruh blok. */
export async function unlockBlock(block: string): Promise<{ inserted: number }> {
  return insertMissing(blockCode(block), null, null);
}
