'use client';

import { useEffect, useRef } from 'react';
import { DOCK_TABS, PANEL_W } from '@/lib/dock';
import { useDock } from '@/store/useDock';
import { ControlPanel } from './ControlPanel';
import { DockIcon } from './Dock';

/**
 * Panel kiri yang dibuka dari dok. Selalu terpasang supaya animasi tutup
 * sempat terlihat: saat tertutup isinya tetap menu terakhir (`last`), hanya
 * kelasnya yang berubah. Pindah menu saat terbuka = panel diam, isinya
 * bergeser halus (kelas `is-swap`).
 */
export function DockPanel() {
  const tab = useDock((s) => s.tab);
  const last = useDock((s) => s.last);
  const closeTab = useDock((s) => s.closeTab);
  const open = tab !== null;
  const shown = tab ?? last;
  const meta = DOCK_TABS.find((t) => t.id === shown)!;

  const bodyRef = useRef<HTMLDivElement>(null);
  const prev = useRef(tab);
  useEffect(() => {
    const el = bodyRef.current;
    if (el && prev.current && tab && prev.current !== tab) {
      el.classList.remove('is-swap');
      void el.offsetWidth; // mulai ulang animasi
      el.classList.add('is-swap');
    }
    prev.current = tab;
  }, [tab]);

  return (
    <aside
      aria-label={meta.title}
      aria-hidden={!open}
      inert={!open}
      className={`hud-glass hud-dock-panel pointer-events-auto flex min-h-0 flex-col ${open ? '' : 'is-closed'}`}
      style={{ width: PANEL_W }}
    >
      <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-amber-400/15 text-amber-400">
          <DockIcon id={shown} size={18} />
        </span>
        <div className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight text-slate-50">{meta.title}</div>
        <button
          type="button"
          onClick={closeTab}
          aria-label="Close panel (Esc)"
          title="Close · Esc"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-100"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div ref={bodyRef} className="hud-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <ControlPanel only={shown} />
      </div>
    </aside>
  );
}
