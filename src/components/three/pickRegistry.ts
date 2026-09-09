import type * as THREE from 'three';
import type { YardBlock, YardContainer } from '@/lib/types';

/**
 * Registry mesh yang bisa diklik.
 *
 * Kenapa tidak pakai onClick milik R3F? Karena begitu sebuah objek punya
 * event handler, R3F ikut me-raycast objek itu pada SETIAP pointermove untuk
 * mengurus hover. Raycast InstancedMesh menguji seluruh instance satu per
 * satu — dengan puluhan ribu kontainer, gerakan mouse saja sudah bikin patah.
 *
 * Jadi picking dilakukan manual: hanya saat klik, dan hanya sekali.
 */
export type PickEntry = {
  mesh: THREE.InstancedMesh;
  block: YardBlock;
  items: YardContainer[];
};

const registry = new Set<PickEntry>();

export function registerPickable(entry: PickEntry) {
  registry.add(entry);
  return () => {
    registry.delete(entry);
  };
}

export const pickables = () => registry;
