/**
 * Menambah / memperbarui livery TERTENTU (beserta aturan prefixnya) di master
 * livery database yang ditunjuk .env, dari src/lib/livery-seed.json — tanpa
 * menyentuh livery lain. seed-livery-logos.mjs menimpa SEMUA baris; skrip ini
 * untuk menambah satu-dua merek di master yang mungkin sudah disunting.
 *
 * Aturan prefix diarahkan ke livery ini dan diaktifkan (baris lama dengan
 * prefix+jenis yang sama ditimpa — mis. TTNU yang dulu salah ke Tanto).
 * Aman dijalankan berulang; satu transaksi.
 *
 * Pemakaian:
 *   node scripts/seed-livery-codes.mjs TRITON_GP SITC_GP SAMUDERA_GP
 */
import fs from 'node:fs';
import oracledb from 'oracledb';

const codes = process.argv.slice(2);
if (!codes.length) throw new Error('sebutkan kode livery, mis. node scripts/seed-livery-codes.mjs SITC_GP');
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const all = JSON.parse(fs.readFileSync('src/lib/livery-seed.json', 'utf8')).liveries;
const picked = codes.map((code) => {
  const x = all.find((l) => l.code === code);
  if (!x) throw new Error(`${code} tidak ada di src/lib/livery-seed.json`);
  if (x.logo && !fs.existsSync(`public/liveries/${x.logo}`)) throw new Error(`berkas logo tidak ada: public/liveries/${x.logo}`);
  return x;
});

const c = await oracledb.getConnection({
  user: process.env.DEPOT_DB_USER,
  password: process.env.DEPOT_DB_PASS,
  connectString: process.env.DEPOT_DB_CONNECT_STRING,
});
try {
  for (const x of picked) {
    const bind = {
      code: x.code,
      brand: x.brand,
      model: x.model ?? 'GP_CORRUGATED',
      body: x.body,
      text: x.text,
      logo: x.logo,
      scale: x.scale,
    };
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
    }
    console.log(`${u.rowsAffected ? '~' : '+'} ${x.code}`);
    for (const prefix of x.prefixes) {
      const r = { prefix, kind: x.kind ?? 'GP', livery: x.code };
      const v = await c.execute(
        `UPDATE yard_livery_map SET livery_code = :livery, active_flag = 'Y', upd_ts = SYSDATE, upd_by = 'SETUP'
          WHERE match_type = 'PREFIX' AND match_value = :prefix AND ctr_kind = :kind`,
        r,
      );
      if (v.rowsAffected === 0) {
        await c.execute(
          `INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by)
           VALUES ('PREFIX', :prefix, :kind, :livery, 10, 'SETUP')`,
          r,
        );
      }
      console.log(`  ${v.rowsAffected ? '~' : '+'} ${prefix}/${r.kind} → ${x.code}`);
    }
  }
  await c.commit();
} catch (e) {
  await c.rollback().catch(() => {});
  console.error('GAGAL:', e.message);
  process.exitCode = 1;
} finally {
  await c.close();
}
