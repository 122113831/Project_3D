'use client';

import { useMemo, useRef, useState } from 'react';
import { PITCH, ROAD, ROAD_KINDS, ROAD_LABEL, type RoadKind } from '@/lib/constants';
import type { BlockSide } from '@/lib/types';
import { EQUIPMENT_LABEL, type LayoutBlock, type LayoutEquipment, type LayoutRoad } from '@/lib/layout';
import { equipmentName, hasEquipmentCode } from '@/lib/equipmentNames';
import { PARKING_LIMITS, PARKING_VEHICLE, parkingSpec, type ParkingSpec, type ParkingVehicle } from '@/lib/parkingSpec';
import { WAREHOUSE_LIMITS, WAREHOUSE_PAINTS, warehouseSpec, type WarehouseRoof, type WarehouseSpec } from '@/lib/warehouseSpec';
import { persistBlockPlacement } from '@/lib/persist';
import { MIN_LEN, roadLen } from '@/lib/roadSnap';
import { planGrowth } from '@/lib/shift';
import { blockedCount } from '@/lib/slots';
import { resizeBlockInDb } from '@/lib/yardApi';
import { NOTE_WARN, useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { Chip, Panel, Section } from './ui';
import { ValidationPanel } from './ValidationPanel';

/** Papan nama parkir bawaan (baru dan lama) yang ikut berganti saat jenis alat diganti. */
const DEFAULT_SIGNS = new Set(['RS PARKING', 'TRUCK PARKING', 'PARKIR RS', 'PARKIR TRUK']);

/** Kotak angka kecil dengan label, dipakai panel properti. */
function Num({
  label,
  value,
  step = 1,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  min?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-[2px] text-[11px] text-slate-400">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        min={min}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-[74px] rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right text-[11px] tabular-nums text-slate-100 outline-none focus:border-sky-400/60"
      />
    </label>
  );
}

/** Pilihan kiri/kanan, dipakai TRUCK_LANE dan SLOT_START. */
function Side({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BlockSide;
  onChange: (v: BlockSide) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-[2px] text-[11px] text-slate-400">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as BlockSide)}
        className="w-[74px] rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[11px] text-slate-100 outline-none focus:border-sky-400/60"
      >
        <option value="L">Left</option>
        <option value="R">Right</option>
      </select>
    </label>
  );
}

function BlockProps({ block }: { block: LayoutBlock }) {
  const update = useEditor((s) => s.updateBlock);
  const { id } = block;
  return (
    <>
      <label className="flex items-center justify-between gap-2 py-[2px] text-[11px] text-slate-400">
        <span>Block code</span>
        <input
          value={block.id}
          onChange={(e) => update(id, { id: e.target.value.toUpperCase().slice(0, 5) })}
          className="w-[74px] rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right text-[11px] text-slate-100 outline-none focus:border-sky-400/60"
        />
      </label>
      {/* Posisi ikut tersimpan, sama seperti sudut. Sebelumnya tidak, dan
          akibatnya nyata: posisi yang diubah di sini menumpang pada penyimpanan
          berikutnya yang dipicu rotasi, sehingga blok pindah di database tanpa
          ada yang sengaja memindahkannya. */}
      <Num
        label="Position X"
        value={block.originX}
        step={0.5}
        onChange={(v) => {
          update(id, { originX: v });
          persistBlockPlacement(id);
        }}
      />
      <Num
        label="Position Z"
        value={block.originZ}
        step={0.5}
        onChange={(v) => {
          update(id, { originZ: v });
          persistBlockPlacement(id);
        }}
      />
      <Num label="Slot" value={block.slots} min={1} onChange={(v) => update(id, { slots: Math.max(1, Math.round(v)) })} />
      <Num label="Row" value={block.rows} min={1} onChange={(v) => update(id, { rows: Math.max(1, Math.round(v)) })} />
      <Num label="Tier" value={block.tiers} min={1} onChange={(v) => update(id, { tiers: Math.max(1, Math.round(v)) })} />
      <Num
        label="Rotation (°)"
        value={((block.rot ?? 0) * 180) / Math.PI}
        step={15}
        onChange={(v) => {
          update(id, { rot: (v * Math.PI) / 180 });
          persistBlockPlacement(id);
        }}
      />
      {/* Kedua kolom ini tersimpan ke database seperti posisi dan sudut. */}
      <Side
        label="Truck lane"
        value={block.truckLane ?? 'L'}
        onChange={(v) => {
          update(id, { truckLane: v });
          persistBlockPlacement(id);
        }}
      />
      <Side
        label="Slot start"
        value={block.slotStart ?? 'L'}
        onChange={(v) => {
          update(id, { slotStart: v });
          persistBlockPlacement(id);
        }}
      />
      <BlockRoad block={block} />
      {/* Blok khusus reefer: rak listrik di sisi seberang lajur truk. Hanya
          tata letak (YARD_LAYOUT); CORE_YARD_BLOCK tidak berubah. */}
      <label className="mt-1 flex cursor-pointer items-center justify-between gap-2 py-[2px] text-[11px] text-slate-400">
        <span>
          Reefer block
          <span className="block text-[10px] text-slate-500">Power racks with platforms on the far side</span>
        </span>
        <input
          type="checkbox"
          checked={block.reefer === true}
          onChange={(e) => update(id, { reefer: e.target.checked })}
          className="h-3.5 w-3.5 accent-sky-400"
        />
      </label>
      <div className="mt-1 text-[10px] text-slate-500">
        {(block.slots * PITCH.teu).toFixed(1)} x {(block.rows * PITCH.row).toFixed(1)} m ·{' '}
        {block.slots * block.rows * block.tiers} slots
      </div>
      <BlockSizeActions block={block} />
      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Drag this block in the yard to move it, or press R to rotate it 15°
        (Shift+R the other way). Position and angle are saved to CORE_YARD_BLOCK.
      </div>
    </>
  );
}

/**
 * Jalan bawaan blok: lorong dua arah yang dulu selalu ikut tergambar bersama
 * blok. Blok baru tidak punya; blok lama bisa dilepas jalannya — diganti ubin
 * lurus berdiri sendiri di garis yang sama, sehingga rute truk tidak putus dan
 * jalannya bisa disunting seperti ubin lain.
 */
function BlockRoad({ block }: { block: LayoutBlock }) {
  const detach = useEditor((s) => s.detachBlockRoad);
  const setNote = useEditor((s) => s.setNote);
  const own = block.ownRoad !== false;
  return (
    <div className="mt-1.5 rounded border border-white/10 px-2 py-1.5 text-[11px] text-slate-300">
      <div className="flex items-center justify-between">
        <span>Built-in block road</span>
        <span className={own ? 'text-sky-300' : 'text-slate-500'}>{own ? 'yes' : 'no — separate tiles'}</span>
      </div>
      {own ? (
        <button
          type="button"
          onClick={() => {
            const n = detach(block.id);
            setNote(`Block ${block.id} road replaced with ${n} standalone road tiles.`);
          }}
          className="mt-1 w-full rounded border border-white/15 py-1 text-[11px] text-slate-200 hover:border-white/30"
        >
          Replace with road tiles
        </button>
      ) : (
        <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
          Place road tiles (or use Connect road) along the aisle so trucks can
          stop at the bays of this block.
        </div>
      )}
    </div>
  );
}

/**
 * Dua tindakan yang muncul begitu slot/row/tier berbeda dari database:
 *
 *   1. Geser yang terdampak — jalan, alat, dan blok lain di sisi pertumbuhan
 *      didorong sejauh pertumbuhannya (shift.ts). Ditawarkan dengan hitungan
 *      di labelnya, bukan dilakukan diam-diam: blok lain yang ikut bergeser
 *      posisinya tersimpan ke CORE_YARD_BLOCK.
 *   2. Simpan ukuran ke database — CORE_YARD_BLOCK diperbarui dan baris
 *      YARD_ROWTIER ditambah/dihapus (hanya yang kosong). Setelah itu lapangan
 *      dibaca ulang, jadi ukuran dasarnya ikut berubah dan kedua tombol ini
 *      hilang sendiri.
 *
 * Urutan yang disarankan: ubah angka → geser terdampak → simpan ukuran.
 */
function BlockSizeActions({ block }: { block: LayoutBlock }) {
  const layout = useEditor((s) => s.layout);
  const shiftForGrowth = useEditor((s) => s.shiftForGrowth);
  const busy = useEditor((s) => s.busy);
  const setBusy = useEditor((s) => s.setBusy);
  const setNote = useEditor((s) => s.setNote);
  const base = useYard((s) => s.data?.blocks.find((b) => b.id === block.id));
  const source = useYard((s) => s.data?.meta.source);
  const load = useYard((s) => s.load);

  const plans = useMemo(
    () => (layout && base ? planGrowth(layout, block.id, base).plans : []),
    [layout, block.id, base],
  );
  if (!base) return null;
  const sizeChanged = base.slots !== block.slots || base.rows !== block.rows || base.tiers !== block.tiers;
  if (!sizeChanged) return null;

  const touched = {
    roads: new Set(plans.flatMap((p) => p.roads)).size,
    equipment: new Set(plans.flatMap((p) => p.equipment)).size,
    blocks: new Set(plans.flatMap((p) => p.blocks)).size,
    fillers: plans.reduce((n, p) => n + p.fillers.length, 0),
  };
  const anyShift = touched.roads + touched.equipment + touched.blocks > 0;
  const deltaText = plans.map((p) => `${p.delta.toFixed(1)} m toward ${p.axis === 'x' ? 'the slot end' : 'the row side'}`).join(', ');
  const capDelta = block.slots * block.rows * block.tiers - base.slots * base.rows * base.tiers;

  const doShift = () => {
    const done = shiftForGrowth(block.id, base);
    const moved = new Set(done.flatMap((p) => p.blocks));
    for (const id of moved) persistBlockPlacement(id);
    const fillers = done.reduce((n, p) => n + p.fillers.length, 0);
    setNote(
      `Moved: ${new Set(done.flatMap((p) => p.roads)).size} roads, ${new Set(done.flatMap((p) => p.equipment)).size} equipment, ` +
        `${moved.size} blocks${fillers ? `; ${fillers} filler tiles added` : ''}.`,
    );
  };

  const doResize = async () => {
    setBusy(true);
    try {
      const r = await resizeBlockInDb({ code: block.id, slots: block.slots, rows: block.rows, tiers: block.tiers });
      await load({ source: 'depot' });
      setNote(
        `Block ${r.code} ${r.from.slots}×${r.from.rows}×${r.from.tiers} → ${r.to.slots}×${r.to.rows}×${r.to.tiers}: ` +
          `${r.inserted} YARD_ROWTIER rows added, ${r.deleted} deleted.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-1.5 space-y-1">
      {plans.length > 0 && (
        <button
          type="button"
          disabled={!anyShift}
          onClick={doShift}
          className="w-full rounded-md border border-amber-300/50 bg-amber-400/10 px-2 py-1 text-left text-[11px] leading-snug text-amber-100 disabled:opacity-50"
        >
          {anyShift
            ? `Move affected objects (${deltaText}): ${touched.roads} roads · ${touched.equipment} equipment · ${touched.blocks} blocks` +
              (touched.fillers ? ` · +${touched.fillers} filler tiles` : '')
            : `Nothing affected on the growth side (${deltaText}).`}
        </button>
      )}
      {source === 'depot' ? (
        <button
          type="button"
          disabled={busy}
          onClick={doResize}
          className="w-full rounded-md border border-sky-300/50 bg-sky-400/15 px-2 py-1 text-left text-[11px] leading-snug text-slate-50 disabled:opacity-50"
        >
          Save size to database ({base.slots}×{base.rows}×{base.tiers} → {block.slots}×{block.rows}×{block.tiers},{' '}
          {capDelta >= 0 ? '+' : ''}
          {capDelta} slots)
        </button>
      ) : null}
      <div className="text-[10px] leading-relaxed text-slate-500">
        Shrinking is rejected if any container lies outside the new size; occupied rows are never deleted.
        Positions of other blocks moved along with it are saved to CORE_YARD_BLOCK.
      </div>
    </div>
  );
}

function RoadProps({ road }: { road: LayoutRoad }) {
  const update = useEditor((s) => s.updateRoad);
  const { id } = road;
  return (
    <>
      <Num label="Position X" value={road.x} step={0.5} onChange={(v) => update(id, { x: v })} />
      <Num label="Position Z" value={road.z} step={0.5} onChange={(v) => update(id, { z: v })} />
      <label className="flex items-center justify-between gap-2 py-[2px] text-[11px] text-slate-400">
        <span>Shape</span>
        <select
          value={road.kind}
          onChange={(e) => update(id, { kind: e.target.value as RoadKind })}
          className="w-[104px] rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[11px] text-slate-100 outline-none focus:border-sky-400/60"
        >
          {ROAD_KINDS.map((k) => (
            <option key={k} value={k}>
              {ROAD_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {/* Kelipatan 90 derajat: sudut lain memutus sambungan marka antar-ubin. */}
      <Num
        label="Rotation (°)"
        value={(road.ry * 180) / Math.PI}
        step={90}
        onChange={(v) => update(id, { ry: (Math.round(v / 90) * 90 * Math.PI) / 180 })}
      />
      {/* Hanya jalan lurus yang bisa dipendekkan — belokan dan persimpangan
          kehilangan bentuknya kalau lengannya dipotong. Biasanya panjang ini
          sudah dipaskan sendiri saat ditaruh; kotak ini untuk sisa kasus yang
          tidak tertangkap, misalnya celah yang lebih panjang dari satu ubin. */}
      {road.kind === 'straight' && (
        <Num
          label="Length (m)"
          value={roadLen(road)}
          step={0.5}
          min={MIN_LEN}
          onChange={(v) =>
            update(id, {
              len:
                v >= ROAD.tile - 0.01 ? undefined : Math.max(MIN_LEN, Math.round(v * 100) / 100),
            })
          }
        />
      )}
      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Tile {ROAD.tile} x {ROAD.tile} m; a straight road shortens itself when the space ahead
        is less than one tile. Place them in a row to form a route; press R to rotate 90°.
      </div>
    </>
  );
}

function EquipProps({ item }: { item: LayoutEquipment }) {
  const update = useEditor((s) => s.updateEquipment);
  const allEquipment = useEditor((s) => s.layout?.equipment);
  const { id } = item;
  return (
    <>
      <div className="pb-1 text-[11px] text-slate-300">{EQUIPMENT_LABEL[item.kind]}</div>
      <Num label="Position X" value={item.x} step={0.5} onChange={(v) => update(id, { x: v })} />
      <Num label="Position Z" value={item.z} step={0.5} onChange={(v) => update(id, { z: v })} />
      <Num
        label="Rotation (°)"
        value={(item.ry * 180) / Math.PI}
        step={15}
        onChange={(v) => update(id, { ry: (v * Math.PI) / 180 })}
      />
      {item.kind === 'truck' && (
        <label className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={item.loaded ?? false}
            onChange={(e) => update(id, { loaded: e.target.checked })}
            className="h-3.5 w-3.5 accent-sky-400"
          />
          Carrying a container
        </label>
      )}
      {hasEquipmentCode(item.kind) && (
        <label className="flex items-center justify-between gap-2 pt-1.5 text-[11px] text-slate-400">
          <span>Equipment code (label)</span>
          <input
            type="text"
            value={item.code ?? ''}
            // Kosong = nama otomatis yang sedang tampil di labelnya.
            placeholder={equipmentName(allEquipment ?? [], item.id)}
            maxLength={6}
            onChange={(e) => update(id, { code: e.target.value.toUpperCase() })}
            className="w-[74px] rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right text-[11px] uppercase text-slate-100 outline-none focus:border-sky-400/60"
          />
        </label>
      )}
      {item.kind === 'warehouse' && (
        <WarehouseFields item={item} onChange={(b) => update(id, { building: { ...item.building, ...b } })} />
      )}
      {item.kind === 'parking' && (
        <ParkingFields item={item} onChange={(p) => update(id, { parking: { ...item.parking, ...p } })} />
      )}
    </>
  );
}

/**
 * Isian SATU area parkir: jenis alat (ukuran lajur), jumlah lajur & baris,
 * dan papan nama. Alatnya tidak ikut — RS dan lainnya ditaruh sendiri dari
 * tab Alat lalu diletakkan di lajur.
 */
function ParkingFields({ item, onChange }: { item: LayoutEquipment; onChange: (p: Partial<ParkingSpec>) => void }) {
  const s = parkingSpec(item.parking);
  const btn = (on: boolean) =>
    `rounded border px-1.5 py-0.5 text-[11px] ${on ? 'border-amber-300/70 bg-amber-400/20 text-slate-50' : 'border-white/15 text-slate-300 hover:border-white/30'}`;
  const setVehicle = (v: ParkingVehicle) =>
    onChange({
      vehicle: v,
      // Papan nama bawaan ikut berganti; yang sudah diubah pengguna dibiarkan.
      ...(DEFAULT_SIGNS.has(s.label) ? { label: v === 'truck' ? 'TRUCK PARKING' : 'RS PARKING' } : {}),
    });
  const v = PARKING_VEHICLE[s.vehicle];
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <div className="flex items-center justify-between gap-2 py-1 text-[11px] text-slate-400">
        <span>Bays for</span>
        <span className="flex gap-1">
          {(Object.keys(PARKING_VEHICLE) as ParkingVehicle[]).map((k) => (
            <button key={k} type="button" className={btn(s.vehicle === k)} onClick={() => setVehicle(k)}>
              {k === 'truck' ? 'Truck' : 'RS'}
            </button>
          ))}
        </span>
      </div>
      <Num
        label="Bays per row"
        value={s.bays}
        step={1}
        min={PARKING_LIMITS.bays[0]}
        onChange={(n) => onChange({ bays: Math.round(Math.min(PARKING_LIMITS.bays[1], Math.max(PARKING_LIMITS.bays[0], n))) })}
      />
      <div className="flex items-center justify-between gap-2 py-1 text-[11px] text-slate-400">
        <span>Rows</span>
        <span className="flex gap-1">
          {([1, 2] as const).map((r) => (
            <button key={r} type="button" className={btn(s.rows === r)} onClick={() => onChange({ rows: r })}>
              {r === 1 ? '1 row' : '2 facing'}
            </button>
          ))}
        </span>
      </div>
      <label className="flex items-center justify-between gap-2 pt-1.5 text-[11px] text-slate-400">
        <span>Sign</span>
        <input
          type="text"
          value={s.label}
          maxLength={20}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-[120px] rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right text-[11px] uppercase text-slate-100 outline-none focus:border-sky-400/60"
        />
      </label>
      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        {s.bays * s.rows} bays · {v.bayW} × {v.bayL} m per bay. Place the equipment separately from the Equipment tab
        (e.g. Reach stacker), then move it into a bay.
      </div>
    </div>
  );
}

/** Ukuran, atap, warna, kelengkapan, dan papan nama SATU gudang. */
function WarehouseFields({ item, onChange }: { item: LayoutEquipment; onChange: (b: Partial<WarehouseSpec>) => void }) {
  const s = warehouseSpec(item.building);
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
  const roofs: [WarehouseRoof, string][] = [
    ['gable', 'Gable'],
    ['flat', 'Flat'],
    ['saw', 'Sawtooth'],
  ];
  const btn = (on: boolean) =>
    `rounded border px-1.5 py-0.5 text-[11px] ${on ? 'border-amber-300/70 bg-amber-400/20 text-slate-50' : 'border-white/15 text-slate-300 hover:border-white/30'}`;
  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <Num label="Length (m)" value={s.w} step={6} min={WAREHOUSE_LIMITS.w[0]} onChange={(v) => onChange({ w: clamp(v, WAREHOUSE_LIMITS.w) })} />
      <Num label="Width (m)" value={s.d} step={3} min={WAREHOUSE_LIMITS.d[0]} onChange={(v) => onChange({ d: clamp(v, WAREHOUSE_LIMITS.d) })} />
      <Num label="Wall height (m)" value={s.h} step={1} min={WAREHOUSE_LIMITS.h[0]} onChange={(v) => onChange({ h: clamp(v, WAREHOUSE_LIMITS.h) })} />
      <div className="flex items-center justify-between gap-2 py-1 text-[11px] text-slate-400">
        <span>Roof</span>
        <span className="flex gap-1">
          {roofs.map(([v, name]) => (
            <button key={v} type="button" className={btn(s.roof === v)} onClick={() => onChange({ roof: v })}>
              {name}
            </button>
          ))}
        </span>
      </div>
      <div className="py-1 text-[11px] text-slate-400">Wall / roof color</div>
      <div className="flex flex-wrap gap-1">
        {WAREHOUSE_PAINTS.map((p) => (
          <button
            key={p.name}
            type="button"
            title={p.name}
            className={btn(s.wall === p.wall && s.roofColor === p.roof)}
            onClick={() => onChange({ wall: p.wall, roofColor: p.roof })}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: p.wall }} />
            <span className="ml-0.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: p.roof }} />
          </button>
        ))}
      </div>
      {(
        [
          ['docks', 'Roller doors + dock'],
          ['canopy', 'Canopy over dock'],
          ['office', 'Office at the end'],
        ] as const
      ).map(([k, name]) => (
        <label key={k} className="flex cursor-pointer items-center gap-2 pt-1 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={s[k]}
            disabled={k === 'canopy' && !s.docks}
            onChange={(e) => onChange({ [k]: e.target.checked })}
            className="h-3.5 w-3.5 accent-amber-400"
          />
          {name}
        </label>
      ))}
      <label className="flex items-center justify-between gap-2 pt-1.5 text-[11px] text-slate-400">
        <span>Sign</span>
        <input
          type="text"
          value={s.label}
          maxLength={24}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-[120px] rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-right text-[11px] uppercase text-slate-100 outline-none focus:border-sky-400/60"
        />
      </label>
    </div>
  );
}

/**
 * Ringkasan slot terkunci per blok, plus tombol masuk ke modus kuncinya.
 *
 * Angkanya dari lapangan yang sedang tampil (useYardView), bukan dari tata
 * letak mentah: di sana kuncinya sudah dirapikan terhadap ukuran blok, jadi
 * yang dihitung persis yang digambar.
 */
function LockedSlots() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const clearBlocked = useEditor((s) => s.clearBlocked);
  const busy = useEditor((s) => s.busy);
  const note = useEditor((s) => s.note);
  const data = useYardView();
  const rows = (data?.blocks ?? [])
    .map((b) => ({ id: b.id, cols: b.blocked?.length ?? 0, cells: blockedCount(b.blocked, b) }))
    .filter((r) => r.cells > 0);
  const total = rows.reduce((n, r) => n + r.cells, 0);
  const active = tool === 'slots';

  return (
    <Section title="Locked slots">
      <button
        type="button"
        onClick={() => setTool(active ? 'select' : 'slots')}
        className={`w-full rounded-md border py-1.5 text-[12px] ${
          active
            ? 'border-red-300/60 bg-red-400/20 text-slate-50'
            : 'border-white/15 text-slate-200 hover:border-white/30'
        }`}
      >
        {active ? (busy ? 'Saving to YARD_ROWTIER…' : 'Done locking slots') : 'Lock / unlock slots…'}
      </button>
      {/* Hasil tiap klik ditampilkan DI SINI, dekat tombolnya — bukan hanya di
          bagian bawah panel yang bisa berada di luar layar. Penolakan server
          (misalnya sel masih berisi) kalau tidak terlihat terasa seperti
          "tidak bisa dikunci" tanpa sebab. */}
      {active && note && (
        <div
          className={`mt-1.5 text-[10px] leading-relaxed ${
            NOTE_WARN.test(note) ? 'text-amber-300' : 'text-sky-300/90'
          }`}
        >
          {note}
        </div>
      )}
      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        {total === 0
          ? 'No slots locked yet. Locked slots do not count toward capacity.'
          : `${total} slots locked. Not counted toward capacity.`}
      </div>
      {rows.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[11px] text-slate-300">
              <span>
                <span className="font-semibold text-slate-100">{r.id}</span> · {r.cells} slots ({r.cols} columns)
              </span>
              <button
                type="button"
                onClick={() => clearBlocked(r.id)}
                className="text-[10px] text-slate-500 hover:text-red-300"
              >
                unlock all
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * Panel properti + berkas untuk editor.
 *
 * Memilih APA yang ditaruh ada di palet bawah, bukan di sini — panel ini hanya
 * mengurus objek yang sudah terpilih dan tata letak sebagai berkas.
 */
export function EditorPanel() {
  const open = useEditor((s) => s.open);
  const setOpen = useEditor((s) => s.setOpen);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const layout = useEditor((s) => s.layout);
  const selected = useEditor((s) => s.selected);
  const seedFrom = useEditor((s) => s.seedFrom);
  const removeSelected = useEditor((s) => s.removeSelected);
  const undo = useEditor((s) => s.undo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const clearLayout = useEditor((s) => s.clearLayout);
  const importLayout = useEditor((s) => s.importLayout);
  const data = useYard((s) => s.data);
  const source = useYard((s) => s.source);
  const dbNote = useEditor((s) => s.note);
  const openNewBlock = useEditor((s) => s.openNewBlock);

  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Lapangan yang tampil sudah benar-benar milik sumber yang dipilih. Sepanjang
  // pergantian sumber keduanya berbeda, dan selama itu tidak ada yang boleh
  // disalin.
  const ready = !!data && data.meta.source === source;

  // Editor dibuka dari pilihan mode "Sunting" di kartu kiri atas (TopBar).
  if (!open) return null;

  const block = selected?.type === 'block' ? layout?.blocks.find((b) => b.id === selected.id) : null;
  const road = selected?.type === 'road' ? layout?.roads.find((r) => r.id === selected.id) : null;
  const equip =
    selected?.type === 'equipment' ? layout?.equipment.find((e) => e.id === selected.id) : null;

  const exportJson = () => {
    if (!layout) return;
    const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `yard-layout-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    // Panel ini sendiri yang menggulir: kolom pembungkusnya pointer-events-none,
    // jadi roda tetikus tidak sampai ke sana, dan bagian bawah panel — tempat
    // catatan hasil tulis dulu muncul — tidak pernah bisa dicapai di layar
    // pendek.
    <Panel className="hud-scroll pointer-events-auto min-h-0 w-[300px] shrink overflow-y-auto overscroll-contain">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[12px] font-semibold text-slate-100">Edit yard</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-500 hover:text-slate-200"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {!layout ? (
        <Section title="Start">
          <div className="mb-2 text-[11px] leading-relaxed text-slate-400">
            No saved layout yet. Copy the arrangement currently shown as a starting point,
            then edit it freely.
          </div>
          {/*
            Tombolnya mati selama lapangan sumber yang dipilih belum sampai.
            Mengklik "Demo" mengganti sumbernya seketika, tapi `data` masih
            berisi lapangan sebelumnya sampai permintaannya selesai — dan menyalin
            di sela itu berarti menempelkan susunan blok database ke lapangan demo.
          */}
          <button
            type="button"
            disabled={!ready}
            onClick={() => ready && data && seedFrom(data)}
            className="w-full rounded-md border border-sky-300/50 bg-sky-400/15 py-1.5 text-[12px] text-slate-50 disabled:opacity-40"
          >
            Copy from current yard
          </button>
          {!ready && (
            <div className="mt-1.5 text-[10px] text-slate-500">
              Waiting for the database yard to finish loading…
            </div>
          )}
        </Section>
      ) : (
        <>
          <Section title={selected ? 'Properties' : 'Nothing selected'}>
            {block && <BlockProps block={block} />}
            {road && <RoadProps road={road} />}
            {equip && <EquipProps item={equip} />}
            {!selected && (
              <div className="text-[11px] leading-relaxed text-slate-500">
                {tool === 'place'
                  ? 'Click in the yard to place the asset selected in the bottom palette.'
                  : 'Click a block, road, or equipment in the yard to edit it.'}
              </div>
            )}
            {selected && (
              <button
                type="button"
                onClick={removeSelected}
                className="mt-2 w-full rounded-md border border-red-400/40 py-1 text-[11px] text-red-300 hover:border-red-400/70"
              >
                Delete this object
              </button>
            )}
          </Section>

          <ValidationPanel />
          <LockedSlots />

          {/* Jalan masuk kedua ke dialog blok baru. Palet bawah juga bisa, tapi
              kartunya mudah tertukar dengan kartu jalan dan alat yang
              perilakunya berbeda — yang itu ditempel di lapangan, yang ini
              menulis ke database. */}
          <Section title="Block">
            <button
              type="button"
              onClick={() => openNewBlock({ slots: 20, rows: 6, tiers: 7 })}
              className="w-full rounded-md border border-sky-300/50 bg-sky-400/15 py-1.5 text-[12px] text-slate-50 hover:bg-sky-400/25"
            >
              + New block
            </button>
            <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Inserts rows into CORE_YARD_BLOCK and YARD_ROWTIER. Size is set in the dialog.
            </div>
          </Section>

          <Section title="Layout">
            <div className="mb-1.5 text-[10px] text-slate-500">
              {layout.blocks.length} blocks · {layout.roads.length} roads · {layout.equipment.length} equipment
              {typeof data?.meta.droppedByLayout === 'number' && data.meta.droppedByLayout > 0 && (
                <span className="block text-amber-400/80">
                  {data.meta.droppedByLayout} containers do not fit in the edited blocks and are not
                  drawn
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Chip active={false} onClick={undo} title={canUndo ? 'Ctrl+Z' : 'No history'}>
                Undo
              </Chip>
              <Chip active={false} onClick={exportJson}>
                Export JSON
              </Chip>
              <Chip active={false} onClick={() => fileRef.current?.click()}>
                Import JSON
              </Chip>
              <Chip
                active={false}
                onClick={() => {
                  clearLayout();
                  setTool('select');
                  setNote('Layout cleared — back to the database arrangement.');
                }}
              >
                Reset
              </Chip>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setNote(importLayout(await f.text()) ?? 'Layout loaded.');
              }}
            />
            {note && <div className="mt-1.5 text-[10px] text-slate-400">{note}</div>}
            {/* Hasil penulisan ke database, terpisah dari catatan impor/reset. */}
            {dbNote && (
              <div className="mt-1.5 text-[10px] leading-relaxed text-sky-300/90">{dbNote}</div>
            )}
            <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              Saved automatically to the database and applies to all users: roads and equipment to
              YARD_LAYOUT, block positions and angles to CORE_YARD_BLOCK.
            </div>
          </Section>
        </>
      )}
    </Panel>
  );
}
