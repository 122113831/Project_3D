/**
 * Mengisi master livery dengan logo berkas di public/liveries/ (dev).
 *
 * Daftar merek dibaca dari src/lib/livery-seed.json (sama dengan cadangan di
 * src/lib/livery.ts). BRAND_TEXT dikosongkan karena berkas logo sudah memuat
 * tulisan merek; tanpa itu tulisannya dobel.
 *
 * Aman dijalankan berulang: baris yang sudah ada di-UPDATE, yang belum di-INSERT.
 * Semua dalam satu transaksi.
 *
 * Pemakaian: node scripts/seed-livery-logos.mjs
 */
import fs from 'node:fs';
import oracledb from 'oracledb';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

// Daftar merek: src/lib/livery-seed.json — sama dengan cadangan di livery.ts.
const SEED_FILE = JSON.parse(fs.readFileSync('src/lib/livery-seed.json', 'utf8'));
const SEED = SEED_FILE.liveries;
// Aturan prefix yang ternyata salah: DINONAKTIFKAN (active_flag = 'N'), tidak
// dihapus — riwayatnya tetap ada dan bisa diaktifkan lagi.
const OFF = SEED_FILE._nonaktif ?? [];
const LIVERIES = SEED.map((x) => ({
  code: x.code,
  brand: x.brand,
  model: x.model ?? 'GP_CORRUGATED',
  body: x.body,
  text: x.text,
  logo: x.logo,
  scale: x.scale,
}));
// Jenis aturan: GP kecuali livery-nya menyebut lain (tank Seaco = TANK, jadi
// prefix SEGU yang sama mengarah ke tampilan berbeda untuk GP dan tank).
const RULES = SEED.flatMap((x) => x.prefixes.map((prefix) => ({ prefix, livery: x.code, kind: x.kind ?? 'GP' })));

// logo null = tampilan digambar di kode (SIDE_LAYOUT di src/lib/livery.ts).
for (const l of LIVERIES) {
  if (l.logo && !fs.existsSync(`public/liveries/${l.logo}`)) throw new Error(`berkas logo tidak ada: public/liveries/${l.logo}`);
}

const c = await oracledb.getConnection({
  user: process.env.DEPOT_DB_USER,
  password: process.env.DEPOT_DB_PASS,
  connectString: process.env.DEPOT_DB_CONNECT_STRING,
});
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

try {
  for (const l of LIVERIES) {
    const bind = { code: l.code, brand: l.brand, model: l.model, body: l.body, text: l.text, logo: l.logo, scale: l.scale };
    const u = await c.execute(
      `UPDATE yard_livery
          SET brand_name = :brand, model_code = :model, body_color = :body, text_color = :text, brand_text = NULL,
              logo_file = :logo, logo_pos = 'LEFT', logo_scale = :scale, active_flag = 'Y',
              upd_ts = SYSDATE, upd_by = 'SETUP'
        WHERE livery_code = :code`,
      bind,
    );
    if (u.rowsAffected === 0) {
      await c.execute(
        `INSERT INTO yard_livery (livery_code, brand_name, model_code, body_color, text_color, brand_text,
                                  logo_file, logo_pos, logo_scale, crt_by)
         VALUES (:code, :brand, :model, :body, :text, NULL, :logo, 'LEFT', :scale, 'SETUP')`,
        bind,
      );
      console.log(`+ ${l.code}`);
    } else console.log(`~ ${l.code}`);
  }
  for (const r of RULES) {
    const u = await c.execute(
      `UPDATE yard_livery_map SET livery_code = :livery, active_flag = 'Y', upd_ts = SYSDATE, upd_by = 'SETUP'
        WHERE match_type = 'PREFIX' AND match_value = :prefix AND ctr_kind = :kind`,
      r,
    );
    if (u.rowsAffected === 0) {
      await c.execute(
        `INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by)
         VALUES ('PREFIX', :prefix, :kind, :livery, 10, 'SETUP')`,
        r,
      );
      console.log(`+ ${r.prefix}/${r.kind} → ${r.livery}`);
    } else console.log(`~ ${r.prefix}/${r.kind} → ${r.livery}`);
  }
  for (const r of OFF) {
    const u = await c.execute(
      `UPDATE yard_livery_map SET active_flag = 'N', upd_ts = SYSDATE, upd_by = 'SETUP'
        WHERE match_type = 'PREFIX' AND match_value = :prefix AND ctr_kind = :kind AND active_flag = 'Y'`,
      { prefix: r.prefix, kind: r.kind },
    );
    if (u.rowsAffected) console.log(`- ${r.prefix}/${r.kind} dinonaktifkan (${r.alasan})`);
  }
  await c.commit();

  const liv = await c.execute(
    `SELECT livery_code, body_color, NVL(brand_text, '-') brand_text, NVL(logo_file, '-') logo_file
       FROM yard_livery ORDER BY livery_code`,
  );
  console.log('\nYARD_LIVERY:');
  for (const x of liv.rows) console.log(`  ${x.LIVERY_CODE.padEnd(15)} ${x.BODY_COLOR} teks=${x.BRAND_TEXT.padEnd(8)} logo=${x.LOGO_FILE}`);
  const map = await c.execute(
    `SELECT match_value, livery_code FROM yard_livery_map WHERE match_type = 'PREFIX' ORDER BY livery_code, match_value`,
  );
  console.log('\nPrefix:', map.rows.map((x) => `${x.MATCH_VALUE}→${x.LIVERY_CODE}`).join('  '));
} catch (e) {
  await c.rollback().catch(() => {});
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await c.close();
}
