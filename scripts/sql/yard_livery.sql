-- =============================================================================
-- Master livery kontainer untuk yard_3d
-- =============================================================================
--
-- Tujuan: setiap pemilik kontainer tampil dengan aset (cat, logo, model) aslinya
-- di lapangan 3D. Kuncinya PREFIX nomor kontainer (4 huruf pertama, kode
-- pemilik ISO 6346 / BIC), bukan kode shipping agent:
--
--   - agen bukan pemilik: di data ada MSKU (milik Maersk) yang tercatat di
--     agen RCL;
--   - kontainer sewa (TCLU, TRLU, TGHU, ...) bercat leasing-nya sendiri, siapa
--     pun agennya.
--
-- Agen tetap dipakai, tapi hanya sebagai CADANGAN kalau prefix-nya belum
-- terdaftar.
--
-- Dua tabel:
--   YARD_LIVERY      — satu baris per tampilan (merek × jenis model).
--   YARD_LIVERY_MAP  — aturan pencocokan: prefix / agen / bawaan → livery.
--
-- Urutan pencarian untuk satu kontainer (dipakai aplikasi, contoh SQL-nya di
-- bagian bawah berkas):
--   1. PREFIX  cocok + jenis kontainer cocok      (mis. MSKU + GP)
--   2. PREFIX  cocok + jenis 'ANY'
--   3. AGENT   cocok + jenis cocok                (mis. agen RCL + REEFER)
--   4. AGENT   cocok + jenis 'ANY'
--   5. DEFAULT untuk jenis itu                    (match_value '*')
-- Di dalam satu tingkat, PRIORITY terkecil menang.
--
-- Skrip ini HANYA membuat tabel dan data awal. Jalankan sekali per lingkungan
-- (dev dulu, lalu produksi) oleh DBA / pemilik skema. Tidak ada DROP di sini.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. YARD_LIVERY — tampilan
-- -----------------------------------------------------------------------------
CREATE TABLE yard_livery (
  livery_code   VARCHAR2(30)   NOT NULL,
  brand_name    VARCHAR2(100)  NOT NULL,
  -- Bentuk 3D yang dipakai. Cat & logo ditempel di atasnya.
  --   GP_CORRUGATED : kontainer kering bergelombang (seperti Maersk sekarang)
  --   REEFER_PANEL  : reefer panel rata + muka mesin
  --   TANK          : tank container
  model_code    VARCHAR2(20)   NOT NULL,
  -- Warna badan & tulisan, format '#RRGGBB'.
  body_color    VARCHAR2(7)    NOT NULL,
  text_color    VARCHAR2(7)    DEFAULT '#1C1E20' NOT NULL,
  -- Teks merek besar di dinding samping (mis. 'MAERSK'). NULL = tanpa teks.
  brand_text    VARCHAR2(30),
  -- Berkas logo di folder public/liveries/ aplikasi (PNG transparan, ±1024 px).
  -- NULL = tanpa logo.
  logo_file     VARCHAR2(200),
  -- Letak logo relatif teks merek di dinding samping.
  logo_pos      VARCHAR2(10)   DEFAULT 'LEFT' NOT NULL,
  -- Skala logo terhadap tinggi kontainer (0,1–0,9).
  logo_scale    NUMBER(3,2)    DEFAULT 0.50 NOT NULL,
  active_flag   CHAR(1)        DEFAULT 'Y' NOT NULL,
  remark        VARCHAR2(400),
  crt_ts        DATE           DEFAULT SYSDATE,
  crt_by        VARCHAR2(100),
  upd_ts        DATE,
  upd_by        VARCHAR2(100),
  CONSTRAINT pk_yard_livery PRIMARY KEY (livery_code),
  CONSTRAINT ck_yard_livery_code   CHECK (REGEXP_LIKE(livery_code, '^[A-Z0-9_]+$')),
  CONSTRAINT ck_yard_livery_model  CHECK (model_code IN ('GP_CORRUGATED', 'REEFER_PANEL', 'TANK')),
  CONSTRAINT ck_yard_livery_body   CHECK (REGEXP_LIKE(body_color, '^#[0-9A-Fa-f]{6}$')),
  CONSTRAINT ck_yard_livery_text   CHECK (REGEXP_LIKE(text_color, '^#[0-9A-Fa-f]{6}$')),
  CONSTRAINT ck_yard_livery_pos    CHECK (logo_pos IN ('LEFT', 'RIGHT', 'CENTER', 'NONE')),
  CONSTRAINT ck_yard_livery_scale  CHECK (logo_scale BETWEEN 0.1 AND 0.9),
  CONSTRAINT ck_yard_livery_active CHECK (active_flag IN ('Y', 'N'))
);

