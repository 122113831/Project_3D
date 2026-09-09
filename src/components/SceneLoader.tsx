'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { useYard } from '@/store/useYard';

// WebGL hanya ada di browser — jangan dirender di server.
const YardScene = dynamic(() => import('./YardScene'), {
  ssr: false,
  loading: () => <SceneFallback text="Menyiapkan renderer…" />,
});

function SceneFallback({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#a7c8e7] text-sm text-slate-700">
      {text}
    </div>
  );
}

export function SceneLoader() {
  const load = useYard((s) => s.load);
  const data = useYard((s) => s.data);
  const loading = useYard((s) => s.loading);
  const error = useYard((s) => s.error);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="absolute inset-0">
      <YardScene />
      {!data && loading && <SceneFallback text="Memuat data lapangan…" />}
      {error && (
        <div className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-lg border border-red-400/40 bg-red-950/80 px-4 py-3 text-sm text-red-200">
          Gagal memuat data yard: {error}
        </div>
      )}
    </div>
  );
}
