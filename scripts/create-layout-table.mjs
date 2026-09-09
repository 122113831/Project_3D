/**
 * Membuat tabel YARD_LAYOUT di database yang sedang ditunjuk .env.
 *
* Pemisah pernyataannya naif — memotong di setiap ";" — jadi JANGAN taruh
 * titik koma di dalam literal string berkas .sql itu.
 *
 * Aman dijalankan berulang: kalau tabelnya sudah ada, skrip berhenti tanpa
 * menyentuh apa pun. DDL-nya sendiri ada di scripts/sql/yard_layout.sql —
 * berkas itu yang jadi acuan kalau tabelnya harus dibuat DBA di lingkungan lain.
 *
 * Pemakaian:
 *   node scripts/create-layout-table.mjs          # buat kalau belum ada
 *   node scripts/create-layout-table.mjs --drop   # buang lalu buat ulang
 */
import fs from 'node:fs';
import path from 'node:path';
import oracledb from 'oracledb';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const DROP = process.argv.includes('--drop');
const target = process.env.DEPOT_DB_CONNECT_STRING;

/** Pernyataan dipisah dari berkas .sql; komentar "--" dibuang lebih dulu. */
function statements() {
  const raw = fs.readFileSync(path.join('scripts', 'sql', 'yard_layout.sql'), 'utf8');
  return raw
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
    .split(';')
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
  const exists = async () => {
    const r = await c.execute(`SELECT COUNT(*) AS n FROM user_tables WHERE table_name = 'YARD_LAYOUT'`);
    return r.rows[0].N > 0;
  };

  if (await exists()) {
    if (!DROP) {
      console.log(`YARD_LAYOUT sudah ada di ${target}. Tidak ada yang diubah.`);
      process.exit(0);
    }
    await c.execute(`DROP TABLE yard_layout PURGE`);
    console.log('YARD_LAYOUT lama dibuang.');
  }

  for (const sql of statements()) {
    await c.execute(sql);
    console.log('  ok: ' + sql.split('\n')[0].slice(0, 70));
  }

  const cols = await c.execute(
    `SELECT column_name, data_type, data_length, nullable
       FROM user_tab_columns WHERE table_name = 'YARD_LAYOUT' ORDER BY column_id`,
  );
  console.log(`\nYARD_LAYOUT dibuat di ${target}:`);
  for (const r of cols.rows) {
    const size = r.DATA_TYPE === 'VARCHAR2' ? `(${r.DATA_LENGTH})` : '';
    console.log(`  ${r.COLUMN_NAME.padEnd(12)} ${r.DATA_TYPE}${size}${r.NULLABLE === 'N' ? ' NOT NULL' : ''}`);
  }
} finally {
  await c.close();
}
