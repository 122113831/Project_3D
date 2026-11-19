'use client';

import { useMemo, useRef, useState } from 'react';
import { PITCH, ROAD, ROAD_KINDS, ROAD_LABEL, type RoadKind } from '@/lib/constants';
import type { BlockSide } from '@/lib/types';
import { EQUIPMENT_LABEL, type LayoutBlock, type LayoutEquipment, type LayoutRoad } from '@/lib/layout';
import { persistBlockPlacement } from '@/lib/persist';
import { MIN_LEN, roadLen } from '@/lib/roadSnap';
import { planGrowth } from '@/lib/shift';
import { blockedCount } from '@/lib/slots';
import { resizeBlockInDb } from '@/lib/yardApi';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { useYardView } from '@/store/useYardView';
import { Chip, Panel, Section } from './ui';
import { ValidationPanel } from './ValidationPanel';

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
        <option value="L">Kiri</option>
        <option value="R">Kanan</option>
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
        <span>Kode</span>
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
        label="Posisi X"
        value={block.originX}
        step={0.5}
        onChange={(v) => {
          update(id, { originX: v });
          persistBlockPlacement(id);
        }}
      />
      <Num
        label="Posisi Z"
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
        label="Putar (°)"
        value={((block.rot ?? 0) * 180) / Math.PI}
        step={15}
        onChange={(v) => {
          update(id, { rot: (v * Math.PI) / 180 });
          persistBlockPlacement(id);
        }}
      />
      {/* Kedua kolom ini tersimpan ke database seperti posisi dan sudut. */}
      <Side
        label="Lajur truk"
        value={block.truckLane ?? 'L'}
        onChange={(v) => {
          update(id, { truckLane: v });
          persistBlockPlacement(id);
        }}
      />
      <Side
        label="Mulai slot"
        value={block.slotStart ?? 'L'}
        onChange={(v) => {
          update(id, { slotStart: v });
          persistBlockPlacement(id);
        }}
      />
      <BlockRoad block={block} />
      <div className="mt-1 text-[10px] text-slate-500">
        {(block.slots * PITCH.teu).toFixed(1)} x {(block.rows * PITCH.row).toFixed(1)} m ·{' '}
        {block.slots * block.rows * block.tiers} slot
      </div>
      <BlockSizeActions block={block} />
      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Seret blok ini di lapangan untuk memindahkannya, atau tekan R untuk memutar 15°
        (Shift+R sebaliknya). Posisi dan sudut tersimpan ke CORE_YARD_BLOCK.
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
        <span>Jalan bawaan blok</span>
        <span className={own ? 'text-sky-300' : 'text-slate-500'}>{own ? 'ada' : 'tidak — ubin terpisah'}</span>
      </div>
      {own ? (
        <button
          type="button"
          onClick={() => {
            const n = detach(block.id);
            setNote(`Jalan blok ${block.id} diganti ${n} ubin jalan yang berdiri sendiri.`);
          }}
          className="mt-1 w-full rounded border border-white/15 py-1 text-[11px] text-slate-200 hover:border-white/30"
        >
          Ganti dengan ubin jalan
        </button>
      ) : (
        <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
          Taruh ubin jalan (atau pakai Sambung jalan) di sepanjang lorong supaya truk bisa
          berhenti di bay blok ini.
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
  const deltaText = plans.map((p) => `${p.delta.toFixed(1)} m ke ${p.axis === 'x' ? 'ujung slot' : 'sisi row'}`).join(', ');
  const capDelta = block.slots * block.rows * block.tiers - base.slots * base.rows * base.tiers;

  const doShift = () => {
    const done = shiftForGrowth(block.id, base);
    const moved = new Set(done.flatMap((p) => p.blocks));
    for (const id of moved) persistBlockPlacement(id);
    const fillers = done.reduce((n, p) => n + p.fillers.length, 0);
    setNote(
      `Digeser: ${new Set(done.flatMap((p) => p.roads)).size} jalan, ${new Set(done.flatMap((p) => p.equipment)).size} alat, ` +
        `${moved.size} blok${fillers ? `; ${fillers} ubin penyambung ditambahkan` : ''}.`,
    );
  };

  const doResize = async () => {
    setBusy(true);
    try {
      const r = await resizeBlockInDb({ code: block.id, slots: block.slots, rows: block.rows, tiers: block.tiers });
      await load({ source: 'depot' });
      setNote(
        `Blok ${r.code} ${r.from.slots}×${r.from.rows}×${r.from.tiers} → ${r.to.slots}×${r.to.rows}×${r.to.tiers}: ` +
          `${r.inserted} baris YARD_ROWTIER ditambah, ${r.deleted} dihapus.`,
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
            ? `Geser yang terdampak (${deltaText}): ${touched.roads} jalan · ${touched.equipment} alat · ${touched.blocks} blok` +
              (touched.fillers ? ` · +${touched.fillers} ubin penyambung` : '')
            : `Tidak ada yang terdampak di sisi pertumbuhan (${deltaText}).`}
        </button>
      )}
      {source === 'depot' ? (
        <button
          type="button"
          disabled={busy}
          onClick={doResize}
          className="w-full rounded-md border border-sky-300/50 bg-sky-400/15 px-2 py-1 text-left text-[11px] leading-snug text-slate-50 disabled:opacity-50"
        >
          Simpan ukuran ke database ({base.slots}×{base.rows}×{base.tiers} → {block.slots}×{block.rows}×{block.tiers},{' '}
          {capDelta >= 0 ? '+' : ''}
          {capDelta} slot)
        </button>
      ) : (
        <div className="text-[10px] text-slate-500">Lapangan demo: ukuran hanya berubah di tampilan.</div>
      )}
      <div className="text-[10px] leading-relaxed text-slate-500">
        Mengecilkan ditolak kalau ada kontainer di luar ukuran baru; baris berisi tidak pernah dihapus.
        Blok lain yang ikut digeser posisinya tersimpan ke CORE_YARD_BLOCK.
      </div>
    </div>
  );
}

