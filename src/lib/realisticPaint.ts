/**
 * Cat asli kontainer realistis: abu-abu Maersk (sRGB), sesuai foto acuan.
 * Dipisah dari realisticContainer.ts supaya palette.ts bisa memakainya tanpa
 * ikut menarik three.js dan canvas. Juga dipakai level jauh saat pewarnaan
 * dimatikan, jadi pergantian LOD tidak berganti warna.
 */
export const REAL_PAINT = '#a3a6a9';

/** Cat asli reefer realistis: putih panel reefer (sRGB), sesuai gambar acuan. */
export const REAL_REEFER_PAINT = '#e3e6e8';
