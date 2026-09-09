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
    target: process.env.DEPOT_DB_CONNECT_STRING || '(belum diatur)',
  };
}

export class WriteRefused extends Error {}

function assertEnabled() {
  if (!enabled()) {
    throw new WriteRefused(
      'Penulisan ke database dimatikan. Set DEPOT_DB_WRITE=true di .env untuk mengaktifkannya ' +
        `pada koneksi yang sedang dipakai (${process.env.DEPOT_DB_CONNECT_STRING ?? '?'}).`,
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
    throw new WriteRefused('Kode blok harus 1–5 huruf atau angka, tanpa spasi.');
  }
  const slots = int(input.slots);
  const rows = int(input.rows);
  const tiers = int(input.tiers);
  if (!(slots >= 1 && slots <= MAX_SLOTS)) {
    throw new WriteRefused(`Jumlah slot harus 1–${MAX_SLOTS}.`);
  }
  if (!(rows >= 1 && rows <= MAX_ROWS)) {
    throw new WriteRefused(`Jumlah row harus 1–${MAX_ROWS}.`);
  }
  if (!(tiers >= 1 && tiers <= MAX_TIERS)) {
    throw new WriteRefused(`Jumlah tier harus 1–${MAX_TIERS}.`);
  }
  if (slots * rows * tiers > MAX_CELLS) {
    throw new WriteRefused(
      `Blok ${slots}x${rows}x${tiers} = ${slots * rows * tiers} slot, di atas batas ${MAX_CELLS}. ` +
        'Tiap slot menjadi satu baris YARD_ROWTIER.',
    );
  }
  const mapX = Number(input.mapX);
  const mapY = Number(input.mapY);
  if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
    throw new WriteRefused('Posisi blok tidak sah.');
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
    teus_ava, teus_used, cy_loc, crt_ts, crt_by, upd_ts, upd_by
  ) VALUES (
    TO_CHAR(SYSDATE,'YYMMDDMISS') || LPAD(seq_id.NEXTVAL, 10, '0'),
    :site, :code, :name, :slots, :rows_, :tiers,
    :mapX, :mapY, :rotDeg, 'P', 'H', :truckLane, :slotStart,
    :cap, 0, :cy, SYSDATE, :who, SYSDATE, :who
  )`;

/**
 * ID di YARD_ROWTIER mengikuti pola yang sudah ada di tabelnya: YYMMDD + menit
 * + detik + 10 digit dari SEQ_ID, unik per baris (2.765 baris, 2.765 ID unik).
 *
 * Dirakit di SQL, bukan di JavaScript: angkanya 20 digit, jauh di atas batas
 * presisi Number, dan merakitnya di sini akan diam-diam membulatkannya.
 */
const SLOT_INSERT = `
  INSERT INTO yard_rowtier (
    id, site_id, yard_block, yard_slot, yard_row, yard_tier,
    status, container_key, container_number, update_time, pch, cy_loc
  ) VALUES (
    TO_NUMBER(TO_CHAR(SYSDATE,'YYMMDDMISS') || LPAD(seq_id.NEXTVAL, 10, '0')),
    :site, :code, :slot, :row_, :tier, 'DRY', NULL, NULL, SYSDATE, 'C', :cy
  )`;

/** SITE_ID dan CY_LOC diambil dari blok yang sudah ada, bukan ditanam di kode. */
async function siteOf(c: oracledb.Connection) {
  const r = await c.execute<{ SITE_ID: string | null; CY_LOC: string | null }>(
    `SELECT site_id, cy_loc FROM core_yard_block WHERE ROWNUM = 1`,
    {},
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );
  const row = r.rows?.[0];
  return { site: row?.SITE_ID ?? null, cy: row?.CY_LOC?.trim() ?? null };
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
      throw new WriteRefused(`Blok "${b.code}" sudah ada di CORE_YARD_BLOCK.`);
    }

    const { site, cy } = await siteOf(c);
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
      cy,
      who: author(),
    });

    // Nomor slot ganjil: 1, 3, 5, … 2n-1. Itu konvensi YARD_SLOT di database
    // ini — nol baris bernomor genap di ketiga blok yang sudah ada.
    const rows: oracledb.BindParameters[] = [];
    for (let s = 0; s < b.slots; s++) {
      for (let r = 1; r <= b.rows; r++) {
        for (let t = 1; t <= b.tiers; t++) {
          rows.push({
            site,
            code: b.code,
            slot: String(s * 2 + 1),
            row_: String(r),
            tier: String(t),
            cy,
          });
        }
      }
    }

    const res = await c.executeMany(SLOT_INSERT, rows, {
      bindDefs: {
        site: { type: oracledb.STRING, maxSize: 20 },
        code: { type: oracledb.STRING, maxSize: 5 },
        slot: { type: oracledb.STRING, maxSize: 3 },
        row_: { type: oracledb.STRING, maxSize: 2 },
        tier: { type: oracledb.STRING, maxSize: 2 },
        cy: { type: oracledb.STRING, maxSize: 3 },
      },
    });
    if ((res.rowsAffected ?? 0) !== rows.length) {
      throw new Error(`Hanya ${res.rowsAffected} dari ${rows.length} baris slot tersisip.`);
    }

    await c.commit();
    const ms = Date.now() - started;
    if (depotLogging()) {
      console.log(`[depot] blok ${b.code} dibuat: ${rows.length} baris slot, ${ms} ms`);
    }
    return { code: b.code, slotRows: rows.length, ms };
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
  if (!/^[A-Z0-9]{1,5}$/.test(code)) throw new WriteRefused('Kode blok tidak sah.');
  if (!Number.isFinite(p.mapX) || !Number.isFinite(p.mapY)) {
    throw new WriteRefused('Posisi blok tidak sah.');
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
      throw new WriteRefused(`Blok "${code}" tidak ada di CORE_YARD_BLOCK.`);
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
      `Tata letak sudah diubah dari tempat lain (revisi ${current.revision}` +
        `${current.updatedBy ? ` oleh ${current.updatedBy}` : ''}). ` +
        'Muat ulang halaman sebelum menyunting lagi supaya perubahan itu tidak tertimpa.',
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
    throw new WriteRefused('Tata letak kosong.');
  }
  if (Buffer.byteLength(json, 'utf8') > MAX_LAYOUT_BYTES) {
    throw new WriteRefused(
      `Tata letak ${Math.round(Buffer.byteLength(json, 'utf8') / 1024)} KB, di atas batas ` +
        `${MAX_LAYOUT_BYTES / 1024} KB.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // Kolomnya ber-constraint IS JSON, jadi ini toh akan ditolak database —
    // tapi ORA-02290 tidak memberi tahu siapa pun apa yang salah.
    throw new WriteRefused('Tata letak bukan JSON yang sah.');
  }
  // "null" lolos JSON.parse dan lolos constraint IS JSON. Tanpa pemeriksaan
  // ini, kiriman tanpa field layout akan menimpa tata letak bersama dengan
  // baris kosong yang sah menurut database.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WriteRefused('Tata letak harus berupa objek.');
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
