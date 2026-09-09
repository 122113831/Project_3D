import { savePlacement } from './yardApi';
import { radToDeg, worldToMap } from './mapCoords';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';

/**
 * Menyimpan posisi dan sudut blok ke database setelah digeser atau diputar.
 *
 * Hanya blok yang MEMANG ADA di CORE_YARD_BLOCK yang dikirim. Blok yang cuma
 * hidup di tata letak lokal — dibuat lewat palet, bukan lewat dialog "blok
 * baru" — sengaja dilewati: menulis posisi untuk baris yang tidak ada hanya
 * akan menghasilkan galat "blok tidak ditemukan" tiap kali digeser.
 *
 * Penulisan ditunda sebentar dan yang tertunda ditimpa. Memutar blok itu satu
 * ketukan tombol per 15 derajat, jadi satu putaran penuh tanpa penundaan
 * berarti 24 UPDATE untuk satu keputusan yang sama.
 */

const DELAY = 500;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function persistBlockPlacement(id: string) {
  const timer = pending.get(id);
  if (timer) clearTimeout(timer);

  pending.set(
    id,
    setTimeout(() => {
      pending.delete(id);
      void run(id);
    }, DELAY),
  );
}

async function run(id: string) {
  const { layout, setNote } = useEditor.getState();
  const data = useYard.getState().data;
  const transform = data?.meta.mapTransform ?? null;

  // Lapangan demo tidak punya baris di CORE_YARD_BLOCK. Kode bloknya sendiri
  // (A01, B01, …) ada di data demo, jadi pemeriksaan `known` di bawah akan
  // meloloskannya dan endpoint tulis menjawab "blok tidak ditemukan" tiap kali
  // sebuah blok digeser — galat yang tidak menandakan apa pun kecuali bahwa
  // yang sedang ditata memang bukan lapangan sungguhan.
  if (data?.meta.source !== 'depot') return;

  const block = layout?.blocks.find((b) => b.id === id);
  if (!block || !transform) return;

  // Ada di database? Kalau tidak, ini blok lokal dan tidak ada yang diperbarui.
  const known = data?.blocks.some((b) => b.id.trim().toUpperCase() === id.trim().toUpperCase());
  if (!known) return;

  try {
    const { mapX, mapY } = worldToMap(transform, block);
    await savePlacement({
      code: id.trim().toUpperCase(),
      mapX,
      mapY,
      rotDeg: radToDeg(block.rot ?? 0),
      truckLane: block.truckLane ?? 'L',
      slotStart: block.slotStart ?? 'L',
    });
    setNote(`Posisi blok ${id} tersimpan.`);
  } catch (e) {
    setNote(`Gagal menyimpan posisi blok ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
