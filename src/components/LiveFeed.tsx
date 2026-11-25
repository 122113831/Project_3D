'use client';

import { useEffect } from 'react';
import type { LiveEvent } from '@/lib/liveEvents';
import { fetchGateTrips } from '@/lib/yardApi';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';

/**
 * Menyambungkan aliran kejadian gate (SSE dari /api/yard/events) ke animasi
 * truk. Tidak menggambar apa pun; dipasang sekali di halaman.
 *
 * Tiga hal yang diurusnya, dan ketiganya soal KEADAAN, bukan sekadar pesan:
 *
 *   1. Saat tersambung, perjalanan yang sudah gate in tapi belum gate out
 *      ditarik dari GATE_HIST dan dimasukkan lebih dulu — truk yang seharusnya
 *      sedang ada di lapangan muncul tanpa menunggu pesan berikutnya.
 *   2. Setiap pesan masuk lewat satu pintu yang sama dengan pemutar ulang:
 *      useTraffic.ingest. Animasinya tidak tahu pesan itu dari HiveMQ, dari
 *      POST, atau dari pemutar ulang.
 *   3. Status koneksi dilaporkan ke HUD — tersambung, menyambung ulang, atau
 *      broker belum diatur — supaya operator tahu yang dilihatnya memang
 *      keadaan sekarang.
 *
 * EventSource menyambung ulang sendiri saat putus; pesan yang terlewat selama
 * putus dipulihkan dengan menarik ulang perjalanan terbuka saat tersambung
 * kembali.
 */
export function LiveFeed() {
  const source = useYard((s) => s.source);

  useEffect(() => {
    // Aliran langsung hanya berarti untuk lapangan sungguhan.
    if (source !== 'depot') {
      useTraffic.getState().setLive({ state: 'off' });
      return;
    }

    const { ingest, setLive } = useTraffic.getState();
    let alive = true;
    setLive({ state: 'connecting', error: null });

    /** Perjalanan terbuka dari database — keadaan awal sebelum pesan pertama. */
    const backfill = async () => {
      try {
        const open = await fetchGateTrips(100, true);
        if (!alive) return;
        for (const r of open) {
          const base = { jobNo: r.jobNo, ctrNo: r.ctrNo, truckNo: r.truckNo, flow: r.flow, equipment: r.equipment };
          ingest({ ...base, kind: 'GATE_IN', gateNo: r.gateInNo, at: r.gateIn });
          if (r.handled) ingest({ ...base, kind: 'HANDLED', at: r.handled });
        }
      } catch (e) {
        setLive({ error: e instanceof Error ? e.message : String(e) });
      }
    };

    const es = new EventSource('/api/yard/events');
    es.onopen = () => {
      setLive({ state: 'live', error: null });
      void backfill();
    };
    es.onerror = () => {
      // EventSource menyambung ulang sendiri; cukup laporkan keadaannya.
      setLive({ state: 'reconnecting' });
    };
    es.addEventListener('status', (ev) => {
      try {
        const s = JSON.parse((ev as MessageEvent).data);
        setLive({ mqtt: s.mqtt, received: s.received, lastAt: s.lastAt, error: s.lastError ?? null });
      } catch {
        // status yang rusak tidak perlu menghentikan apa pun
      }
    });
    const onTrip = (ev: Event) => {
      try {
        ingest(JSON.parse((ev as MessageEvent).data) as LiveEvent);
      } catch {
        setLive({ error: 'event message could not be read' });
      }
    };
    // `recent`: kejadian yang baru lewat sebelum peramban ini tersambung.
    es.addEventListener('recent', onTrip);
    es.addEventListener('trip', onTrip);

    return () => {
      alive = false;
      es.close();
      setLive({ state: 'off' });
    };
  }, [source]);

  return null;
}
