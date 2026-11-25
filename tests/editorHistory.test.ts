import { beforeEach, describe, expect, it } from 'vitest';
import type { YardLayout } from '@/lib/layout';
import { useEditor } from '@/store/useEditor';

const base = (): YardLayout =>
  ({
    version: 1,
    blocks: [{ id: 'A', originX: 0, originZ: 0, slots: 10, rows: 5, tiers: 5, slotStep: 2, rot: 0 }],
    roads: [],
    equipment: [],
  }) as unknown as YardLayout;

const x = () => useEditor.getState().layout!.blocks[0].originX;

describe('riwayat editor: urungkan & ulangi', () => {
  beforeEach(() => {
    useEditor.setState({ layout: base(), past: [], future: [], selected: null });
  });

  it('ulangi mengembalikan perubahan yang baru diurungkan', () => {
    const s = useEditor.getState();
    s.updateBlock('A', { originX: 10 });
    s.updateBlock('A', { originX: 20 });
    expect(x()).toBe(20);
    useEditor.getState().undo();
    expect(x()).toBe(10);
    useEditor.getState().undo();
    expect(x()).toBe(0);
    useEditor.getState().redo();
    expect(x()).toBe(10);
    useEditor.getState().redo();
    expect(x()).toBe(20);
  });

  it('ulangi tanpa riwayat tidak mengubah apa pun', () => {
    useEditor.getState().redo();
    expect(x()).toBe(0);
  });

  it('perubahan baru setelah urungkan membuang riwayat ulangi', () => {
    const s = useEditor.getState();
    s.updateBlock('A', { originX: 10 });
    useEditor.getState().undo();
    useEditor.getState().updateBlock('A', { originX: 5 });
    expect(useEditor.getState().future).toHaveLength(0);
    useEditor.getState().redo();
    expect(x()).toBe(5);
  });
});
