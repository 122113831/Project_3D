'use client';

import { useYard } from '@/store/useYard';
import { YARD_EXTENT_X, YARD_EXTENT_Z } from '@/lib/constants';

/**
 * Dua lampu saja: hemisphere untuk cahaya langit + satu directional sebagai
 * matahari. Tidak ada point light per tiang lampu — tiap light tambahan
 * menambah biaya di fragment shader untuk SETIAP piksel kontainer.
 */
export function Lighting() {
  const shadows = useYard((s) => s.options.shadows);
  const radius = Math.max(YARD_EXTENT_X, YARD_EXTENT_Z) * 0.62;

  return (
    <>
      {/* Warna bawah bukan lagi hampir hitam: di siang hari beton apron
          memantulkan cahaya hangat ke sisi bawah kontainer. */}
      <hemisphereLight args={['#dbeaff', '#b6ad97', 1.25]} />
      <directionalLight
        // Matahari pagi: elevasi ~37°, cukup rendah untuk memberi bayangan
        // panjang tapi masih menerangi lorong di antara blok.
        position={[YARD_EXTENT_X * 0.5, 400, -YARD_EXTENT_Z * 0.85]}
        intensity={1.95}
        color="#fff2de"
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-camera-left={-radius}
        shadow-camera-right={radius}
        shadow-camera-top={radius}
        shadow-camera-bottom={-radius}
        shadow-camera-near={50}
        shadow-camera-far={1400}
      />
      {/* Fill lembut dari arah berlawanan supaya sisi bayangan tidak mati total. */}
      <directionalLight position={[-300, 160, 400]} intensity={0.42} color="#c3d6ee" />
    </>
  );
}
