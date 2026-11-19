import { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { disposeCodes, withCodes } from '@/lib/containerCode';

/** Jeda sebelum salinan lama dibuang: pastikan mesh sudah memakai yang baru. */
const DISPOSE_DELAY_MS = 1000;

/**
 * Geometri berkode nomor kontainer (containerCode.withCodes) untuk satu mesh,
 * dengan siklus hidup yang aman.
 *
 * Kenapa bukan useMemo + cleanup useEffect: di mode dev React StrictMode
 * menjalankan efek dua kali saat mount (efek → cleanup → efek). Dengan useMemo,
 * cleanup palsu itu membuang salinan yang MASIH dipakai mesh — atribut posisi/
 * normal/UV-nya dilepas, lapisan cat tidak tergambar, dan yang tersisa hanya
 * kotak dalam yang gelap: seluruh kontainer tampak HITAM.
 *
 * Di sini salinan dibuat DI DALAM efek dan disimpan di state, jadi salinan
 * yang dibuang cleanup palsu tidak pernah dirender. Pembuangan salinan lama
 * ditunda sampai mesh dipastikan sudah memakai salinan barunya.
 *
 * Selama salinan pertama belum siap (satu frame), geometri dasar dipakai —
 * kontainernya sudah tampak, nomornya menyusul.
 */
export function useCodedGeometry(
  base: THREE.BufferGeometry,
  items: readonly { no: string; iso: string }[] | null,
): THREE.BufferGeometry {
  const [coded, setCoded] = useState<{ base: THREE.BufferGeometry; geo: THREE.BufferGeometry } | null>(null);

  useEffect(() => {
    if (!items) {
      setCoded(null);
      return;
    }
    const geo = withCodes(base, items);
    setCoded({ base, geo });
    return () => {
      setTimeout(() => disposeCodes(geo), DISPOSE_DELAY_MS);
    };
  }, [base, items]);

  // Salinan milik geometri dasar lain (model berganti) tidak boleh dipakai.
  return items && coded && coded.base === base ? coded.geo : base;
}
