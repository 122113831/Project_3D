'use client';

import { useRef, useState } from 'react';
import { PITCH, ROAD, ROAD_KINDS, ROAD_LABEL, type RoadKind } from '@/lib/constants';
import type { BlockSide } from '@/lib/types';
import { EQUIPMENT_LABEL, type LayoutBlock, type LayoutEquipment, type LayoutRoad } from '@/lib/layout';
import { persistBlockPlacement } from '@/lib/persist';
import { MIN_LEN, roadLen } from '@/lib/roadSnap';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';
import { Chip, Panel, Section } from './ui';

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
      <div className="mt-1 text-[10px] text-slate-500">
        {(block.slots * PITCH.teu).toFixed(1)} x {(block.rows * PITCH.row).toFixed(1)} m ·{' '}
        {block.slots * block.rows * block.tiers} slot
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
        Seret blok ini di lapangan untuk memindahkannya, atau tekan R untuk memutar 15°
        (Shift+R sebaliknya). Posisi dan sudut tersimpan ke CORE_YARD_BLOCK.
      </div>
      <div className="mt-1 text-[10px] leading-relaxed text-amber-400/70">
        Slot, row, dan tier di atas hanya mengubah tampilan — mengubahnya di database berarti
        menambah atau menghapus baris YARD_ROWTIER, dan itu belum dibuat.
      </div>
    </>
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
    <Panel className="pointer-events-auto w-[248px] overflow-hidden">
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
