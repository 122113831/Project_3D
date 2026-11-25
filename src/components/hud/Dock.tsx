'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { DOCK_TABS, dockTabForKey, type DockTab } from '@/lib/dock';
import { useDock } from '@/store/useDock';
import { useRsWorks } from '@/store/useRsWorks';
import { useTraffic } from '@/store/useTraffic';
import { useYard } from '@/store/useYard';

const ICON: Record<DockTab | 'indicators', ReactNode> = {
  color: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8.5" cy="10" r="1.3" />
      <circle cx="12" cy="7.5" r="1.3" />
      <circle cx="15.5" cy="10" r="1.3" />
      <path d="M12 21a3 3 0 0 1 0-6h2" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
  traffic: (
    <>
      <rect x="2" y="8" width="12" height="8" rx="1" />
      <path d="M14 11h4l3 3v2h-7" />
      <circle cx="6" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </>
  ),
  options: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  indicators: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
};

export function DockIcon({ id, size = 19 }: { id: DockTab | 'indicators'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
      {ICON[id]}
    </svg>
  );
}

/**
 * Dok menu kaca di tengah bawah: empat menu tampilan + tombol indikator.
 * Menekan menu membuka panelnya di kiri (DockPanel); menekan lagi menutup.
 * Pintasan 1–5, Esc menutup panel.
 */
export function Dock() {
  const tab = useDock((s) => s.tab);
  const indicators = useDock((s) => s.indicators);
  const toggleTab = useDock((s) => s.toggleTab);
  const closeTab = useDock((s) => s.closeTab);
  const toggleIndicators = useDock((s) => s.toggleIndicators);
  const filter = useYard((s) => s.filter);
  const options = useYard((s) => s.options);
  const replaying = useTraffic((s) => s.replaying);
  const trucks = useTraffic((s) => Object.keys(s.trips).length);
  const rsBusy = useRsWorks((s) => s.busy.length);

  const hasFilter = filter.lines.length + filter.statuses.length + filter.sizes.length + filter.types.length > 0;
  const trafficLive = replaying || trucks > 0 || rsBusy > 0;
  const optionsLit = options.night || options.weather !== 'off' || options.tour;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Layar inspeksi terbuka di atas HUD: pintasan dok tidak berlaku.
      if (useYard.getState().selected) return;
      // Target bisa window/document (event yang dikirim kode lain), bukan
      // elemen — `closest` hanya ada di Element.
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (useDock.getState().tab) closeTab();
        return;
      }
      const hit = dockTabForKey(e.key);
      if (!hit) return;
      e.preventDefault();
      if (hit === 'indicators') toggleIndicators();
      else toggleTab(hit);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTab, closeTab, toggleIndicators]);

  // Penanda kuning meluncur ke tombol aktif.
  const rowRef = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const btn = tab ? rowRef.current?.querySelector<HTMLElement>(`[data-dock="${tab}"]`) : null;
    setInd(btn ? { left: btn.offsetLeft, width: btn.offsetWidth } : null);
  }, [tab]);

  const dot = (id: DockTab) =>
    id === 'filter' && hasFilter ? 'filter' : id === 'traffic' && trafficLive ? 'live' : id === 'options' && optionsLit ? 'lit' : null;

  return (
    <nav aria-label="Display menu" className="hud-glass hud-dock pointer-events-auto">
      <div ref={rowRef} className="relative flex gap-0.5">
        <span
          aria-hidden="true"
          className="hud-dock-ind"
          style={ind ? { left: ind.left, width: ind.width, opacity: 1 } : { opacity: 0 }}
        />
        {DOCK_TABS.map((t, i) => {
          const on = tab === t.id;
          const d = dot(t.id);
          return (
            <button
              key={t.id}
              type="button"
              data-dock={t.id}
              aria-pressed={on}
              title={`${t.title} · ${i + 1}`}
              onClick={() => toggleTab(t.id)}
              className={`hud-dock-btn ${on ? 'is-on' : ''}`}
            >
              <kbd>{i + 1}</kbd>
              <DockIcon id={t.id} />
              {t.label}
              {d && <i className={`hud-dock-dot ${d === 'live' ? 'is-live' : ''}`} />}
            </button>
          );
        })}
        <span aria-hidden="true" className="mx-1 my-3 w-px bg-white/15" />
        <button
          type="button"
          aria-pressed={indicators}
          title={`Indicators · ${DOCK_TABS.length + 1}`}
          onClick={toggleIndicators}
          className={`hud-dock-btn ${indicators ? 'is-on2' : ''}`}
        >
          <kbd>{DOCK_TABS.length + 1}</kbd>
          <DockIcon id="indicators" />
          Indicators
        </button>
      </div>
    </nav>
  );
}
