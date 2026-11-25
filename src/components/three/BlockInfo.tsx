"use client";

import { useMemo } from "react";
import { Html } from "@react-three/drei";
import { BOX, PITCH } from "@/lib/constants";
import { aroundBlock, blockOccupancy } from "@/lib/yard";
import { nf } from "@/components/hud/ui";
import { useYard } from "@/store/useYard";
import { useYardView } from "@/store/useYardView";

/**
 * Papan kapasitas di atas tiap blok: persen terisi dan sisa box.
 *
 * Satu elemen DOM per BLOK — paling banyak beberapa puluh — jadi aman, beda
 * dengan nomor kontainer yang harus dibatasi ketat (lihat NearbyLabels).
 * Ukurannya tetap di layar, bukan ikut jarak kamera: papan ini justru paling
 * berguna saat seluruh lapangan terlihat, dan di jarak itu teks yang ikut
 * mengecil sudah tidak terbaca.
 *
 * Isinya ikut berubah sendiri saat truk menaruh atau mengangkat kontainer,
 * karena dihitung dari lapangan yang sedang tampil.
 */
export function BlockInfo() {
  const data = useYardView();
  const enabled = useYard((s) => s.options.blockInfo);

  const boards = useMemo(() => {
    if (!data) return [];
    return data.blocks.map((b) => {
      const length = b.slots * PITCH.teu;
      // Di atas ujung awal blok, tempat kode bloknya dicat, sedikit lebih
      // tinggi dari tumpukan penuh supaya tidak tenggelam di antara kontainer.
      const [x, z] = aroundBlock(b, -length / 2 + PITCH.teu, 0);
      return {
        id: b.id,
        x,
        y: b.tiers * BOX.height + 4,
        z,
        ...blockOccupancy(b),
      };
    });
  }, [data]);

  if (!enabled) return null;

  return (
    <>
      {boards.map((o) => {
        const tone =
          o.pct >= 95
            ? "bg-red-400"
            : o.pct >= 80
              ? "bg-amber-400"
              : "bg-sky-400";
        return (
          <Html
            key={o.id}
            position={[o.x, o.y, o.z]}
            center
            zIndexRange={[3, 0]}
          >
            {/* Satu baris saja: di pandangan lebar, blok yang bersebelahan hanya
                berjarak beberapa puluh piksel di layar, dan papan dua-tiga
                baris saling menumpuk. */}
            <div
              className="pointer-events-none flex select-none items-center gap-1.5 whitespace-nowrap rounded-full border border-white/15 bg-slate-950/80 px-2 py-0.5 text-[11px] text-slate-100 shadow-lg"
              title={`${nf(o.boxes)} ${o.boxes === 1 ? "box" : "boxes"} · ${nf(o.used)}/${nf(o.capacity)} TEU`}
            >
              <span className="font-bold">{o.id}</span>
              <span className="h-1.5 w-10 overflow-hidden rounded bg-white/15">
                <span
                  className={`block h-full rounded ${tone}`}
                  style={{ width: `${o.pct}%` }}
                />
              </span>
              <span className="font-semibold tabular-nums">
                {o.pct.toFixed(0)}%
              </span>
              <span className="text-slate-300">
                available{" "}
                <span className="font-semibold text-white tabular-nums">
                  {nf(o.free)}
                </span>{" "}
                {o.free === 1 ? "box" : "boxes"}
              </span>
              {o.blocked > 0 && (
                <span
                  className="text-red-300 tabular-nums"
                  title="Locked slots, not counted in capacity"
                >
                  🔒{nf(o.blocked)}
                </span>
              )}
            </div>
          </Html>
        );
      })}
    </>
  );
}