COMMENT ON TABLE  yard_livery IS 'Tampilan kontainer 3D per merek dan jenis model (yard_3d)';
COMMENT ON COLUMN yard_livery.livery_code IS 'Kode unik livery, huruf besar/angka/garis bawah, mis. MAERSK_GP';
COMMENT ON COLUMN yard_livery.model_code  IS 'Bentuk 3D: GP_CORRUGATED, REEFER_PANEL, TANK';
COMMENT ON COLUMN yard_livery.body_color  IS 'Warna badan #RRGGBB';
COMMENT ON COLUMN yard_livery.text_color  IS 'Warna tulisan & nomor kontainer #RRGGBB';
COMMENT ON COLUMN yard_livery.brand_text  IS 'Teks merek besar di dinding samping, NULL = tanpa teks';
COMMENT ON COLUMN yard_livery.logo_file   IS 'Nama berkas di public/liveries/, NULL = tanpa logo';
COMMENT ON COLUMN yard_livery.active_flag IS 'N = tidak dipakai lagi (jangan hapus baris yang pernah dipakai)';


-- -----------------------------------------------------------------------------
-- 2. YARD_LIVERY_MAP — aturan pencocokan
-- -----------------------------------------------------------------------------
CREATE TABLE yard_livery_map (
  -- PREFIX  : match_value = 4 huruf kode pemilik, mis. 'MSKU'
  -- AGENT   : match_value = kode agen di CONTAINER.AGENT, mis. 'RCL'
  -- DEFAULT : match_value = '*', cadangan terakhir per jenis
  match_type    VARCHAR2(10)   NOT NULL,
  match_value   VARCHAR2(20)   NOT NULL,
  -- Jenis kontainer yang dicocokkan: GP, REEFER, TANK, atau ANY (semua).
  ctr_kind      VARCHAR2(10)   DEFAULT 'ANY' NOT NULL,
  livery_code   VARCHAR2(30)   NOT NULL,
  priority      NUMBER(3)      DEFAULT 100 NOT NULL,
  active_flag   CHAR(1)        DEFAULT 'Y' NOT NULL,
  remark        VARCHAR2(400),
  crt_ts        DATE           DEFAULT SYSDATE,
  crt_by        VARCHAR2(100),
  upd_ts        DATE,
  upd_by        VARCHAR2(100),
  CONSTRAINT pk_yard_livery_map PRIMARY KEY (match_type, match_value, ctr_kind),
  CONSTRAINT fk_yard_livery_map FOREIGN KEY (livery_code) REFERENCES yard_livery (livery_code),
  CONSTRAINT ck_yard_lmap_type   CHECK (match_type IN ('PREFIX', 'AGENT', 'DEFAULT')),
  CONSTRAINT ck_yard_lmap_kind   CHECK (ctr_kind IN ('GP', 'REEFER', 'TANK', 'ANY')),
  CONSTRAINT ck_yard_lmap_active CHECK (active_flag IN ('Y', 'N')),
  -- Prefix wajib kode pemilik ISO 6346: 3 huruf + U/J/Z. Ini yang menolak
  -- data uji seperti 'SDFF' atau 'DFGD' masuk ke master.
  CONSTRAINT ck_yard_lmap_prefix CHECK (
    match_type <> 'PREFIX' OR REGEXP_LIKE(match_value, '^[A-Z]{3}[UJZ]$')
  ),
  CONSTRAINT ck_yard_lmap_default CHECK (
    match_type <> 'DEFAULT' OR match_value = '*'
  )
);

CREATE INDEX ix_yard_livery_map_liv ON yard_livery_map (livery_code);

COMMENT ON TABLE  yard_livery_map IS 'Aturan pencocokan kontainer ke livery: prefix, agen, atau bawaan';
COMMENT ON COLUMN yard_livery_map.match_type  IS 'PREFIX / AGENT / DEFAULT';
COMMENT ON COLUMN yard_livery_map.match_value IS 'Prefix 4 huruf, kode agen, atau * untuk DEFAULT';
COMMENT ON COLUMN yard_livery_map.ctr_kind    IS 'GP / REEFER / TANK / ANY';
COMMENT ON COLUMN yard_livery_map.priority    IS 'Terkecil menang di dalam satu tingkat pencocokan';


