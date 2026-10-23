'use client';

import type { CSSProperties, ReactNode } from 'react';

export const nf = (n: number) => n.toLocaleString('id-ID');

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

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-t border-white/10 px-3 py-2.5 first:border-t-0">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  color,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] leading-none transition-colors ${
        active
          ? 'border-sky-300/70 bg-sky-400/15 text-slate-50'
          : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:text-slate-100'
      }`}
    >
      {color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{children}</span>
    </button>
  );
}

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
    <label className="flex cursor-pointer items-center gap-2 py-0.5 text-[12px] text-slate-300 hover:text-slate-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-sky-400"
      />
      {children}
    </label>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[74px]">
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="text-[15px] font-semibold tabular-nums text-slate-50">{value}</div>
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
  return <div className="mb-1 mt-2.5 text-[10px] text-slate-500 first:mt-0">{children}</div>;
}
