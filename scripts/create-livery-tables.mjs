/**
 * Membuat tabel YARD_LIVERY + YARD_LIVERY_MAP beserta data awalnya di database
 * yang sedang ditunjuk .env (DEPOT_DB_CONNECT_STRING).
 *
 * DDL dan data awal dibaca dari scripts/sql/yard_livery.sql — berkas itu acuan
 * untuk DBA di lingkungan lain. Yang dijalankan hanya bagian 1–3; blok
 * komentar (/* ... *\/) dan baris "--" dibuang, jadi query bantu di bagian 4
 * tidak ikut jalan. Pemisah pernyataannya ";" di akhir baris — jangan taruh
 * titik koma di akhir baris di dalam literal string.
 *
 * Aman dijalankan berulang: kalau salah satu tabel sudah ada, skrip berhenti
 * tanpa menyentuh apa pun. Semua DML dalam satu transaksi: kalau satu INSERT
 * gagal, tidak ada data awal yang tersimpan (DDL Oracle tetap auto-commit).
 *
 * Pemakaian:
 *   node scripts/create-livery-tables.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import oracledb from 'oracledb';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const target = process.env.DEPOT_DB_CONNECT_STRING;

function statements() {
  const raw = fs.readFileSync(path.join('scripts', 'sql', 'yard_livery.sql'), 'utf8');
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
const c = await oracledb.getConnection({
  user: process.env.DEPOT_DB_USER,
  password: process.env.DEPOT_DB_PASS,
  connectString: target,
});

try {
  const r = await c.execute(
    `SELECT table_name FROM user_tables WHERE table_name IN ('YARD_LIVERY', 'YARD_LIVERY_MAP')`,
  );
  if (r.rows.length) {
    console.log(`Sudah ada di ${target}: ${r.rows.map((x) => x.TABLE_NAME).join(', ')}. Tidak ada yang diubah.`);
    process.exit(0);
  }

  const all = statements();
  const ddl = all.filter((s) => /^(CREATE|COMMENT)\b/i.test(s));
  const dml = all.filter((s) => /^INSERT\b/i.test(s));
  for (const s of ddl) await c.execute(s);
  console.log(`DDL: ${ddl.length} pernyataan.`);
  for (const s of dml) await c.execute(s);
  await c.commit();
  console.log(`Data awal: ${dml.length} baris.`);

  const liv = await c.execute(`SELECT livery_code, brand_name, model_code, body_color FROM yard_livery ORDER BY livery_code`);
  console.log(`\nYARD_LIVERY di ${target}:`);
  for (const x of liv.rows) console.log(`  ${x.LIVERY_CODE.padEnd(16)} ${x.MODEL_CODE.padEnd(14)} ${x.BODY_COLOR}  ${x.BRAND_NAME}`);
  const map = await c.execute(
    `SELECT match_type, match_value, ctr_kind, livery_code, priority FROM yard_livery_map ORDER BY match_type DESC, match_value`,
  );
  console.log('\nYARD_LIVERY_MAP:');
  for (const x of map.rows) console.log(`  ${x.MATCH_TYPE.padEnd(8)} ${x.MATCH_VALUE.padEnd(6)} ${x.CTR_KIND.padEnd(7)} → ${x.LIVERY_CODE} (prioritas ${x.PRIORITY})`);
} catch (e) {
  await c.rollback().catch(() => {});
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await c.close();
}
