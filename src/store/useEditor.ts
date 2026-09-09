'use client';

import { create } from 'zustand';
import { ASSET_ITEMS, findItem } from '@/lib/editorAssets';
import { ROAD, type RoadKind } from '@/lib/constants';
import { snapRoad } from '@/lib/roadSnap';
import { generateEquipment } from '@/lib/equipment';
import {
  defaultBlock,
  emptyLayout,
  layoutFromData,
  clearStoredLayout,
  loadLayout,
  newId,
  saveLayout,
  type EquipmentKind,
  type LayoutBlock,
  type LayoutEquipment,
  type LayoutRoad,
  type YardLayout,
} from '@/lib/layout';
import type { YardData, YardSource } from '@/lib/types';
import { useYard } from './useYard';

/**
 * Editor cuma punya dua modus: memilih, atau menaruh aset yang sedang aktif
 * di palet. Jenis apa yang ditaruh ditentukan kartunya, bukan tool terpisah —
 * itu yang membuat palet bergambar jadi satu-satunya tempat memilih.
 */
export type EditorTool = 'select' | 'place';

export type Selection =
  | { type: 'block'; id: string }
  | { type: 'road'; id: string }
  | { type: 'equipment'; id: string }
  | null;

/** Kelipatan snap posisi, dalam meter. */
export const SNAP = 0.5;
export const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/**
 * Posisi akhir sebuah ubin jalan: menempel ke ubin tetangga atau ke ujung jalan
 * lorong blok, kalau tidak jatuh ke kisi ubin global.
 *
 * `selfId` dilewatkan saat menyeret ubin yang sudah ada, supaya ubin itu tidak
 * menempel pada dirinya sendiri.
 */
export const fitRoad = (kind: RoadKind, x: number, z: number, selfId?: string) => {
  const l = useEditor.getState().layout;
  return snapRoad(l?.blocks ?? [], l?.roads ?? [], kind, x, z, selfId);
};

type EditorState = {
  open: boolean;
  tool: EditorTool;
  /** Id kartu palet yang sedang aktif. */
  assetId: string;
  selected: Selection;
  layout: YardLayout | null;
  /**
   * Riwayat untuk undo. Disimpan sebagai salinan penuh, bukan diff: satu tata
   * letak isinya puluhan objek kecil, jadi menyalinnya jauh lebih murah
   * daripada risiko diff yang salah.
   */
  past: YardLayout[];

  setOpen: (v: boolean) => void;
  setTool: (t: EditorTool) => void;
  setAsset: (id: string) => void;
  /** Menaruh aset yang sedang aktif di titik dunia yang diklik. */
  place: (x: number, z: number) => void;
  select: (s: Selection) => void;

  /** Menyalin tata letak yang sedang tampil sebagai titik awal suntingan. */
  seedFrom: (data: YardData) => void;

  // --- tata letak bersama (tabel YARD_LAYOUT) -------------------------------
  //
  // Tata letak tidak lagi berhenti di localStorage peramban ini. LayoutSync
  // menariknya dari server saat halaman dibuka dan mendorong tiap perubahan
  // kembali, jadi jalan dan alat yang ditata di satu PC muncul sama persis di
  // PC lain.
  /**
   * Revisi baris YARD_LAYOUT yang menjadi dasar suntingan sekarang.
   *
   * Dikirim kembali saat menyimpan. Kalau baris di database sudah melewatinya —
   * ada yang menyunting dari tempat lain — server menolak, dan yang ditolak
   * penyimpanan kita, bukan pekerjaan orang itu.
   */
  /**
   * Sumber data yang tata letaknya sedang disunting.
   *
   * Ada di sini karena setiap penyimpanan perlu tahu slot mana yang ditulis:
   * lapangan database dan lapangan demo punya salinan sendiri-sendiri, dan
   * menyimpan yang satu ke slot yang lain persis cara lama membuat demo
   * mengikuti susunan database.
   */
  source: YardSource;
  /**
   * Pindah ke tata letak milik sumber lain.
   *
   * Salinan lokal sumber tujuan langsung dipasang — tanpa menunggu server —
   * supaya tidak ada satu frame pun di mana lapangan baru digambar memakai tata
   * letak lapangan lama.
   */
  switchSource: (source: YardSource) => void;
  revision: number;
  /**
   * Memasang tata letak dari server tanpa mencatat riwayat.
   *
   * Bukan suntingan pengguna, jadi tidak masuk undo: menekan Ctrl+Z sesudah
   * halaman dimuat tidak boleh membawa lapangan kembali ke keadaan sebelum
   * penyelarasan.
   */
  applyShared: (layout: YardLayout | null, revision: number) => void;
  /** Mencatat revisi baru setelah penyimpanan ke server berhasil. */
  setRevision: (revision: number) => void;
  addBlock: (x: number, z: number, preset?: Partial<LayoutBlock>) => void;
  addRoad: (x: number, z: number, preset?: Partial<LayoutRoad>) => void;
  addEquipment: (
    kind: EquipmentKind,
    x: number,
    z: number,
    preset?: Partial<LayoutEquipment>,
  ) => void;
  updateBlock: (id: string, patch: Partial<LayoutBlock>) => void;
  updateRoad: (id: string, patch: Partial<LayoutRoad>) => void;
  updateEquipment: (id: string, patch: Partial<LayoutEquipment>) => void;
  /** Geser objek terpilih tanpa mencatat riwayat — dipakai saat drag. */
  moveSelected: (x: number, z: number, record?: boolean) => void;
  removeSelected: () => void;
  undo: () => void;
  clearLayout: () => void;
  importLayout: (json: string) => string | null;

  // --- blok baru yang benar-benar ditulis ke database -----------------------
  //
  // Berbeda dari addBlock, yang hanya menambah blok ke tata letak lokal. Yang
  // ini membuka dialog; dialognya yang memanggil endpoint tulis.
  /** Ukuran awal dialog blok baru; null berarti dialog tertutup. */
  newBlock: { slots: number; rows: number; tiers: number } | null;
  openNewBlock: (preset: { slots: number; rows: number; tiers: number }) => void;
  closeNewBlock: () => void;
  /** Sedang ada penulisan ke database. */
  busy: boolean;
  setBusy: (v: boolean) => void;
  /** Pesan hasil penulisan terakhir, ditampilkan di panel. */
  note: string | null;
  setNote: (v: string | null) => void;
  /** Menyisipkan blok dari database ke tata letak, apa adanya. */
  adoptBlock: (b: LayoutBlock) => void;
};

