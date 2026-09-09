'use client';

import { useEffect, useRef, useState } from 'react';
import { PITCH, YARD } from '@/lib/constants';
import type { BlockSide } from '@/lib/types';
import { layoutFromData } from '@/lib/layout';
import { worldToMap } from '@/lib/mapCoords';
import { createBlockInDb, fetchWriteTarget, type WriteTarget } from '@/lib/yardApi';
import { useEditor } from '@/store/useEditor';
import { useYard } from '@/store/useYard';

/** Satu baris masukan berlabel. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

const INPUT =
  'w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[13px] text-slate-100 outline-none focus:border-sky-400/70';

/**
 * Dialog "blok baru" — satu-satunya jalan membuat blok yang benar-benar ada di
 * database.
 *
 * Menekan Simpan menulis ke DUA tabel dalam satu transaksi: satu baris di
 * CORE_YARD_BLOCK, dan satu baris YARD_ROWTIER untuk setiap slot x row x tier.
 * Karena itu jumlah barisnya ditampilkan SEBELUM tombolnya ditekan, lengkap
 * dengan server tujuannya — menulis dua ribu baris ke lingkungan yang salah
 * tidak boleh jadi kejutan.
 */
export function NewBlockDialog() {
  const preset = useEditor((s) => s.newBlock);
  const close = useEditor((s) => s.closeNewBlock);
  const busy = useEditor((s) => s.busy);
  const setBusy = useEditor((s) => s.setBusy);
  const setNote = useEditor((s) => s.setNote);
  const layout = useEditor((s) => s.layout);
  const adoptBlock = useEditor((s) => s.adoptBlock);

  const data = useYard((s) => s.data);
  const load = useYard((s) => s.load);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [slots, setSlots] = useState(20);
  const [rows, setRows] = useState(6);
  const [tiers, setTiers] = useState(5);
  const [truckLane, setTruckLane] = useState<BlockSide>('L');
  const [slotStart, setSlotStart] = useState<BlockSide>('L');
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<WriteTarget | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  // Ukuran awal datang dari kartu palet yang diklik, jadi memilih "Blok lebar"
  // benar-benar berarti sesuatu, bukan sekadar membuka dialog kosong.
  useEffect(() => {
    if (!preset) return;
    setSlots(preset.slots);
    setRows(preset.rows);
    setTiers(preset.tiers);
    setTruckLane('L');
    setSlotStart('L');
    setError(null);
    // Kode berikutnya yang belum terpakai, supaya tidak perlu diketik manual.
    const used = new Set((data?.blocks ?? []).map((b) => b.id.trim().toUpperCase()));
    let next = '';
    for (let i = 0; i < 26 && !next; i++) {
      const c = String.fromCharCode(65 + i);
      if (!used.has(c)) next = c;
    }
    setCode(next);
    setName(next);
    void fetchWriteTarget().then(setTarget);
    setTimeout(() => firstField.current?.select(), 0);
  }, [preset, data]);

  useEffect(() => {
    if (!preset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preset, close]);

  if (!preset) return null;

  const transform = data?.meta.mapTransform ?? null;
  const cells = slots * rows * tiers;
  const length = slots * PITCH.teu;
  const width = rows * PITCH.row;

  const blocked = !transform
    ? 'Skala peta belum dipaku. Isi DEPOT_MAP_SCALE di .env — tanpa itu posisi blok tidak akan kembali ke tempat yang sama setelah dimuat ulang.'
    : target && !target.enabled
      ? 'Penulisan ke database dimatikan. Set DEPOT_DB_WRITE=true di .env.'
      : null;

  const submit = async () => {
    if (!transform || busy) return;
    setError(null);
    setBusy(true);
    try {
      // Blok baru ditaruh di bawah blok paling selatan, terpisah selebar satu
      // lorong RTG. Tempat yang pasti kosong dan pasti terlihat — pengguna
      // tinggal menyeretnya ke tempat yang dia mau.
      const existing = data?.blocks ?? [];
      const southEdge = existing.length
        ? Math.max(...existing.map((b) => b.originZ + b.rows * PITCH.row))
        : -width / 2;
      const originZ = southEdge + YARD.gapZ;

      // Yang disejajarkan adalah PUSAT blok, bukan tepi kirinya.
      //
      // Kolom X menyimpan pusat blok pada sumbu panjangnya. Menyejajarkan tepi
      // kiri blok pendek dengan blok panjang akan melempar pusatnya jauh ke
      // kiri — terukur X = -31,6 sementara blok yang ada berkisar 121–127.
      // Letaknya di layar tetap benar, tapi angkanya jadi asing bagi peta TOS
      // yang membaca kolom yang sama.
      const centerX = existing.length
        ? existing.reduce((sum, b) => sum + b.originX + (b.slots * PITCH.teu) / 2, 0) /
          existing.length
        : 0;
      const originX = centerX - length / 2;

      const { mapX, mapY } = worldToMap(transform, { originX, originZ, slots });
      const res = await createBlockInDb({
        code: code.trim().toUpperCase(),
        name: name.trim() || code.trim().toUpperCase(),
        slots,
        rows,
        tiers,
        mapX,
        mapY,
        rotDeg: 0,
        truckLane,
        slotStart,
      });

      // Dibaca ulang dari database, bukan ditebak dari masukan: yang tampil
      // setelah ini benar-benar isi tabel, termasuk kalau server membulatkan
      // atau memangkas sesuatu.
      await load({ source: 'depot' });
      const fresh = useYard.getState().data;
      const created = fresh?.blocks.find((b) => b.id.trim().toUpperCase() === res.code);
      // Tata letak lokal hanya menggambar blok yang terdaftar di dalamnya, jadi
      // blok baru harus diadopsi — kalau tidak, ia tersimpan tapi tak terlihat.
      if (created && layout) {
        const [lb] = layoutFromData({ ...fresh!, blocks: [created] });
        adoptBlock(lb);
      }
      setNote(`Blok ${res.code} dibuat: ${res.slotRows.toLocaleString('id-ID')} baris slot.`);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="hud-panel w-[330px] overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <span className="text-[13px] font-semibold text-slate-100">Blok baru</span>
          <button
            type="button"
            onClick={close}
            className="text-slate-500 hover:text-slate-200"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2.5 px-3 py-3">
          <Field label="Kode blok" hint="1–5 huruf/angka, harus unik di CORE_YARD_BLOCK">
            <input
              ref={firstField}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
              className={INPUT}
            />
          </Field>
          <Field label="Nama blok">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              className={INPUT}
            />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label="Slot">
              <input
                type="number"
                min={1}
                value={slots}
                onChange={(e) => setSlots(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                className={INPUT}
              />
            </Field>
            <Field label="Row">
              <input
                type="number"
                min={1}
                value={rows}
                onChange={(e) => setRows(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                className={INPUT}
              />
            </Field>
            <Field label="Tier">
              <input
                type="number"
                min={1}
                value={tiers}
                onChange={(e) => setTiers(Math.max(1, Math.round(Number(e.target.value) || 1)))}
                className={INPUT}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Lajur truk" hint="CORE_YARD_BLOCK.TRUCK_LANE">
              <select
                value={truckLane}
                onChange={(e) => setTruckLane(e.target.value as BlockSide)}
                className={INPUT}
              >
                <option value="L">Kiri</option>
                <option value="R">Kanan</option>
              </select>
            </Field>
            <Field label="Mulai slot" hint="CORE_YARD_BLOCK.SLOT_START">
              <select
                value={slotStart}
                onChange={(e) => setSlotStart(e.target.value as BlockSide)}
                className={INPUT}
              >
                <option value="L">Kiri</option>
                <option value="R">Kanan</option>
              </select>
            </Field>
          </div>

          <div className="rounded-md border border-white/10 bg-black/25 px-2.5 py-2 text-[11px] leading-relaxed text-slate-400">
            <div>
              Ukuran {length.toFixed(1)} x {width.toFixed(1)} m
            </div>
            <div>
              Menulis <span className="text-slate-200">1</span> baris CORE_YARD_BLOCK dan{' '}
              <span className="text-slate-200">{cells.toLocaleString('id-ID')}</span> baris
              YARD_ROWTIER.
            </div>
            {target && (
              <div className="mt-1 truncate text-slate-500">ke {target.target}</div>
            )}
          </div>

          {blocked && (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">
              {blocked}
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-md border border-white/10 py-1.5 text-[12px] text-slate-300 hover:border-white/25"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={busy || !!blocked}
              onClick={() => void submit()}
              className="flex-1 rounded-md border border-sky-300/50 bg-sky-400/20 py-1.5 text-[12px] text-slate-50 disabled:opacity-40"
            >
              {busy ? 'Menyimpan…' : 'Simpan ke database'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