-- -----------------------------------------------------------------------------
-- 3. Data awal: Maersk dan Meratus, sisanya livery default polos
-- -----------------------------------------------------------------------------
-- DEMU dan prefix lain di data dev adalah data dummy, jadi TIDAK didaftarkan:
-- mereka jatuh ke DEFAULT (GENERIC_GP / GENERIC_REEFER).
-- logo_file NULL: logo Maersk saat ini digambar di kode, logo Meratus belum
-- ada berkasnya. Isi nanti setelah PNG-nya ditaruh di public/liveries/.

INSERT INTO yard_livery (livery_code, brand_name, model_code, body_color, text_color, brand_text, logo_file, logo_pos, logo_scale, crt_by, remark)
VALUES ('MAERSK_GP', 'Maersk Line', 'GP_CORRUGATED', '#A3A6A9', '#1C1E20', 'MAERSK', NULL, 'LEFT', 0.56, 'SETUP', 'GP abu-abu, bintang teal, MAERSK hitam');

INSERT INTO yard_livery (livery_code, brand_name, model_code, body_color, text_color, brand_text, logo_file, logo_pos, logo_scale, crt_by, remark)
VALUES ('MERATUS_GP', 'Meratus Line', 'GP_CORRUGATED', '#1F4E9C', '#FFFFFF', 'MERATUS', NULL, 'LEFT', 0.50, 'SETUP', 'Warna badan sementara, cocokkan dengan cat Meratus asli');

-- Cadangan polos: hanya nomor kontainer, tanpa merek.
INSERT INTO yard_livery (livery_code, brand_name, model_code, body_color, text_color, brand_text, logo_file, logo_pos, logo_scale, crt_by, remark)
VALUES ('GENERIC_GP', 'Polos (tanpa merek)', 'GP_CORRUGATED', '#8D949C', '#1C1E20', NULL, NULL, 'NONE', 0.50, 'SETUP', 'Dipakai kalau prefix dan agen belum terdaftar');

INSERT INTO yard_livery (livery_code, brand_name, model_code, body_color, text_color, brand_text, logo_file, logo_pos, logo_scale, crt_by, remark)
VALUES ('GENERIC_REEFER', 'Reefer polos', 'REEFER_PANEL', '#E3E6E8', '#1C1E20', NULL, NULL, 'NONE', 0.50, 'SETUP', 'Reefer tanpa merek');

-- Prefix milik Maersk.
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('PREFIX', 'MSKU', 'GP', 'MAERSK_GP', 10, 'SETUP');
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('PREFIX', 'MRKU', 'GP', 'MAERSK_GP', 10, 'SETUP');
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('PREFIX', 'MAEU', 'GP', 'MAERSK_GP', 10, 'SETUP');
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('PREFIX', 'MRSU', 'GP', 'MAERSK_GP', 10, 'SETUP');

-- Prefix milik Meratus.
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('PREFIX', 'MRTU', 'GP', 'MERATUS_GP', 10, 'SETUP');
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('PREFIX', 'MRLU', 'GP', 'MERATUS_GP', 10, 'SETUP');

-- Cadangan terakhir per jenis (DEMU dan lain-lain jatuh ke sini).
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('DEFAULT', '*', 'GP',     'GENERIC_GP',     999, 'SETUP');
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by) VALUES ('DEFAULT', '*', 'REEFER', 'GENERIC_REEFER', 999, 'SETUP');

COMMIT;


-- =============================================================================
-- 4. Query bantu (tidak dijalankan otomatis, salin bila perlu)
-- =============================================================================