const commit = (
  set: (fn: (s: EditorState) => Partial<EditorState>) => void,
  mutate: (l: YardLayout) => YardLayout,
  record = true,
) =>
  set((s) => {
    if (!s.layout) return {};
    const next = mutate(s.layout);
    saveLayout(s.source, next);
    return {
      layout: next,
      // Riwayat dibatasi 50: editor ini bukan aplikasi gambar, dan menyimpan
      // ratusan salinan tata letak hanya menahan memori tanpa gunanya.
      past: record ? [...s.past, s.layout].slice(-50) : s.past,
    };
  });

export const useEditor = create<EditorState>((set, get) => ({
  open: false,
  tool: 'select',
  newBlock: null,
  busy: false,
  note: null,
  assetId: ASSET_ITEMS[0].id,
  selected: null,
  layout: loadLayout('depot'),
  source: 'depot',
  revision: 0,
  past: [],

  setOpen: (open) => set({ open, selected: open ? get().selected : null }),
  setTool: (tool) => set({ tool, selected: tool === 'select' ? get().selected : null }),
  setAsset: (assetId) => set({ assetId, tool: 'place', selected: null }),

  place: (x, z) => {
    const item = findItem(get().assetId);
    if (!item) return;
    // Blok tidak pernah ditempel langsung: ia harus punya baris di
    // CORE_YARD_BLOCK dan YARD_ROWTIER, dan itu urusan dialog. Menaruhnya di
    // sini akan menghasilkan blok yang tampak ada di lapangan tapi tidak ada
    // di database — persis jenis kebohongan yang ingin dihindari.
    if (item.spec.kind === 'block') {
      const { slots, rows, tiers } = item.spec.block;
      get().openNewBlock({ slots, rows, tiers });
    } else if (item.spec.kind === 'road') get().addRoad(x, z, item.spec.road);
    else get().addEquipment(item.spec.equipment, x, z, item.spec.extra);
  },
  select: (selected) => set({ selected }),

  seedFrom: (data) => {
    /**
     * Menyalin HANYA dari lapangan yang sedang ditata.
     *
     * Mengklik "Demo" menetapkan sumbernya seketika, tapi `data` masih berisi
     * lapangan sebelumnya sampai permintaannya selesai — dan lapangan demo
     * butuh beberapa detik untuk dibangkitkan. Menekan "Salin dari lapangan"
     * di sela itu akan menyalin susunan blok DATABASE ke lapangan demo, lalu
     * menyimpannya sebagai tata letak demo. Itulah kenapa lapangan demo
     * tampak mengikuti data database.
     *
     * Yang dijadikan acuan adalah sumber di store LAPANGAN, bukan salinannya di
     * store ini: yang pertama berganti seketika saat sumber diklik, sedangkan
     * salinan di sini baru menyusul satu siklus efek kemudian lewat LayoutSync.
     * Beda satu siklus itu justru celah yang harus ditutup.
     */
    const source = useYard.getState().source;
    if (data.meta.source !== source) return;

    const layout: YardLayout = {
      ...emptyLayout(),
      // Lapangan asal ikut dicap. Tanpa itu salinan di peramban tidak bisa
      // dibedakan milik depot atau demo, dan bisa terkirim ke baris yang salah.
      source: data.meta.source,
      blocks: layoutFromData(data),
      equipment: generateEquipment(data.blocks, data.meta.extentX, data.meta.extentZ),
    };
    saveLayout(source, layout);
    set((s) => ({ source, layout, past: s.layout ? [...s.past, s.layout].slice(-50) : [] }));
  },

  switchSource: (source) => {
    if (source === get().source) return;
    // Riwayat undo ikut dikosongkan: isinya tata letak lapangan yang lain, dan
    // membatalkan ke sana berarti menempelkan susunan blok yang salah.
    set({ source, layout: loadLayout(source), revision: 0, selected: null, past: [] });
  },

  applyShared: (layout, revision) => {
    if (layout) saveLayout(get().source, layout);
    set({ layout, revision, selected: null, past: [] });
  },

  setRevision: (revision) => set({ revision }),

  addBlock: (x, z, preset) => {
    const l = get().layout;
    if (!l) return;
    // Kode blok dari huruf yang belum terpakai, supaya tetap terbaca seperti
    // di terminal (A, B, C, ...).
    const used = new Set(l.blocks.map((b) => b.id));
    let id = '';
    for (let i = 0; i < 26 && !id; i++) {
      const c = String.fromCharCode(65 + i);
      if (!used.has(c)) id = c;
    }
    const block = {
      ...defaultBlock(snap(x), snap(z), id || newId('blk').toUpperCase()),
      ...preset,
    };
    commit(set, (cur) => ({ ...cur, blocks: [...cur.blocks, block] }));
    set({ selected: { type: 'block', id: block.id } });
  },

  addRoad: (x, z, preset) => {
    if (!get().layout) return;
    // Ubin dijepret ke kisi seukuran dirinya sendiri, bukan ke SNAP 0,5 m.
    // Tanpa itu dua ubin yang "kelihatan" bersebelahan akan meleset beberapa
    // sentimeter dan marka tepinya patah di sambungan.
    const kind = preset?.kind ?? 'straight';
    const fit = fitRoad(kind, x, z);
    const road: LayoutRoad = {
      id: newId('road'),
      kind: 'straight',
      ry: 0,
      ...preset,
      x: fit.x,
      z: fit.z,
    };
    // Kalau ubinnya menempel ke jalan lorong, sudutnya ikut blok itu — bukan
    // sudut baku kartu. Tanpa ini ubin mendarat di garis yang benar tapi
    // melintang terhadap jalannya.
    if (fit.ry !== null) road.ry = fit.ry;
    // Panjang hanya dicatat kalau memang lebih pendek dari satu ubin, supaya
    // tata letak tidak penuh angka yang tidak berarti apa-apa.
    if (road.kind === 'straight' && fit.len < ROAD.tile - 0.01) {
      road.len = Math.round(fit.len * 100) / 100;
    }
    commit(set, (cur) => ({ ...cur, roads: [...cur.roads, road] }));
    set({ selected: { type: 'road', id: road.id } });
  },

  addEquipment: (kind, x, z, preset) => {
    if (!get().layout) return;
    const item: LayoutEquipment = {
      id: newId(kind),
      kind,
      x: snap(x),
      z: snap(z),
      ry: 0,
      ...(kind === 'truck' ? { loaded: true } : {}),
      ...preset,
    };
    commit(set, (cur) => ({ ...cur, equipment: [...cur.equipment, item] }));
    set({ selected: { type: 'equipment', id: item.id } });
  },

  updateBlock: (id, patch) =>
    commit(set, (l) => ({
      ...l,
      blocks: l.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    })),

  updateRoad: (id, patch) =>
    commit(set, (l) => ({
      ...l,
      roads: l.roads.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  updateEquipment: (id, patch) =>
    commit(set, (l) => ({
      ...l,
      equipment: l.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  moveSelected: (x, z, record = true) => {
    const sel = get().selected;
    if (!sel) return;
    // Ubin jalan dijepret ke lorong terdekat, atau ke kisinya sendiri. Kisi
    // 0,5 m akan menggeser ubin beberapa sentimeter dari tetangganya, dan marka
    // tepinya patah di sambungan — cacat yang sulit dilihat tapi mudah dibuat.
    const dragged = sel.type === 'road' ? get().layout?.roads.find((r) => r.id === sel.id) : null;
    const fit = dragged ? fitRoad(dragged.kind, x, z, dragged.id) : null;
    const nx = fit ? fit.x : snap(x);
    const nz = fit ? fit.z : snap(z);
    commit(
      set,
      (l) => {
        if (sel.type === 'block') {
          return {
            ...l,
            blocks: l.blocks.map((b) => (b.id === sel.id ? { ...b, originX: nx, originZ: nz } : b)),
          };
        }
        if (sel.type === 'road') {
          // Panjangnya ikut dihitung ulang selama diseret: potongan yang tadinya
          // menutup celah sempit harus kembali utuh begitu ditarik ke tempat
          // lapang, dan sebaliknya.
          const len =
            fit && dragged?.kind === 'straight'
              ? fit.len < ROAD.tile - 0.01
                ? Math.round(fit.len * 100) / 100
                : undefined
              : undefined;
          return {
            ...l,
            roads: l.roads.map((r) =>
              r.id === sel.id ? { ...r, x: nx, z: nz, len: r.kind === 'straight' ? len : r.len } : r,
            ),
          };
        }
        return {
          ...l,
          equipment: l.equipment.map((e) => (e.id === sel.id ? { ...e, x: nx, z: nz } : e)),
        };
      },
      record,
    );
  },

  removeSelected: () => {
    const sel = get().selected;
    if (!sel) return;
    commit(set, (l) => ({
      ...l,
      blocks: sel.type === 'block' ? l.blocks.filter((b) => b.id !== sel.id) : l.blocks,
      roads: sel.type === 'road' ? l.roads.filter((r) => r.id !== sel.id) : l.roads,
      equipment:
        sel.type === 'equipment' ? l.equipment.filter((e) => e.id !== sel.id) : l.equipment,
    }));
    set({ selected: null });
  },

  undo: () =>
    set((s) => {
      const prev = s.past.at(-1);
      if (!prev) return {};
      saveLayout(s.source, prev);
      return { layout: prev, past: s.past.slice(0, -1), selected: null };
    }),

  clearLayout: () => {
    // Salinan sumber LAIN tidak ikut dibuang: menekan Reset saat menata demo
    // tidak boleh menghapus tata letak lapangan sungguhan.
    clearStoredLayout(get().source);
    set((s) => ({
      layout: null,
      selected: null,
      past: s.layout ? [...s.past, s.layout].slice(-50) : [],
    }));
  },

  openNewBlock: (preset) => set({ newBlock: preset, note: null, tool: 'select' }),
  closeNewBlock: () => set({ newBlock: null }),
  setBusy: (busy) => set({ busy }),
  setNote: (note) => set({ note }),

  // Blok yang baru dibuat di database harus IKUT masuk tata letak kalau ada:
  // applyLayout cuma menggambar blok yang terdaftar di tata letak, jadi tanpa
  // ini blok yang baru saja tersimpan justru tidak kelihatan.
  adoptBlock: (b) =>
    commit(set, (l) => ({
      ...l,
      blocks: l.blocks.some((v) => v.id === b.id) ? l.blocks : [...l.blocks, b],
    })),

  importLayout: (json) => {
    try {
      const parsed = JSON.parse(json) as YardLayout;
      if (parsed?.version !== 1 || !Array.isArray(parsed.blocks)) {
        return 'Bukan berkas tata letak yang dikenali (version harus 1).';
      }
      const layout: YardLayout = {
        ...emptyLayout(),
        ...parsed,
        equipment: parsed.equipment ?? [],
        roads: parsed.roads ?? [],
      };
      saveLayout(get().source, layout);
      set((s) => ({
        layout,
        selected: null,
        past: s.layout ? [...s.past, s.layout].slice(-50) : [],
      }));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Gagal membaca JSON.';
    }
  },
}));