function RoadProps({ road }: { road: LayoutRoad }) {
  const update = useEditor((s) => s.updateRoad);
  const { id } = road;
  return (
    <>
      <Num label="Posisi X" value={road.x} step={0.5} onChange={(v) => update(id, { x: v })} />
      <Num label="Posisi Z" value={road.z} step={0.5} onChange={(v) => update(id, { z: v })} />
      <label className="flex items-center justify-between gap-2 py-[2px] text-[11px] text-slate-400">
        <span>Bentuk</span>
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
        label="Putar (°)"
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
          label="Panjang (m)"
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
        Ubin {ROAD.tile} x {ROAD.tile} m; jalan lurus memendek sendiri kalau ruang di depannya
        kurang dari satu ubin. Taruh berderet untuk membentuk jalur; tekan R untuk memutar 90°.
      </div>
    </>
  );
}

function EquipProps({ item }: { item: LayoutEquipment }) {
  const update = useEditor((s) => s.updateEquipment);
  const { id } = item;
  return (
    <>
      <div className="pb-1 text-[11px] text-slate-300">{EQUIPMENT_LABEL[item.kind]}</div>
      <Num label="Posisi X" value={item.x} step={0.5} onChange={(v) => update(id, { x: v })} />
      <Num label="Posisi Z" value={item.z} step={0.5} onChange={(v) => update(id, { z: v })} />
      <Num
        label="Putar (°)"
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
          Membawa kontainer
        </label>
      )}
    </>
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
    <Section title="Slot terkunci">
      <button
        type="button"
        onClick={() => setTool(active ? 'select' : 'slots')}
        className={`w-full rounded-md border py-1.5 text-[12px] ${
          active
            ? 'border-red-300/60 bg-red-400/20 text-slate-50'
            : 'border-white/15 text-slate-200 hover:border-white/30'
        }`}
      >
        {active ? (busy ? 'Menyimpan ke YARD_ROWTIER…' : 'Selesai mengunci slot') : 'Kunci / buka slot…'}
      </button>
      {/* Hasil tiap klik ditampilkan DI SINI, dekat tombolnya — bukan hanya di
          bagian bawah panel yang bisa berada di luar layar. Penolakan server
          (misalnya sel masih berisi) kalau tidak terlihat terasa seperti
          "tidak bisa dikunci" tanpa sebab. */}
      {active && note && (
        <div
          className={`mt-1.5 text-[10px] leading-relaxed ${
            /tidak bisa|gagal|ditolak|dimatikan/i.test(note) ? 'text-amber-300' : 'text-sky-300/90'
          }`}
        >
          {note}
        </div>
      )}
      <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
        {total === 0
          ? 'Belum ada slot yang dikunci. Slot terkunci tidak dihitung sebagai kapasitas.'
          : `${total} slot terkunci. Tidak dihitung sebagai kapasitas.`}
      </div>
      {rows.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between text-[11px] text-slate-300">
              <span>
                <span className="font-semibold text-slate-100">{r.id}</span> · {r.cells} slot ({r.cols} kolom)
              </span>
              <button
                type="button"
                onClick={() => clearBlocked(r.id)}
                className="text-[10px] text-slate-500 hover:text-red-300"
              >
                buka semua
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

  if (!open) {
    return (
      <Panel className="pointer-events-auto">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="px-3 py-2 text-[12px] font-medium text-slate-200 hover:text-white"
        >
          ✏️ Sunting lapangan
        </button>
      </Panel>
    );
  }

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
    <Panel className="hud-scroll pointer-events-auto max-h-[72vh] min-h-0 w-[248px] overflow-y-auto overscroll-contain">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[12px] font-semibold text-slate-100">Sunting lapangan</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-slate-500 hover:text-slate-200"
          aria-label="Tutup"
        >
          ✕
        </button>
      </div>

      {!layout ? (
        <Section title="Mulai">
          <div className="mb-2 text-[11px] leading-relaxed text-slate-400">
            Belum ada tata letak tersimpan. Salin susunan yang sedang tampil sebagai titik awal,
            lalu sunting sesukanya.
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
            Salin dari lapangan sekarang
          </button>
          {!ready && (
            <div className="mt-1.5 text-[10px] text-slate-500">
              Menunggu lapangan {source === 'demo' ? 'demo' : 'database'} selesai dimuat…
            </div>
          )}
        </Section>
      ) : (
        <>
          <Section title={selected ? 'Properti' : 'Belum ada yang dipilih'}>
            {block && <BlockProps block={block} />}
            {road && <RoadProps road={road} />}
            {equip && <EquipProps item={equip} />}
            {!selected && (
              <div className="text-[11px] leading-relaxed text-slate-500">
                {tool === 'place'
                  ? 'Klik di lapangan untuk menaruh aset yang dipilih di palet bawah.'
                  : 'Klik blok, jalan, atau alat di lapangan untuk menyuntingnya.'}
              </div>
            )}
            {selected && (
              <button
                type="button"
                onClick={removeSelected}
                className="mt-2 w-full rounded-md border border-red-400/40 py-1 text-[11px] text-red-300 hover:border-red-400/70"
              >
                Hapus objek ini
              </button>
            )}
          </Section>

          <ValidationPanel />
          <LockedSlots />

          {/* Jalan masuk kedua ke dialog blok baru. Palet bawah juga bisa, tapi
              kartunya mudah tertukar dengan kartu jalan dan alat yang
              perilakunya berbeda — yang itu ditempel di lapangan, yang ini
              menulis ke database. */}
          <Section title="Blok">
            <button
              type="button"
              onClick={() => openNewBlock({ slots: 20, rows: 6, tiers: 7 })}
              className="w-full rounded-md border border-sky-300/50 bg-sky-400/15 py-1.5 text-[12px] text-slate-50 hover:bg-sky-400/25"
            >
              + Blok baru
            </button>
            <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
              Menyisipkan baris ke CORE_YARD_BLOCK dan YARD_ROWTIER. Ukuran diatur di dialognya.
            </div>
          </Section>

          <Section title="Tata letak">
            <div className="mb-1.5 text-[10px] text-slate-500">
              {layout.blocks.length} blok · {layout.roads.length} jalan · {layout.equipment.length} alat
              {typeof data?.meta.droppedByLayout === 'number' && data.meta.droppedByLayout > 0 && (
                <span className="block text-amber-400/80">
                  {data.meta.droppedByLayout} kontainer tidak muat di blok hasil suntingan dan tidak
                  digambar
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Chip active={false} onClick={undo} title={canUndo ? 'Ctrl+Z' : 'Tidak ada riwayat'}>
                Batalkan
              </Chip>
              <Chip active={false} onClick={exportJson}>
                Ekspor JSON
              </Chip>
              <Chip active={false} onClick={() => fileRef.current?.click()}>
                Impor JSON
              </Chip>
              <Chip
                active={false}
                onClick={() => {
                  clearLayout();
                  setTool('select');
                  setNote('Tata letak dihapus — kembali ke susunan database.');
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
                setNote(importLayout(await f.text()) ?? 'Tata letak dimuat.');
              }}
            />
            {note && <div className="mt-1.5 text-[10px] text-slate-400">{note}</div>}
            {/* Hasil penulisan ke database, terpisah dari catatan impor/reset. */}
            {dbNote && (
              <div className="mt-1.5 text-[10px] leading-relaxed text-sky-300/90">{dbNote}</div>
            )}
            <div className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              Tersimpan otomatis ke database dan berlaku untuk semua pengguna: jalan dan alat ke
              YARD_LAYOUT, posisi serta sudut blok ke CORE_YARD_BLOCK.
            </div>
          </Section>
        </>
      )}
    </Panel>
  );
}
