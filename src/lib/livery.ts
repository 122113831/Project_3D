/**
 * Livery kontainer: tampilan per pemilik kontainer (cat, teks merek, logo).
 *
 * Sumbernya master YARD_LIVERY + YARD_LIVERY_MAP (scripts/sql/yard_livery.sql),
 * dibaca lewat /api/yard/livery. Kuncinya PREFIX nomor kontainer (kode pemilik
 * ISO 6346), agen hanya cadangan, lalu DEFAULT per jenis — urutan yang sama
 * persis dengan query 4a di berkas SQL itu.
 *
 * Murni (tanpa three.js / React) supaya bisa dipakai server, klien, dan uji.
 */

import seed from './livery-seed.json';

export type LiveryModel = 'GP_CORRUGATED' | 'REEFER_PANEL' | 'TANK';
export type LiveryKind = 'GP' | 'REEFER' | 'TANK';

export type Livery = {
  code: string;
  brand: string;
  model: LiveryModel;
  bodyColor: string;
  textColor: string;
  brandText: string | null;
  logoFile: string | null;
  logoPos: 'LEFT' | 'RIGHT' | 'CENTER' | 'NONE';
  logoScale: number;
};

export type LiveryRule = {
  type: 'PREFIX' | 'AGENT' | 'DEFAULT';
  value: string;
  kind: LiveryKind | 'ANY';
  livery: string;
  priority: number;
};

export type LiverySet = {
  liveries: Livery[];
  rules: LiveryRule[];
  /** 'db' = dari master Oracle, 'fallback' = bawaan kode (demo / tabel belum ada). */
  source: 'db' | 'fallback';
};

/**
 * Livery yang logonya digambar di kode, bukan dari berkas: bintang Maersk
 * (cadangan bila belum ada berkas). Livery lain memakai logo_file di
 * public/liveries/ (atau tanpa logo).
 */
export const BUILTIN_LOGO: Record<string, 'maersk-star'> = { MAERSK_GP: 'maersk-star' };

/**
 * Livery dengan tata letak dinding samping khusus yang digambar di kode dan
 * MENGGANTIKAN logo berkas: SPIL = pita putih tegak dekat pintu berisi huruf
 * S-P-I-L merah, plus alamat web di atas. MERATUS = tulisan putih + simbol
 * roda di pita atas dinding (logo berkasnya navy, tidak cocok di badan biru).
 * Keduanya sesuai foto kontainer asli.
 */
export const SIDE_LAYOUT: Record<
  string,
  'spil-stripe' | 'tanto-stripe' | 'ctp-stripe' | 'meratus-top' | 'kline-center' | 'seaco-top' | 'seaco-reefer' | 'cmacgm-center' | 'rcl-text'
> = {
  // RCL: "R C L" putih serif besar berjarak lebar (foto kontainer asli).
  RCL_GP: 'rcl-text',
  // CMA CGM: "CMA CGM" putih tebal di tengah + dua sapuan putih (foto asli).
  CMACGM_GP: 'cmacgm-center',
  // SEACO reefer: "seaco" merah besar di kiri atas badan putih.
  SEACO_REEFER: 'seaco-reefer',
  // Reefer agen lain memakai tata letak GP-nya, dengan warna dari livery
  // reefer (badan putih, tulisan berwarna merek).
  SPIL_REEFER: 'spil-stripe',
  TANTO_REEFER: 'tanto-stripe',
  CTP_REEFER: 'ctp-stripe',
  MERATUS_REEFER: 'meratus-top',
  KLINE_REEFER: 'kline-center',
  // CTP: pita putih berlambang bulat + huruf C-T-P navy (seperti Tanto).
  CTP_GP: 'ctp-stripe',
  // SEACO: "seaco" kuning huruf kecil di kiri atas badan navy.
  SEACO_GP: 'seaco-top',
  // K LINE: “K” LINE putih serif di tengah, bendera kecil, kode ukuran, web.
  KLINE_GP: 'kline-center',
  SPIL_GP: 'spil-stripe',
  // TANTO: pita putih yang sama, berisi bendera dari berkas logo + huruf navy.
  TANTO_GP: 'tanto-stripe',
  MERATUS_GP: 'meratus-top',
};

const L = (
  code: string,
  brand: string,
  model: LiveryModel,
  bodyColor: string,
  textColor: string,
  brandText: string | null,
  logoPos: Livery['logoPos'],
  logoScale = 0.5,
  logoFile: string | null = null,
): Livery => ({ code, brand, model, bodyColor, textColor, brandText, logoFile, logoPos, logoScale });

