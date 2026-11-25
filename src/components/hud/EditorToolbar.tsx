'use client';

import type { ReactNode } from 'react';
import { useEditor } from '@/store/useEditor';
import { Panel } from './ui';

function ToolBtn({
  label,
  hint,
  onClick,
  on = false,
  disabled = false,
  danger = false,
  children,
}: {
  label: string;
  hint: string;
  onClick: () => void;
  on?: boolean;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={`${label} · ${hint}`}
      className={`flex h-[34px] min-w-[34px] items-center justify-center gap-1.5 rounded-[9px] px-2 text-[12.5px] font-medium transition-colors disabled:cursor-default disabled:opacity-30 ${
        on
          ? 'bg-amber-400 text-[#1a1203]'
          : danger
            ? 'text-red-300 hover:bg-red-400/15 disabled:hover:bg-transparent'
            : 'text-slate-300 hover:bg-white/10 hover:text-white disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}

const Sep = () => <span aria-hidden="true" className="mx-1 h-[22px] w-px bg-white/[0.13]" />;
const Icon = ({ d }: { d: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    {d}
  </svg>
);

/**
 * Bilah alat editor di tengah atas (menggantikan pil angka saat Sunting),
 * seperti mockup: alat · urungkan / ulangi · hapus. Alatnya sama dengan
 * pilihan di palet bawah — keduanya membaca `tool` yang sama.
 */
export function EditorToolbar() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selected = useEditor((s) => s.selected);
  const removeSelected = useEditor((s) => s.removeSelected);
  const hasLayout = useEditor((s) => s.layout !== null);

  return (
    <Panel className="pointer-events-auto flex h-11 items-center gap-0.5 px-1">
      <div role="group" aria-label="Tools" className="flex gap-0.5">
        <ToolBtn label="Select & move" hint="Esc" on={tool === 'select'} onClick={() => setTool('select')}>
          <Icon d={<path d="M5 3l14 8-6 2-3 6z" />} />
        </ToolBtn>
        <ToolBtn label="Lock slots" hint="click a slot in a block" on={tool === 'slots'} onClick={() => setTool(tool === 'slots' ? 'select' : 'slots')}>
          <Icon
            d={
              <>
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </>
            }
          />
        </ToolBtn>
        <ToolBtn label="Connect road" hint="click two points" on={tool === 'connect'} onClick={() => setTool(tool === 'connect' ? 'select' : 'connect')}>
          <Icon d={<path d="M8 3 5 21M16 3l3 18M12 4v3M12 11v3M12 18v2" />} />
        </ToolBtn>
      </div>
      <Sep />
      <div role="group" aria-label="History" className="flex gap-0.5">
        <ToolBtn label="Undo" hint="Ctrl+Z" disabled={!canUndo} onClick={undo}>
          <Icon
            d={
              <>
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
              </>
            }
          />
          <span className="hidden xl:inline">Undo</span>
        </ToolBtn>
        <ToolBtn label="Redo" hint="Ctrl+Y · Ctrl+Shift+Z" disabled={!canRedo} onClick={redo}>
          <Icon
            d={
              <>
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H10a6 6 0 0 0 0 12h3" />
              </>
            }
          />
          <span className="hidden xl:inline">Redo</span>
        </ToolBtn>
      </div>
      <Sep />
      <ToolBtn label="Delete selected object" hint="Del" danger disabled={!hasLayout || !selected} onClick={removeSelected}>
        <Icon d={<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />} />
      </ToolBtn>
    </Panel>
  );
}
