import oracledb from 'oracledb';
import { DWELL_ALERT_DAYS } from './constants';
import { borrowConnection } from './depot';

/**
 * Indikator operasional dari database depot, untuk panel KPI.
 *
 * Semua angka dihitung di Oracle, bukan di JavaScript: tabelnya ratusan baris
 * sekarang tapi bisa jutaan di produksi, dan menarik semuanya ke server
 * hanya untuk menghitung rata-rata adalah cara pasti membuat panel ini
 * menjadi bagian paling lambat dari aplikasi.
 *
 * Tabel yang dipakai dan apa yang diambil darinya:
 *   GATE_HIST  — arus gerbang per jam/hari, truk di dalam lapangan sekarang
 *                (gate in tanpa gate out), turnaround gate in → gate out.
 *   CONTAINER  — dwell time (RECEIV_DATE → DELIV_DATE) dan umur kontainer yang
 *                masih di lapangan (lewat YARD_ROWTIER).
 *   JOB_ORDER  — job order yang belum selesai dan belum kedaluwarsa.
 */
export type YardKpi = {
  at: string;
  /** Truk yang sudah gate in dan belum gate out. */
  trucksInside: number;
  gateToday: { in: number; out: number };
  /** 24 jam terakhir, per jam, terlama lebih dulu. */
  perHour: { hour: string; in: number; out: number }[];
  /** 7 hari terakhir, per hari, terlama lebih dulu. */
  perDay: { day: string; in: number; out: number }[];
  /** Menit, rata-rata 7 hari terakhir; null kalau belum ada yang lengkap. */
  turnaroundMin: number | null;
  /** Hari, rata-rata kontainer yang keluar 30 hari terakhir. */
  dwellDays: number | null;
  /** Hari, rata-rata umur kontainer yang masih di lapangan. */
  ageDays: number | null;
  /** Kontainer di lapangan yang umurnya melewati DWELL_ALERT_DAYS. */
  overdue: number;
  overdueDays: number;
  jobsOpen: number;
};

type Row = Record<string, unknown>;

export async function readKpi(): Promise<YardKpi> {
  const c = await borrowConnection();
  const q = async (sql: string): Promise<Row[]> => {
    const r = await c.execute<Row>(sql, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    return r.rows ?? [];
  };
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  try {
    const [inside] = await q(
      `SELECT COUNT(*) AS n FROM gate_hist WHERE gati_dt IS NOT NULL AND gato_dt IS NULL`,
    );
    const [today] = await q(
      `SELECT SUM(CASE WHEN TRUNC(gati_dt) = TRUNC(SYSDATE) THEN 1 ELSE 0 END) AS gin,
              SUM(CASE WHEN TRUNC(gato_dt) = TRUNC(SYSDATE) THEN 1 ELSE 0 END) AS gout
         FROM gate_hist`,
    );
    // Per jam: dua kueri kecil digabung di JavaScript menurut kunci jamnya —
    // lebih sederhana daripada FULL OUTER JOIN untuk 24 baris.
    const hourIn = await q(
      `SELECT TO_CHAR(TRUNC(gati_dt,'HH24'),'YYYY-MM-DD"T"HH24') AS h, COUNT(*) AS n
         FROM gate_hist WHERE gati_dt >= SYSDATE - 1 GROUP BY TRUNC(gati_dt,'HH24')`,
    );
    const hourOut = await q(
      `SELECT TO_CHAR(TRUNC(gato_dt,'HH24'),'YYYY-MM-DD"T"HH24') AS h, COUNT(*) AS n
         FROM gate_hist WHERE gato_dt >= SYSDATE - 1 GROUP BY TRUNC(gato_dt,'HH24')`,
    );
    const dayIn = await q(
      `SELECT TO_CHAR(TRUNC(gati_dt),'YYYY-MM-DD') AS d, COUNT(*) AS n
         FROM gate_hist WHERE gati_dt >= TRUNC(SYSDATE) - 6 GROUP BY TRUNC(gati_dt)`,
    );
    const dayOut = await q(
      `SELECT TO_CHAR(TRUNC(gato_dt),'YYYY-MM-DD') AS d, COUNT(*) AS n
         FROM gate_hist WHERE gato_dt >= TRUNC(SYSDATE) - 6 GROUP BY TRUNC(gato_dt)`,
    );
    const [turn] = await q(
      `SELECT AVG((gato_dt - gati_dt) * 24 * 60) AS m
         FROM gate_hist WHERE gati_dt >= SYSDATE - 7 AND gato_dt IS NOT NULL AND gato_dt >= gati_dt`,
    );
    const [dwell] = await q(
      `SELECT AVG(deliv_date - receiv_date) AS d
         FROM container WHERE deliv_date >= SYSDATE - 30 AND receiv_date IS NOT NULL AND deliv_date >= receiv_date`,
    );
    const [age] = await q(
      `SELECT AVG(SYSDATE - k.receiv_date) AS d,
              SUM(CASE WHEN SYSDATE - k.receiv_date > ${DWELL_ALERT_DAYS} THEN 1 ELSE 0 END) AS late
         FROM container k
        WHERE k.receiv_date IS NOT NULL
          AND k.ctr_key IN (SELECT DISTINCT container_key FROM yard_rowtier WHERE container_key IS NOT NULL)`,
    );
    const [jobs] = await q(
      `SELECT COUNT(*) AS n FROM job_order
        WHERE NVL(TRIM(complete_yn),'N') <> 'Y'
          AND (expired_date IS NULL OR expired_date >= TRUNC(SYSDATE))`,
    );

    // Deret jam dan hari dibuat LENGKAP — jam tanpa arus tetap ada sebagai 0,
    // supaya grafik batangnya tidak melompati waktu yang sepi.
    const now = new Date();
    const hourKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const mapOf = (rows: Row[], k: string) => new Map(rows.map((r) => [String(r[k]), Number(r.N)]));
    const hi = mapOf(hourIn, 'H');
    const ho = mapOf(hourOut, 'H');
    const di = mapOf(dayIn, 'D');
    const dout = mapOf(dayOut, 'D');
    const perHour = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getTime() - (23 - i) * 3_600_000);
      const k = hourKey(d);
      return { hour: k, in: hi.get(k) ?? 0, out: ho.get(k) ?? 0 };
    });
    const perDay = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now.getTime() - (6 - i) * 86_400_000);
      const k = dayKey(d);
      return { day: k, in: di.get(k) ?? 0, out: dout.get(k) ?? 0 };
    });

    return {
      at: now.toISOString(),
      trucksInside: Number(inside?.N ?? 0),
      gateToday: { in: Number(today?.GIN ?? 0), out: Number(today?.GOUT ?? 0) },
      perHour,
      perDay,
      turnaroundMin: n(turn?.M),
      dwellDays: n(dwell?.D),
      ageDays: n(age?.D),
      overdue: Number(age?.LATE ?? 0),
      overdueDays: DWELL_ALERT_DAYS,
      jobsOpen: Number(jobs?.N ?? 0),
    };
  } finally {
    await c.close();
  }
}
