'use client';

import { useEffect, useMemo, useState } from 'react';
import { PITCH } from '@/lib/constants';
import { aroundBlock } from '@/lib/yard';
import { allTruckPoses, currentCameraPose } from '@/components/three/trafficRegistry';
import { useEditor } from '@/store/useEditor';
import { useYardView } from '@/store/useYardView';
import { Panel } from './ui';

/**
 * Peta kecil lapangan dari atas: blok, ubin jalan, truk yang bergerak, dan
 * kamera — titik berdirinya, arah pandangnya, dan titik yang sedang dilihatnya.
 *
 * SVG biasa, bukan kanvas WebGL ketiga: puluhan persegi dan beberapa titik
 * tidak butuh GPU, dan SVG ikut tajam di layar HiDPI tanpa diurus.
 */
const W = 300;
const H = 190;

export function Minimap() {
  const data = useYardView();
  const roads = useEditor((s) => s.layout?.roads);
  const [, tick] = useState(0);

  // Truk dan kamera hidup di luar React; peta disegarkan 5x sedetik.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const frame = useMemo(() => {
    if (!data) return null;
    const xs: number[] = [];
    const zs: number[] = [];
    for (const b of data.blocks) {
      for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        const [x, z] = aroundBlock(b, (dx * b.slots * PITCH.teu) / 2, (dz * b.rows * PITCH.row) / 2);
        xs.push(x);
        zs.push(z);
      }
    }
    for (const r of roads ?? []) {
      xs.push(r.x - 12, r.x + 12);
      zs.push(r.z - 12, r.z + 12);
    }
    if (xs.length === 0) return null;
    const pad = 40;
    const minX = Math.min(...xs) - pad;
    const maxX = Math.max(...xs) + pad;
    const minZ = Math.min(...zs) - pad;
    const maxZ = Math.max(...zs) + pad;
    // Skala seragam supaya bentuknya tidak gepeng; dipusatkan di kotak peta.
    const s = Math.min(W / (maxX - minX), H / (maxZ - minZ));
    const ox = (W - (maxX - minX) * s) / 2;
    const oz = (H - (maxZ - minZ) * s) / 2;
    return { s, toX: (x: number) => ox + (x - minX) * s, toY: (z: number) => oz + (z - minZ) * s };
  }, [data, roads]);

  // Jalan dan blok hanya berubah saat data / tata letak berubah — disimpan,
  // supaya penyegaran 5x sedetik (truk & kamera) tidak ikut menggambar ulang
  // puluhan persegi. Elemen yang sama persis membuat React melewatinya.
  const staticLayer = useMemo(() => {
    if (!data || !frame) return null;
    const { s, toX, toY } = frame;
    return (
      <>
      {(roads ?? []).map((r) => (
        <rect
          key={r.id}
          x={toX(r.x) - 12 * s}
          y={toY(r.z) - 12 * s}
          width={24 * s}
          height={24 * s}
          fill="#334155"
        />
      ))}
      {data.blocks.map((b) => {
        const L = b.slots * PITCH.teu;
        const Wd = b.rows * PITCH.row;
        const [cx, cz] = aroundBlock(b, 0, 0);
        const cap = b.slots * b.rows * b.tiers;
        const teu = b.containers.reduce((n, c) => n + (c.size === 40 ? 2 : 1), 0);
        const pct = cap ? teu / cap : 0;
        return (
          <g key={b.id} transform={`translate(${toX(cx)} ${toY(cz)}) rotate(${(-(b.rot ?? 0) * 180) / Math.PI})`}>
            <rect
              x={(-L / 2) * s}
              y={(-Wd / 2) * s}
              width={L * s}
              height={Wd * s}
              fill={pct >= 0.9 ? '#b45309' : '#1d4ed8'}
              opacity={0.35 + 0.55 * pct}
              stroke="#93c5fd"
              strokeWidth={0.6}
            />
            <text y={3} fontSize={9} fill="#e2e8f0" textAnchor="middle" fontWeight={600}>
              {b.id}
            </text>
          </g>
        );
      })}
      </>
    );
  }, [data, roads, frame]);

  if (!data || !frame) return null;
  const { toX, toY } = frame;
  const cam = currentCameraPose();

  return (
    <Panel className="pointer-events-auto w-[300px] overflow-hidden">
      <svg width={W} height={H} className="block">
        <rect width={W} height={H} fill="#0f172a" />
        {staticLayer}
        {[...allTruckPoses().values()].map((p, i) => (
          <circle key={i} cx={toX(p.x)} cy={toY(p.z)} r={2.2} fill={p.phase === 'wait' ? '#f59e0b' : '#22d3ee'} />
        ))}
        {cam && (
          <g>
            <line x1={toX(cam.x)} y1={toY(cam.z)} x2={toX(cam.tx)} y2={toY(cam.tz)} stroke="#fde68a" strokeWidth={0.8} strokeDasharray="2 2" />
            <circle cx={toX(cam.tx)} cy={toY(cam.tz)} r={2.5} fill="none" stroke="#fde68a" strokeWidth={1} />
            <circle cx={toX(cam.x)} cy={toY(cam.z)} r={3} fill="#fde68a" />
          </g>
        )}
      </svg>
      <div className="flex items-center justify-between px-2 py-1 text-[9px] text-slate-500">
        <span>■ block (bright = full) · ● truck · ● camera</span>
      </div>
    </Panel>
  );
}
