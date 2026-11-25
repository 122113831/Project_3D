'use client';

import { useEffect, useRef } from 'react';
import { emptyLayout, type YardLayout } from '@/lib/layout';
import type { YardSource } from '@/lib/types';
import { fetchSharedLayout, LayoutStale, saveSharedLayout } from '@/lib/yardApi';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';

/**
 * Menyambungkan tata letak editor dengan tabel YARD_LAYOUT.
 *
 * Inilah yang membuat suntingan — jalan, truk, RTG, tiang lampu — muncul sama
 * persis di PC dan akun lain. Sebelum ini semuanya berhenti di localStorage
 * peramban yang menyuntingnya, jadi orang kedua yang membuka aplikasi melihat
 * lapangan tanpa satu pun jalan yang pernah ditata.
 *
 * Tidak menggambar apa pun; dipasang sekali di halaman.
 *
 * Arahnya dua:
 *
 *   TARIK  saat halaman dibuka dan tiap kali sumber data berganti. Tata letak
 *          milik sumber lain tidak boleh ikut terbawa — blok A di database dan
 *          A01 di demo bukan blok yang sama.
 *   DORONG tiap kali tata letak berubah, ditunda 800 ms dan yang tertunda
 *          ditimpa. Menyeret satu blok memicu puluhan perubahan; tanpa
 *          penundaan itu berarti puluhan UPDATE untuk satu keputusan.
 *
 * Posisi dan sudut blok yang sungguh ada TIDAK lewat sini — itu tetap ditulis
 * ke CORE_YARD_BLOCK oleh persist.ts, karena di sanalah data itu tinggal.
 */
const PUSH_DELAY = 800;

export function LayoutSync() {
  const source = useYard((s) => s.source);

  /**
   * Tata letak yang sudah pasti sama dengan isi server.
   *
   * Dibandingkan berdasarkan identitas objek, bukan isi: store selalu membuat
   * objek baru tiap suntingan, jadi identitas sudah cukup — dan tanpa penjaga
   * ini, memasang hasil tarikan akan langsung terbaca sebagai perubahan dan
   * terdorong balik ke server tanpa henti.
   */
  const synced = useRef<YardLayout | null>(null);

  useEffect(() => {
    let alive = true;
    const { applyShared, setNote, switchSource } = useEditor.getState();

    // Pindah slot LEBIH DULU, sebelum jaringan disentuh. Tiap sumber punya
    // salinan lokalnya sendiri, jadi langkah ini sudah menampilkan tata letak
    // yang benar seketika — dan yang lebih penting, ia membuang tata letak
    // sumber sebelumnya. Tanpa itu, lapangan demo digambar memakai susunan blok
    // database selama permintaan ke server masih berjalan.
    switchSource(source);

    void (async () => {
      try {
        const shared = await fetchSharedLayout(source);
        if (!alive) return;

        if (shared.json) {
          const parsed = JSON.parse(shared.json) as YardLayout;
          const layout: YardLayout = { ...emptyLayout(), ...parsed, source };
          synced.current = layout;
          applyShared(layout, shared.revision);
          setNote(
            `Shared layout loaded (revision ${shared.revision}` +
              `${shared.updatedBy ? `, last by ${shared.updatedBy}` : ''}).`,
          );
          return;
        }

        // Belum ada baris untuk sumber ini. Kalau peramban ini punya salinan
        // lokal untuk sumber yang SAMA — switchSource sudah memasangnya, jadi
        // yang ada di store pasti milik sumber ini — salinan itulah yang
        // dinaikkan menjadi tata letak bersama. Suntingan yang sudah ada tidak
        // boleh hilang hanya karena tabelnya baru dibuat.
        const local = useEditor.getState().layout;
        if (local) {
          synced.current = local;
          await push(local, 0, source, synced);
          return;
        }

        // Tidak ada di server, tidak ada di peramban: lapangan digambar apa
        // adanya dari sumbernya sendiri.
        synced.current = null;
        applyShared(null, 0);
      } catch (e) {
        if (!alive) return;
        setNote(
          `Shared layout could not be loaded: ${e instanceof Error ? e.message : String(e)}. ` +
            'Showing the copy stored in this browser.',
        );
      }
    })();

    return () => {
      alive = false;
    };
  }, [source]);

  // --- dorong tiap perubahan --------------------------------------------------
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = useEditor.subscribe((state, prev) => {
      if (state.layout === prev.layout) return;
      // Hasil tarikan dari server, bukan suntingan: tidak perlu dikembalikan.
      if (state.layout === synced.current) return;
      const layout = state.layout;
      if (!layout) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void push({ ...layout, source }, useEditor.getState().revision, source, synced);
      }, PUSH_DELAY);
    });

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [source]);

  return null;
}

/** Satu penyimpanan ke server, dengan hasilnya dilaporkan ke panel editor. */
async function push(
  layout: YardLayout,
  baseRevision: number,
  source: YardSource,
  synced: { current: YardLayout | null },
) {
  const { setNote, setRevision } = useEditor.getState();
  try {
    const saved = await saveSharedLayout(source, layout, baseRevision);
    synced.current = useEditor.getState().layout;
    setRevision(saved.revision);
    setNote(`Layout saved for all users (revision ${saved.revision}).`);
  } catch (e) {
    if (e instanceof LayoutStale) {
      // Sengaja TIDAK menimpa dan tidak mencoba lagi: yang ada di server adalah
      // pekerjaan orang lain, dan menulisinya diam-diam persis yang ingin
      // dihindari. Pengguna yang memutuskan, dengan memuat ulang.
      setNote(e.message);
      return;
    }
    setNote(`Layout failed to save: ${e instanceof Error ? e.message : String(e)}`);
  }
}
