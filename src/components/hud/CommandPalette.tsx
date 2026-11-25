'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DOCK_TABS } from '@/lib/dock';
import { COLOR_MODE_LABEL } from '@/lib/palette';
import type { ColorMode } from '@/lib/types';
import { useDock } from '@/store/useDock';
import { useEditor } from '@/store/useEditor';
import { runRsDemo } from '@/store/useRsWorks';
import { useTraffic } from '@/store/useTraffic';
import { useYard, type ViewOptions } from '@/store/useYard';

type Cmd = { group: string; label: string; hint?: string; run: () => void };

const TOGGLES: [keyof ViewOptions, string][] = [
  ['equipLabels', 'Equipment names'],
  ['blockInfo', 'Block capacity'],
  ['labels', 'Container numbers'],
  ['night', 'Night'],
  ['shadows', 'Shadows'],
  ['alerts', 'Alerts'],
  ['view2d', '2D plan'],
  ['tour', 'Tour mode'],
  ['autoSky', 'Follow clock'],
];

/** Ctrl K: semua menu, saklar, aksi, dan pencarian kontainer dalam satu kotak. */
function useCommands(query: string): Cmd[] {
  const data = useYard((s) => s.data);
  const options = useYard((s) => s.options);
  const colorMode = useYard((s) => s.colorMode);
  const followRtg = useTraffic((s) => s.followRtg);
  const editing = useEditor((s) => s.open);

  const base = useMemo<Cmd[]>(() => {
    const y = useYard.getState;
    const dock = useDock.getState;
    return [
      ...DOCK_TABS.map((t, i) => ({ group: 'Menu', label: `Open ${t.title}`, hint: String(i + 1), run: () => dock().tab !== t.id && dock().toggleTab(t.id) })),
      { group: 'Menu', label: 'Show / hide indicators', hint: '5', run: () => dock().toggleIndicators() },
      { group: 'Menu', label: editing ? 'Back to Monitor' : 'Edit yard', run: () => useEditor.getState().setOpen(!editing) },
      ...(['none', 'line', 'status', 'size', 'tier'] as ColorMode[]).map((m) => ({
        group: 'Color by',
        label: `Color by: ${COLOR_MODE_LABEL[m]}`,
        hint: colorMode === m ? 'active' : undefined,
        run: () => y().setColorMode(m),
      })),
      { group: 'Traffic', label: 'Replay last 20 trips', run: () => void useTraffic.getState().replay(20) },
      { group: 'Traffic', label: 'Stop traffic', run: () => useTraffic.getState().stop() },
      { group: 'Traffic', label: 'Run RS', run: () => useTraffic.setState({ note: runRsDemo() }) },
      { group: 'Traffic', label: followRtg ? 'Stop following equipment' : 'Follow working equipment', run: () => useTraffic.getState().setFollowRtg(!followRtg) },
      ...TOGGLES.map(([k, label]) => ({
        group: 'Display',
        label: `${label}: ${options[k] ? 'turn off' : 'turn on'}`,
        hint: options[k] ? 'ON' : 'OFF',
        run: () => y().setOption(k, !options[k] as never),
      })),
      { group: 'Display', label: 'Monitor screen (kiosk)', hint: 'Esc to exit', run: () => y().setOption('kiosk', true) },
      { group: 'Data', label: 'Clear all filters', run: () => y().resetFilter() },
      { group: 'Data', label: 'Reload data', run: () => void y().load() },
      { group: 'Help', label: 'Keyboard shortcuts', hint: '?', run: () => dock().setShortcuts(true) },
    ];
  }, [options, colorMode, followRtg, editing]);

  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const cmds = q ? base.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q)) : base;
    // Nomor kontainer: dicari begitu ada dua karakter, paling banyak 8 hasil.
    const Q = query.trim().toUpperCase().replace(/\s+/g, '');
    const ctrs: Cmd[] = [];
    if (Q.length >= 2 && data) {
      for (const b of data.blocks) {
        for (const c of b.containers) {
          if (!c.no.includes(Q)) continue;
          ctrs.push({
            group: 'Container',
            label: c.no,
            hint: `${c.block} · bay ${c.bay + 1} · row ${c.row + 1} · tier ${c.tier}`,
            run: () => useYard.getState().locate(c),
          });
          if (ctrs.length >= 8) break;
        }
        if (ctrs.length >= 8) break;
      }
    }
    return [...ctrs, ...cmds];
  }, [base, query, data]);
}