/**
 * Cadangan kalau master tidak terbaca (sumber demo, atau tabel belum dibuat).
 * Isinya sama dengan data awal di yard_livery.sql.
 */
/**
 * logo null = tanpa berkas (tampilan digambar di kode, lihat SIDE_LAYOUT).
 * model/kind opsional: default GP bergelombang dengan aturan prefix jenis GP.
 */
type SeedLivery = {
  code: string;
  brand: string;
  model?: LiveryModel;
  kind?: LiveryKind;
  body: string;
  text: string;
  logo: string | null;
  scale: number;
  prefixes: string[];
};

/**
 * Cadangan kalau master tidak terbaca (sumber demo, atau tabel belum dibuat).
 * Merek bermerek dibaca dari livery-seed.json — berkas yang SAMA dengan yang
 * dipakai scripts/seed-livery-logos.mjs untuk mengisi master, jadi keduanya
 * tidak bisa berbeda. Logo berkas sudah memuat tulisan merek: brandText null.
 */
export const FALLBACK_LIVERIES: LiverySet = {
  source: 'fallback',
  liveries: [
    ...(seed.liveries as SeedLivery[]).map((x) =>
      L(x.code, x.brand, x.model ?? 'GP_CORRUGATED', x.body, x.text, null, 'LEFT', x.scale, x.logo),
    ),
    L('GENERIC_GP', 'Polos (tanpa merek)', 'GP_CORRUGATED', '#8D949C', '#1C1E20', null, 'NONE'),
    L('GENERIC_REEFER', 'Reefer polos', 'REEFER_PANEL', '#E3E6E8', '#1C1E20', null, 'NONE'),
  ],
  rules: [
    ...(seed.liveries as SeedLivery[]).flatMap((x) =>
      x.prefixes.map((value): LiveryRule => ({ type: 'PREFIX', value, kind: x.kind ?? 'GP', livery: x.code, priority: 10 })),
    ),
    { type: 'DEFAULT', value: '*', kind: 'GP', livery: 'GENERIC_GP', priority: 999 },
    { type: 'DEFAULT', value: '*', kind: 'REEFER', livery: 'GENERIC_REEFER', priority: 999 },
  ],
};

/** Jenis kontainer untuk pencocokan — aturan yang sama dengan pemilih model renderer. */
export function liveryKind(c: { type: string; status: string }): LiveryKind {
  if (c.type === 'tank') return 'TANK';
  return c.status === 'reefer' ? 'REEFER' : 'GP';
}

export type LiveryResolver = (c: { no: string; line: string; type: string; status: string }) => Livery | null;

/**
 * Pembuat fungsi pencarian livery. Indeks dibangun sekali, jadi pencarian per
 * kontainer cukup beberapa lookup Map.
 *
 * Urutan: PREFIX+jenis, PREFIX+ANY, AGENT+jenis, AGENT+ANY, DEFAULT+jenis.
 * Di dalam satu tingkat, priority terkecil menang. Livery yang tidak ada di
 * daftar (mis. dinonaktifkan) dilewati, tidak membuat kontainer tanpa tampilan.
 */
export function makeResolver(set: LiverySet): LiveryResolver {
  const byCode = new Map(set.liveries.map((l) => [l.code, l]));
  const index = new Map<string, LiveryRule[]>();
  for (const r of set.rules) {
    if (!byCode.has(r.livery)) continue;
    const key = `${r.type}|${r.value.toUpperCase()}|${r.kind}`;
    const list = index.get(key) ?? [];
    list.push(r);
    list.sort((a, b) => a.priority - b.priority);
    index.set(key, list);
  }
  const pick = (type: LiveryRule['type'], value: string, kind: string) =>
    index.get(`${type}|${value}|${kind}`)?.[0];

  return (c) => {
    const kind = liveryKind(c);
    const prefix = c.no.trim().toUpperCase().slice(0, 4);
    const agent = c.line.trim().toUpperCase();
    const rule =
      pick('PREFIX', prefix, kind) ??
      pick('PREFIX', prefix, 'ANY') ??
      pick('AGENT', agent, kind) ??
      pick('AGENT', agent, 'ANY') ??
      pick('DEFAULT', '*', kind);
    return rule ? byCode.get(rule.livery)! : null;
  };
}

/** Kunci cache untuk satu livery: berubah kalau isinya diubah di master. */
export const liveryKey = (l: Livery) =>
  [l.code, l.bodyColor, l.textColor, l.brandText ?? '', l.logoFile ?? '', l.logoPos, l.logoScale].join('|');
