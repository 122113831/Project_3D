import type { ColorMode, ContainerStatus, ContainerType, YardContainer } from './types';

/** Warna badan kontainer per shipping line — mendekati livery aslinya. */
export const LINE_COLOR: Record<string, string> = {
  MSC: '#d8a520',
  MAERSK: '#3aa0dc',
  CMACGM: '#1f4fa8',
  EVERGREEN: '#2f8f5b',
  ONE: '#c2255c',
  COSCO: '#c0392b',
  HAPAG: '#e07b2a',
  OOCL: '#4a5568',
  SPIL: '#2b7a78',
  TEMAS: '#8e44ad',
};

export const STATUS_COLOR: Record<ContainerStatus, string> = {
  full: '#3f6ea8',
  empty: '#8d949c',
  reefer: '#e8eaed',
  dangerous: '#e08b1f',
  damaged: '#b03535',
};

export const TYPE_LABEL: Record<ContainerType, string> = {
  gp: 'GP (box)',
  tank: 'Tank',
};

export const STATUS_LABEL: Record<ContainerStatus, string> = {
  full: 'Isi (full)',
  empty: 'Kosong (empty)',
  reefer: 'Reefer',
  dangerous: 'Dangerous goods',
  damaged: 'Rusak',
};

const SIZE_COLOR: Record<number, string> = {
  20: '#4b8bbe',
  40: '#c9762f',
};

const TIER_COLOR = ['#2f5d8a', '#3d7fa8', '#57a0a0', '#89b56a', '#d6c04a'];

/** Warna kontainer yang tidak lolos filter — tetap terlihat sebagai konteks. */
export const GHOST_COLOR = '#8f959c';

/**
 * Warna asli tiap aset kontainer, dipakai saat pewarnaan dimatikan.
 *
 * HANYA dipakai level jauh. Level dekat memakai varian model tanpa normalisasi,
 * jadi ia menampilkan tekstur dan warna asetnya sendiri — termasuk aset yang
 * catnya lebih dari satu warna, seperti tank bertabung putih berangka biru
 * pekat. Satu nilai warna tidak akan pernah bisa menampilkan yang seperti itu;
 * kotak prosedural level jauh memang cuma bisa satu warna.
 *
 * Angka-angka ini dibaca dari berkas GLB-nya, dan CARA membacanya penting:
 * yang diambil adalah warna yang paling SERING muncul di antara separuh piksel
 * paling terang, bukan rata-rata seluruh tekstur. Rata-rata selalu meleset
 * karena ikut menghitung bayangan, korugasi, dan garis sambungan — percobaan
 * pertama memakai rata-rata dan menghasilkan GP #3c4457, padahal catnya
 * sebenarnya #333d55, lebih gelap dan lebih pekat.
 *
 * Hasil bacaan: GP #333d55 (biru tua), reefer #d8d3c8 (krem), tank #fefcfd
 * (putih). Nilai di bawah sudah DIBAGI TARGET_LINEAR, karena material level
 * jauh kini disetel ke tingkat terang itu dan instanceColor adalah PENGALI.
 *
 * Kalau asetnya diganti, angka ini harus dibaca ulang dari berkas barunya.
 */
export const ASSET_COLOR = {
  gp: '#38425c',
  reefer: '#e8e3d7',
  tank: '#ffffff',
} as const;

/** Warna kontainer terpilih / hasil pencarian. */
export const HIGHLIGHT_COLOR = '#ffe066';

/**
 * Warna untuk kode line yang tidak ada di LINE_COLOR.
 *
 * Data depot memakai kode agennya sendiri (RCL, HDK, SST, ZIM). Tanpa ini
 * semuanya jatuh ke satu abu-abu dan mode pewarnaan "line" jadi tidak berguna.
 * Hue diturunkan dari kodenya sendiri, jadi warnanya stabil antar-muat.
 */
function hueFromCode(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 58%, 55%)`;
}

export const colorForLine = (code: string): string => LINE_COLOR[code] ?? hueFromCode(code);

export function colorFor(c: YardContainer, mode: ColorMode): string {
  switch (mode) {
    case 'none':
      // Aturan pemilihan aset yang sama dengan renderer: reefer itu STATUS,
      // bukan jenis. Kalau dipisah, kontainer bisa memakai warna aset yang
      // bukan miliknya.
      return c.type === 'tank'
        ? ASSET_COLOR.tank
        : c.status === 'reefer'
          ? ASSET_COLOR.reefer
          : ASSET_COLOR.gp;
    case 'line':
      return colorForLine(c.line);
    case 'status':
      return STATUS_COLOR[c.status];
    case 'size':
      return SIZE_COLOR[c.size];
    case 'tier':
      return TIER_COLOR[Math.min(c.tier - 1, TIER_COLOR.length - 1)];
  }
}

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  none: 'Tanpa warna',
  line: 'Shipping line',
  status: 'Status',
  size: 'Ukuran',
  tier: 'Tier',
};
