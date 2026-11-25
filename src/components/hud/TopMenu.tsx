'use client';

import { useEffect, useRef, useState } from 'react';
import { useDock } from '@/store/useDock';
import { useYard } from '@/store/useYard';

const iconBtn =
  'flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white';

/**
 * Tombol di kartu kanan atas, seperti mockup: palet perintah (Ctrl K),
 * Malam (ikon bulan — menyalakan lampu tiang), dan menu ⋯ berisi aksi yang
 * jarang dipakai.
 */
export function TopMenu() {
  const setPalette = useDock((s) => s.setPalette);
  const setShortcuts = useDock((s) => s.setShortcuts);
  const night = useYard((s) => s.options.night);
  const autoSky = useYard((s) => s.options.autoSky);
  const options = useYard((s) => s.options);
  const setOption = useYard((s) => s.setOption);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item = (label: string, run: () => void, hint?: string, on?: boolean) => (
    <button
      key={label}
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        run();
      }}
      className="flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] text-slate-200 hover:bg-white/10"
    >
      <span className="flex-1">{label}</span>
      {on !== undefined && (
        <span className={`font-mono text-[10.5px] ${on ? 'text-amber-400' : 'text-slate-500'}`}>{on ? 'ON' : 'OFF'}</span>
      )}
      {hint && <kbd className="font-mono text-[10.5px] text-slate-500">{hint}</kbd>}
    </button>
  );

  return (
    <>
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-white/10" />
      <button type="button" onClick={() => setPalette(true)} className={iconBtn} aria-label="Command palette (Ctrl K)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="hidden 2xl:inline">Search</span>
        <kbd className="rounded-[5px] border border-white/15 px-1.5 py-px font-mono text-[10.5px] text-slate-400">Ctrl K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setOption('night', !night)}
        disabled={autoSky}
        aria-pressed={night}
        aria-label="Night (pole lights on)"
        title={autoSky ? 'Night is set by "Follow clock"' : 'Night · pole lights on'}
        className={`${iconBtn} ${night ? 'bg-amber-400/15 text-amber-300' : ''} disabled:opacity-40`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More options"
          className={`${iconBtn} ${open ? 'bg-white/10 text-white' : ''}`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </button>
        {open && (
          <div role="menu" className="hud-panel hud-pop absolute right-0 top-[42px] z-50 w-[248px] p-1.5">
            {item('Command palette', () => setPalette(true), 'Ctrl K')}
            {item('Reload data', () => void useYard.getState().load())}
            <div className="my-1 h-px bg-white/10" />
            {item('Monitor screen (kiosk)', () => setOption('kiosk', true), 'Esc')}
            {item('Tour mode', () => setOption('tour', !options.tour), undefined, options.tour)}
            {item('2D plan', () => setOption('view2d', !options.view2d), undefined, options.view2d)}
            {item('Follow clock', () => setOption('autoSky', !options.autoSky), undefined, options.autoSky)}
            <div className="my-1 h-px bg-white/10" />
            {item('Keyboard shortcuts', () => setShortcuts(true), '?')}
          </div>
        )}
      </div>
    </>
  );
}
