/**
 * Angka untuk panel tampilan — MURNI, supaya diuji.
 *
 * Jumlah di chip filter memakai predikat yang SAMA dengan filter lapangan
 * (instances.ts), dan legenda pewarnaan memakai colorFor yang sama dengan
 * renderer — jadi angka di panel tidak bisa berbeda dari yang tergambar.
 */
import { statusMatch, typeMatch } from './instances';
import { colorFor, colorForLine, STATUS_COLOR, STATUS_LABEL, TYPE_FILTER_COLOR, TYPE_FILTER_LABEL } from './palette';
import type { ColorMode, ContainerSize, ContainerStatus, TypeFilter, YardContainer } from './types';

const STATUSES: ContainerStatus[] = ['full', 'empty', 'reefer', 'dangerous', 'damaged'];
const FILTER_STATUSES: ContainerStatus[] = ['full', 'empty', 'dangerous', 'damaged'];
const TYPES: TypeFilter[] = ['gp', 'tank', 'reefer'];
const SIZES: ContainerSize[] = [20, 40];

export type FilterCounts = {
  lines: Record<string, number>;
  statuses: Record<ContainerStatus, number>;
  sizes: Record<ContainerSize, number>;
  types: Record<TypeFilter, number>;
};

export function filterCounts(items: readonly YardContainer[]): FilterCounts {
  const out: FilterCounts = {
    lines: {},
    statuses: { full: 0, empty: 0, reefer: 0, dangerous: 0, damaged: 0 },
    sizes: { 20: 0, 40: 0 },
    types: { gp: 0, tank: 0, reefer: 0 },
  };
  for (const c of items) {
    out.lines[c.line] = (out.lines[c.line] ?? 0) + 1;
    for (const s of FILTER_STATUSES) if (statusMatch(c, s)) out.statuses[s]++;
    out.sizes[c.size]++;
    for (const t of TYPES) if (typeMatch(c, t)) out.types[t]++;
  }
  return out;
}

export type LegendRow = { key: string; label: string; color: string; n: number };

const stub = (p: Partial<YardContainer>) => p as YardContainer;

/** Baris legenda untuk mode pewarnaan yang aktif. */
export function legendFor(mode: ColorMode, items: readonly YardContainer[], lines: readonly string[]): LegendRow[] {
  switch (mode) {
    case 'none':
      return TYPES.map((t) => ({ key: t, label: TYPE_FILTER_LABEL[t], color: TYPE_FILTER_COLOR[t], n: items.filter((c) => typeMatch(c, t)).length }));
    case 'line':
      return lines.map((l) => ({ key: l, label: l, color: colorForLine(l), n: items.filter((c) => c.line === l).length }));
    case 'status':
      return STATUSES.map((s) => ({ key: s, label: STATUS_LABEL[s], color: STATUS_COLOR[s], n: items.filter((c) => c.status === s).length })).filter((r) => r.n > 0);
    case 'size':
      return SIZES.map((s) => ({ key: String(s), label: `${s} ft`, color: colorFor(stub({ size: s }), 'size'), n: items.filter((c) => c.size === s).length }));
    case 'tier':
      return [1, 2, 3, 4, 5].map((t) => ({
        key: String(t),
        label: t === 5 ? 'Tier 5+' : `Tier ${t}`,
        color: colorFor(stub({ tier: t }), 'tier'),
        n: items.filter((c) => (t === 5 ? c.tier >= 5 : c.tier === t)).length,
      }));
  }
}

/** Contoh warna kecil di kartu mode pewarnaan. */
export function modeSwatches(mode: ColorMode, lines: readonly string[]): string[] {
  switch (mode) {
    case 'none':
      return TYPES.map((t) => TYPE_FILTER_COLOR[t]);
    case 'line':
      return lines.slice(0, 4).map(colorForLine);
    case 'status':
      return FILTER_STATUSES.map((s) => STATUS_COLOR[s]);
    case 'size':
      return SIZES.map((s) => colorFor(stub({ size: s }), 'size'));
    case 'tier':
      return [1, 2, 3, 4].map((t) => colorFor(stub({ tier: t }), 'tier'));
  }
}