-- 4a. Livery yang dipakai tiap kontainer di lapangan (urutan pencarian di atas).
--     CTR_KIND memakai aturan yang sama dengan aplikasi (src/lib/depot.ts):
--     tank = CTR_TYPE 'TK', reefer = CTR_TYPE RE/RF/RH/RT atau huruf ke-3
--     ISO_CODE 'R' (mis. 22R1), selain itu GP.
/*
WITH ctr AS (
  SELECT k.ctr_no,
         SUBSTR(UPPER(TRIM(k.ctr_no)), 1, 4)  AS prefix,
         UPPER(TRIM(k.agent))                 AS agent,
         CASE
           WHEN UPPER(TRIM(k.ctr_type)) = 'TK' THEN 'TANK'
           WHEN UPPER(TRIM(k.ctr_type)) IN ('RE', 'RF', 'RH', 'RT')
             OR SUBSTR(UPPER(TRIM(k.iso_code)), 3, 1) = 'R' THEN 'REEFER'
           ELSE 'GP'
         END                                  AS ctr_kind
    FROM container k
    JOIN (SELECT DISTINCT container_key FROM yard_rowtier) y ON y.container_key = k.ctr_key
),
cand AS (
  SELECT c.ctr_no, m.livery_code,
         CASE m.match_type WHEN 'PREFIX' THEN 1 WHEN 'AGENT' THEN 3 ELSE 5 END
           + CASE WHEN m.ctr_kind = 'ANY' AND m.match_type <> 'DEFAULT' THEN 1 ELSE 0 END AS lvl,
         m.priority
    FROM ctr c
    JOIN yard_livery_map m
      ON m.active_flag = 'Y'
     AND m.ctr_kind IN (c.ctr_kind, 'ANY')
     AND (   (m.match_type = 'PREFIX'  AND m.match_value = c.prefix)
          OR (m.match_type = 'AGENT'   AND m.match_value = c.agent)
          OR (m.match_type = 'DEFAULT' AND m.ctr_kind = c.ctr_kind))
    JOIN yard_livery l ON l.livery_code = m.livery_code AND l.active_flag = 'Y'
)
SELECT ctr_no, livery_code
  FROM (SELECT cand.*, ROW_NUMBER() OVER (PARTITION BY ctr_no ORDER BY lvl, priority) rn FROM cand)
 WHERE rn = 1;
*/

-- 4b. Prefix di lapangan yang BELUM punya aturan: daftar kerja admin.
--     Prefix tidak valid (bukan 3 huruf + U/J/Z) dipisah: itu salah input
--     nomor kontainer, diperbaiki di data, bukan didaftarkan di master.
--     Tanpa LISTAGG DISTINCT supaya jalan juga di Oracle sebelum 19c.
/*
WITH ada AS (
  SELECT SUBSTR(UPPER(TRIM(k.ctr_no)), 1, 4) AS prefix, TRIM(k.agent) AS agent
    FROM container k
    JOIN (SELECT DISTINCT container_key FROM yard_rowtier) y ON y.container_key = k.ctr_key
),
per_agen AS (
  SELECT prefix, agent, COUNT(*) AS n FROM ada GROUP BY prefix, agent
)
SELECT prefix,
       CASE WHEN REGEXP_LIKE(prefix, '^[A-Z]{3}[UJZ]$') THEN 'VALID' ELSE 'NOMOR SALAH' END AS status,
       SUM(n)                                            AS jumlah,
       LISTAGG(agent, ',') WITHIN GROUP (ORDER BY agent) AS agen
  FROM per_agen p
 WHERE NOT EXISTS (
         SELECT 1 FROM yard_livery_map m
          WHERE m.match_type = 'PREFIX' AND m.active_flag = 'Y' AND m.match_value = p.prefix)
 GROUP BY prefix
 ORDER BY jumlah DESC;
*/

-- 4c. Contoh mendaftarkan merek baru (lihat SOP di README).
/*
INSERT INTO yard_livery (livery_code, brand_name, model_code, body_color, text_color, brand_text, logo_file, logo_pos, logo_scale, crt_by)
VALUES ('ONE_GP', 'Ocean Network Express', 'GP_CORRUGATED', '#C2255C', '#FFFFFF', 'ONE', 'one.png', 'LEFT', 0.50, 'NAMA_ADMIN');
INSERT INTO yard_livery_map (match_type, match_value, ctr_kind, livery_code, priority, crt_by)
VALUES ('PREFIX', 'ONEU', 'ANY', 'ONE_GP', 10, 'NAMA_ADMIN');
COMMIT;
*/

-- 4d. Menonaktifkan (BUKAN menghapus), supaya riwayat tetap ada.
/*
UPDATE yard_livery_map SET active_flag = 'N', upd_ts = SYSDATE, upd_by = 'NAMA_ADMIN'
 WHERE match_type = 'PREFIX' AND match_value = 'ONEU' AND ctr_kind = 'ANY';
COMMIT;
*/
