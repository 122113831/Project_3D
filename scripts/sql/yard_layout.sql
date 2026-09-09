-- Tata letak lapangan hasil suntingan editor, dipakai bersama semua pengguna.
--
-- Kenapa satu kolom JSON dan bukan tabel per jenis objek: yang disimpan di sini
-- BUKAN data operasional. Blok yang sungguh ada tetap tinggal di
-- CORE_YARD_BLOCK — posisi, sudut, dan lajur truknya ditulis ke sana, bukan ke
-- sini. Yang tersisa untuk tabel ini adalah lapisan tampilan: ubin jalan, truk,
-- RTG, tiang lampu, gate. Tidak ada satu pun yang di-query per baris, tidak ada
-- yang di-join, dan bentuknya masih berubah mengikuti editor. Memecahnya
-- menjadi tiga tabel berarti tiga migrasi setiap kali editor menambah satu
-- properti, tanpa satu pun query yang diuntungkan.
--
-- Satu baris per sumber data: 'DEPOT' untuk lapangan sungguhan, 'DEMO' untuk
-- lapangan bangkitan. Keduanya lapangan yang berbeda — blok A di database dan
-- A01 di demo tidak ada hubungannya — jadi tata letaknya tidak boleh berebut
-- satu baris yang sama.
CREATE TABLE yard_layout (
  layout_code  VARCHAR2(30)  NOT NULL,
  layout_json  CLOB          NOT NULL,
  -- Naik satu tiap penyimpanan. Klien mengirim revisi yang jadi dasar
  -- suntingannya; kalau sudah tidak cocok, penyimpanan ditolak alih-alih
  -- diam-diam menimpa pekerjaan orang lain.
  revision     NUMBER(10)    DEFAULT 1 NOT NULL,
  crt_ts       DATE,
  crt_by       VARCHAR2(100),
  upd_ts       DATE,
  upd_by       VARCHAR2(100),
  CONSTRAINT pk_yard_layout PRIMARY KEY (layout_code),
  -- Kolomnya CLOB, jadi apa pun bisa masuk. Ini yang menjaga isinya tetap JSON.
  CONSTRAINT ck_yard_layout_json CHECK (layout_json IS JSON)
);

COMMENT ON TABLE  yard_layout IS 'Tata letak lapangan 3D (jalan, alat, blok) hasil editor yard_3d';
COMMENT ON COLUMN yard_layout.layout_code IS 'Sumber data yang dilayani: DEPOT atau DEMO';
COMMENT ON COLUMN yard_layout.layout_json IS 'YardLayout apa adanya — blocks, roads, equipment';
COMMENT ON COLUMN yard_layout.revision    IS 'Naik tiap simpan, dipakai menolak penyimpanan basi';
