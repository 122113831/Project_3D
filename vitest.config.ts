import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Uji otomatis untuk modul yang murni perhitungan — roadGraph, roadSnap,
 * liveEvents. Tidak ada DOM, tidak ada WebGL, tidak ada database: yang diuji
 * adalah logika yang setiap suntingan tata letak dan setiap pesan broker
 * bergantung padanya.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