function Modal({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[60] flex items-start justify-center bg-black/45 px-4 pt-[12vh] backdrop-blur-[3px]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={label} className="hud-panel hud-pop w-full max-w-[560px] overflow-hidden">
        {children}
      </div>
    </div>
  );
}

export function CommandPalette() {
  const open = useDock((s) => s.palette);
  const setPalette = useDock((s) => s.setPalette);
  const shortcuts = useDock((s) => s.shortcuts);
  const setShortcuts = useDock((s) => s.setShortcuts);

  // Ctrl K membuka / menutup, "?" menampilkan pintasan.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(!useDock.getState().palette);
        return;
      }
      const t = e.target;
      if (t instanceof HTMLElement && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      if (e.key === '?') setShortcuts(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette, setShortcuts]);

  return (
    <>
      {open && <Palette onClose={() => setPalette(false)} />}
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const list = useCommands(query);
  const listRef = useRef<HTMLDivElement>(null);
  const cur = Math.min(sel, Math.max(0, list.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  const run = (i: number) => {
    const c = list[i];
    if (!c) return;
    onClose();
    c.run();
  };

  let lastGroup = '';
  return (
    <Modal onClose={onClose} label="Command palette">
      <label htmlFor="cmdk" className="sr-only">
        Search commands or container numbers
      </label>
      <input
        id="cmdk"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setSel(Math.max(0, Math.min(list.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            run(cur);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Type a command, menu, or container number…"
        autoComplete="off"
        spellCheck={false}
        className="h-[52px] w-full border-b border-white/10 bg-transparent px-[18px] text-[15px] text-slate-50 placeholder:text-slate-500 focus:outline-none"
      />
      <div ref={listRef} className="hud-scroll max-h-[52vh] overflow-y-auto p-1.5">
        {list.length === 0 && <p className="m-0 px-3.5 py-3 text-[13px] text-slate-400">No matches.</p>}
        {list.map((c, i) => {
          const head = c.group !== lastGroup;
          lastGroup = c.group;
          return (
            <div key={`${c.group}|${c.label}`}>
              {head && (
                <div className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">{c.group}</div>
              )}
              <button
                type="button"
                data-on={i === cur}
                onMouseMove={() => i !== cur && setSel(i)}
                onClick={() => run(i)}
                className={`flex h-[38px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] ${
                  i === cur ? 'bg-white/10 text-white' : 'text-slate-200'
                }`}
              >
                <span className={`flex-1 truncate ${c.group === 'Container' ? 'font-mono font-semibold' : ''}`}>{c.label}</span>
                {c.hint && <kbd className="shrink-0 font-mono text-[10.5px] text-slate-500">{c.hint}</kbd>}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

const KEYS: [string, string][] = [
  ['1 – 4', 'Open Color · Filter · Gate · Display'],
  ['5', 'Show / hide indicators'],
  ['Esc', 'Close panel / dialog'],
  ['Ctrl K', 'Command palette'],
  ['?', 'This shortcut list'],
  ['Enter', 'Search container number (in search box)'],
  ['Ctrl Z', 'Undo (Edit mode)'],
  ['Ctrl Y', 'Redo (Edit mode) · also Ctrl Shift Z'],
  ['Del', 'Delete selected object (Edit mode)'],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <Modal onClose={onClose} label="Keyboard shortcuts">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="m-0 text-[16px] font-semibold text-slate-50">Keyboard shortcuts</h2>
        <button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-[12.5px] text-slate-300 hover:bg-white/10">
          Close
        </button>
      </div>
      <div className="px-5 pb-5">
        {KEYS.map(([k, t]) => (
          <div key={k} className="flex items-center justify-between border-b border-white/[0.07] py-2 text-[13px] last:border-0">
            <span className="text-slate-300">{t}</span>
            <kbd className="rounded-[5px] border border-white/15 bg-white/[0.06] px-1.5 py-px font-mono text-[11px] text-slate-100">{k}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}
