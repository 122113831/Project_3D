'use client';

import { useEffect, useState } from 'react';
import {
  ASSET_ITEMS,
  CATEGORY_LABEL,
  itemsIn,
  type AssetCategory,
} from '@/lib/editorAssets';
import { renderThumbnails } from '@/lib/thumbnails';
import { useEditor } from '@/store/useEditor';

// Gate diletakkan setelah Jalan karena ia berdiri DI ATAS jalan — urutan
// tabnya mengikuti urutan orang membangun lapangan.
const CATEGORIES: AssetCategory[] = ['block', 'road', 'gate', 'equipment'];

/**
 * Palet aset di tepi bawah layar: tab kategori, lalu deretan kartu bergambar.
 *
 * Gambarnya dirender sekali dari geometri aset yang sebenarnya, bukan gambar
 * yang disimpan terpisah — kartu karena itu tidak bisa berbeda dari benda yang
 * akan muncul di lapangan.
 */
export function EditorPalette() {
  const open = useEditor((s) => s.open);
  const layout = useEditor((s) => s.layout);
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const assetId = useEditor((s) => s.assetId);
  const setAsset = useEditor((s) => s.setAsset);
  const openNewBlock = useEditor((s) => s.openNewBlock);

  const [category, setCategory] = useState<AssetCategory>('block');
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Dirender sekali saat palet pertama dibuka. Sebelum selesai, kartu tampil
  // dengan kotak kosong — palet tetap bisa dipakai.
  useEffect(() => {
    if (!open || Object.keys(thumbs).length > 0) return;
    let alive = true;
    void renderThumbnails(
      ASSET_ITEMS.map((i) => ({ id: i.id, build: i.build, model: i.model })),
    ).then((r) => {
      if (alive) setThumbs(r);
    });
    return () => {
      alive = false;
    };
  }, [open, thumbs]);

  if (!open || !layout) return null;

  const items = itemsIn(category);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 p-3">
      {/* Tab kategori + tombol modus pilih */}
      <div className="hud-panel pointer-events-auto flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setTool('select')}
          className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
            tool === 'select'
              ? 'bg-sky-400/20 text-slate-50'
              : 'text-slate-400 hover:text-slate-100'
          }`}
        >
          Pilih
        </button>
        <span className="mx-1 h-4 w-px bg-white/10" />
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-md px-3 py-1 text-[12px] transition-colors ${
              category === c
                ? 'bg-white/15 font-medium text-slate-50'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>

      {/* Baris bantuan — tanpa ini tidak ada yang memberi tahu bahwa KARTU-nya
          yang diklik, bukan tab-nya, dan bahwa memutar pakai tombol R. */}
      <div className='pointer-events-none text-[10px] text-slate-400'>
        {category === 'block'
          ? 'Klik kartu blok untuk membuat blok baru di database.'
          : 'Klik kartu, lalu klik di lapangan untuk menaruhnya.'}
        {' · Klik objek untuk memilih, klik lagi dan seret untuk memindah, R memutar 15°.'}
      </div>

      {/* Kartu aset */}
      <div className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto pb-1">
        {items.map((item) => {
          const active = tool === 'place' && assetId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                // Blok itu satu-satunya aset yang benar-benar ditulis ke
                // database, jadi ia lewat dialog dulu — bukan langsung
                // ditempel ke lapangan seperti jalan dan alat.
                if (item.spec.kind === 'block') {
                  const { slots, rows, tiers } = item.spec.block;
                  openNewBlock({ slots, rows, tiers });
                } else setAsset(item.id);
              }}
              title={item.detail}
              className={`hud-panel w-[150px] shrink-0 overflow-hidden text-left transition-colors ${
                active ? 'border-sky-300/70 ring-1 ring-sky-300/60' : 'hover:border-white/25'
              }`}
            >
              <div className="relative flex h-[84px] items-center justify-center bg-gradient-to-b from-white/[0.07] to-transparent">
                {item.spec.kind === 'block' && (
                  <span className="absolute right-1 top-1 rounded bg-sky-400/25 px-1.5 py-[1px] text-[9px] font-medium text-sky-200">
                    + database
                  </span>
                )}
                {thumbs[item.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbs[item.id]}
                    alt=""
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                ) : (
                  <span className="text-[10px] text-slate-500">memuat…</span>
                )}
              </div>
              <div className="border-t border-white/10 px-2 py-1.5">
                <div className="truncate text-[12px] font-medium text-slate-100">{item.label}</div>
                <div className="truncate text-[10px] text-slate-400">{item.detail}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
