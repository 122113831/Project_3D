'use client';

import { applyLayout, type YardLayout } from '@/lib/layout';
import type { YardData } from '@/lib/types';
import { useEditor } from './useEditor';
import { useYard } from './useYard';

/**
 * Data lapangan seperti yang HARUS DIGAMBAR: isi database, ditimpa tata letak
 * hasil suntingan editor kalau ada.
 *
 * Hasilnya di-cache pada pasangan (data, layout) di tingkat modul, bukan lewat
 * useMemo per komponen. Sembilan komponen memakai data ini; dengan useMemo,
 * `applyLayout` akan berjalan sembilan kali untuk masukan yang sama DAN tiap
 * komponen menerima identitas objek yang berbeda — yang membatalkan memoisasi
 * di bawahnya, seperti pemisahan kontainer per kelompok di YardContainers.
 */
let cachedData: YardData | null = null;
let cachedLayout: YardLayout | null = null;
let cachedResult: YardData | null = null;

export function useYardView(): YardData | null {
  const data = useYard((s) => s.data);
  const layout = useEditor((s) => s.layout);

  if (data !== cachedData || layout !== cachedLayout) {
    cachedData = data;
    cachedLayout = layout;
    cachedResult = data ? applyLayout(data, layout) : null;
  }
  return cachedResult;
}
