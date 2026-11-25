'use client';

import type { CSSProperties, ReactNode } from 'react';

export const nf = (n: number) => n.toLocaleString('en-US');

export function Panel({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  /** Untuk ukuran yang datang dari konstanta kode, bukan dari kelas Tailwind. */
  style?: CSSProperties;
}) {
  return (
    <div className={`hud-panel ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Judul kecil berhuruf kapital di dalam panel (gaya "h" mockup). */
export function Heading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${className}`}>{children}</div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-white/[0.07] px-3.5 py-3 first:border-t-0">
      <Heading className="mb-2">{title}</Heading>
      {children}
    </div>
  );
}

/**
 * Tombol pilihan / chip. `count` tampil di kanan (jumlah kontainer), `color`
 * kotak warna di kiri. Aktif = tepi kuning; tidak aktif = redup.
 */
export function Chip({
  active,
  onClick,
  color,
  children,
  title,
  count,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
  title?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-8 min-w-0 items-center gap-1.5 rounded-[9px] border px-2.5 text-[12px] font-medium leading-none transition-colors ${
        active
          ? 'border-amber-400/80 bg-amber-400/10 text-slate-50 shadow-[0_0_0_3px_rgba(245,165,36,0.12)]'
          : 'border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-white/20 hover:text-slate-100'
      }`}
    >
      {color && (
        <span
          className="h-3 w-3 shrink-0 rounded-[3px] ring-1 ring-white/10"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{children}</span>
      {count !== undefined && (
        <span className="ml-auto pl-1 font-mono text-[10.5px] tabular-nums text-slate-500">{nf(count)}</span>
      )}
    </button>
  );
}

/** Tombol biasa di panel (Putar ulang, Jalankan RS, …). */
export function Btn({
  onClick,
  active = false,
  children,
  title,
  className = '',
}: {
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-[34px] items-center justify-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-medium transition-colors ${
        active
          ? 'border-amber-400/80 bg-amber-400/15 text-slate-50'
          : 'border-white/[0.13] bg-[#181b23]/80 text-slate-100 hover:border-sky-400/70'
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** Pilihan bersegmen (kecepatan, cuaca). */
export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  mono = false,
}: {
  value: T;
  options: { v: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-0.5 rounded-[10px] bg-white/[0.06] p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          title={o.title}
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`h-7 rounded-[7px] text-[12px] font-semibold transition-colors ${mono ? 'font-mono' : ''} ${
            value === o.v ? 'bg-[#20242e] text-slate-50 shadow-[0_1px_2px_rgba(0,0,0,0.25)]' : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Saklar. Isinya label; bagian dalam kurung yang dulu ditulis abu-abu
 * (`<span className="text-slate-500">`) tetap terbaca sebagai keterangan.
 */
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-[38px] cursor-pointer items-center gap-3 py-1 text-[12.5px] font-medium text-slate-200 hover:text-white">
      <span className="min-w-0 flex-1 [&_.text-slate-500]:mt-0.5 [&_.text-slate-500]:block [&_.text-slate-500]:text-[11px] [&_.text-slate-500]:font-normal">
        {children}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="relative h-5 w-[34px] shrink-0 rounded-full bg-white/15 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-[left] peer-checked:bg-amber-400 peer-checked:after:left-4 peer-focus-visible:ring-2 peer-focus-visible:ring-sky-400"
      />
    </label>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[64px]">
      <div className="font-mono text-[15px] font-semibold tabular-nums tracking-tight text-slate-50">{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-500">{label}</div>
      {hint && <div className="text-[10px] tabular-nums text-slate-500">{hint}</div>}
    </div>
  );
}

/**
 * Label kelompok chip di DALAM sebuah Section.
 *
 * Ada karena tiga deret chip filter — status, ukuran, jenis — sebelumnya
 * ditumpuk tanpa keterangan apa pun di bawah judul "Status", jadi ketiganya
 * terbaca seolah satu daftar status yang panjang.
 */
export function SubLabel({ children }: { children: ReactNode }) {
  return <Heading className="mb-1.5 mt-3 first:mt-0">{children}</Heading>;
}
