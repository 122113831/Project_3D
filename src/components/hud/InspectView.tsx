'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { BOX, LINES } from '@/lib/constants';
import {
  CONTAINER_MODEL_URL,
  containerModelFor,
  containerModelPlainFor,
  REEFER_MODEL_URL,
  reeferModelFor,
  reeferModelPlainFor,
  TANK_MODEL_URL,
  tankModelFor,
  tankModelPlainFor,
  type ModelPart,
} from '@/lib/containerModel';
import { isOpenTop, realisticContainerModel } from '@/lib/realisticContainer';
import { isoFor } from '@/lib/containerCode';
import { useCodedGeometry } from '@/components/three/useCodedGeometry';
import { realisticReeferModel } from '@/lib/realisticReefer';
import { realisticTankModel } from '@/lib/realisticTank';
import { useLivery } from '@/store/useLivery';
import { colorFor, colorForLine, ctrTypeLabel, STATUS_COLOR, STATUS_LABEL } from '@/lib/palette';
import type { YardContainer } from '@/lib/types';
import { useYard } from '@/store/useYard';
import { nf } from './ui';

/**
 * Dialog inspeksi kontainer — pop-up di tengah layar, BUKAN layar penuh:
 * separuh kiri informasinya, separuh kanan kontainer fisiknya, lapangan di
 * belakangnya tetap terlihat tapi diredupkan. Klik di luar dialog atau Esc
 * menutupnya.
 *
 * Kontainer di kanan adalah ASET YANG SAMA dengan yang ada di lapangan, pada
 * warna yang sama dengan yang sedang tampak di sana: mode pewarnaan aktif
 * menentukan ronanya, dan saat pewarnaan dimatikan yang muncul cat aslinya.
 * Layar ini memperbesar apa yang baru diklik, bukan menampilkan benda lain
 * yang kebetulan mirip.
 *
 * Kanvas 3D-nya terpisah dari kanvas lapangan: hanya hidup selama inspeksi,
 * dan tidak perlu tahu apa pun soal kamera lapangan. GLB-nya sudah ada di
 * cache loader, jadi tidak diunduh ulang.
 */

const FOV = 30;

const kindOf = (c: YardContainer) =>
  c.type === 'tank' ? 'tank' : c.status === 'reefer' ? 'reefer' : 'gp';

/** Tanggal ISO (yyyy-mm-dd) menjadi dd-mm-yyyy; bentuk lain dilewatkan apa adanya. */
const tanggal = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
};

// --- separuh kanan: kontainer fisik ------------------------------------------

/**
 * Satu bagian model di jendela detail, dengan nomor kontainer bila
 * materialnya kontainer realistis.
 *
 * dispose={null}: geometri dipakai bersama lapangan (salinan berkode berbagi
 * buffer posisi/normal). Pembuangan otomatis R3F saat jendela ini ditutup dulu
 * menghapus buffer itu dan membuat kontainer di lapangan HITAM. Material
 * salinan dibuang Model; salinan geometri oleh useCodedGeometry.
 */
function ModelPartMesh({
  part,
  material,
  code,
}: {
  part: ModelPart;
  material: THREE.Material;
  code: { no: string; iso: string }[];
}) {
  const geometry = useCodedGeometry(part.geometry, part.material.userData.containerCode ? code : null);
  return <mesh geometry={geometry} material={material} dispose={null} />;
}

function Model({ c }: { c: YardContainer }) {
  const [container, reefer, tank] = useGLTF(
    [CONTAINER_MODEL_URL, REEFER_MODEL_URL, TANK_MODEL_URL],
    false,
    false,
  );
  const colorMode = useYard((s) => s.colorMode);
  const plain = colorMode === 'none';
  const style = useYard((s) => s.options.containerStyle);
  // Livery kontainer ini dari master (prefix → merek), sama dengan lapangan.
  const resolve = useLivery((s) => s.resolve);
  const found = style === 'real' ? resolve(c) : null;
  // Tank hanya memakai livery bermodel TANK; selain itu aset tank lama.
  const livery = kindOf(c) === 'tank' ? (found?.model === 'TANK' ? found : null) : found;

  const parts: ModelPart[] = useMemo(() => {
    const kind = kindOf(c);
    const model =
      kind === 'tank'
        ? livery
          ? realisticTankModel(plain ? 'plain' : 'tint', livery, 'inspect')
          : (plain ? tankModelPlainFor : tankModelFor)(tank)
        : kind === 'reefer'
          ? style === 'real'
            ? realisticReeferModel(plain ? 'plain' : 'tint', livery ?? undefined, 'inspect')
            : (plain ? reeferModelPlainFor : reeferModelFor)(reefer)
          : style === 'real'
            ? realisticContainerModel(plain ? 'plain' : 'tint', livery ?? undefined, 'inspect', isOpenTop(c))
            : (plain ? containerModelPlainFor : containerModelFor)(container);
    return (c.size === 40 && model.parts40) || model.parts20;
  }, [c, plain, style, livery, container, reefer, tank]);

  // Material lapangan dipakai bersama puluhan InstancedMesh dan mendapat
  // ronanya dari instanceColor. Mesh biasa tidak punya itu, jadi materialnya
  // disalin dan warnanya DIKALIKAN rona yang sama — hasil akhirnya identik
  // dengan rumus renderer: warna material × warna instance × peta.
  const materials = useMemo(() => {
    const hue = new THREE.Color(colorFor(c, colorMode, style, livery?.bodyColor));
    return parts.map((p) => {
      const m = (p.material as THREE.MeshPhongMaterial).clone();
      // clone() tidak membawa onBeforeCompile — tanpa ini marka kontainer
      // realistis hilang di jendela detail.
      m.onBeforeCompile = p.material.onBeforeCompile;
      m.customProgramCacheKey = p.material.customProgramCacheKey;
      if (!plain) m.color.multiply(hue);
      return m;
    });
  }, [parts, c, colorMode, plain, style, livery?.bodyColor]);
  // Dibuang DENGAN JEDA, setelah material penggantinya sudah tergambar. Kalau
  // langsung dibuang, program shader-nya ikut dihancurkan (tidak ada lagi
  // material yang memakainya) lalu dikompilasi ulang untuk material baru yang
  // shadernya identik — ratusan ms macet tiap ganti kontainer.
  useEffect(() => () => void setTimeout(() => materials.forEach((m) => m.dispose()), 1500), [materials]);

  // Nomor asli kontainer ini di badan model realistis.
  const code = useMemo(() => [{ no: c.no, iso: isoFor(c) }], [c]);

  // Masuk dengan sedikit "mendarat": naik dari bawah sambil membesar, lalu
  // menetap. Dihitung per frame dari waktu mulai, bukan dengan pustaka tween.
  const group = useRef<THREE.Group>(null);
  const start = useRef(performance.now());
  useEffect(() => {
    start.current = performance.now();
  }, [c.no]);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = Math.min(1, (performance.now() - start.current) / 800);
    const e = 1 - Math.pow(1 - t, 3);
    g.scale.setScalar(0.8 + 0.2 * e);
    g.position.y = BOX.height / 2 + (1 - e) * 0.8;
    g.rotation.y = -0.7 + 0.7 * e;
  });

  return (
    <group ref={group} position={[0, BOX.height / 2, 0]}>
      {parts.map((p, i) => (
        <ModelPartMesh key={p.name} part={p} material={materials[i]} code={code} />
      ))}
    </group>
  );
}

/** Bayangan lembut di lantai — gradasi radial, bukan shadow map. */
function FloorShadow({ length }: { length: number }) {
  const texture = useMemo(() => {
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.2)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return new THREE.CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.005, 0]}
      scale={[length * 1.25, BOX.width * 2.4, 1]}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/**
 * Kamera dipasang pada jarak yang membuat kontainer muat pada MOMEN TERLEBAR
 * saat berputar — diagonal alasnya menghadap kamera — berapa pun ukuran
 * kanvasnya. Dihitung ulang setiap kali jendela berubah; OrbitControls
 * mengambil alih sudutnya sesudah itu.
 */
function FitCamera({ length }: { length: number }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const halfDiag = Math.hypot(length, BOX.width) / 2;
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    const tanH = tanV * (size.width / Math.max(1, size.height));
    // Mendatar harus memuat diagonalnya; tegak cukup memuat sekitar separuhnya
    // karena kotaknya pipih.
    const dist = Math.max(halfDiag / (tanH * 0.9), (halfDiag * 0.6) / (tanV * 0.9));
    camera.position.set(dist * 0.8, dist * 0.34, dist * 0.8);
    camera.lookAt(0, BOX.height * 0.55, 0);
  }, [length, size.width, size.height, camera]);
  return null;
}

function Stage({ c, open }: { c: YardContainer; open: boolean }) {
  const length = c.size === 40 ? BOX.len40 : BOX.len20;
  return (
    // TIDAK di-key dan tidak dibongkar saat inspeksi ditutup: kanvas yang
    // dibuat ulang tiap klik berarti konteks WebGL baru dan semua shader
    // kontainer realistis dikompilasi ulang — ±1,5 dtk macet per klik di GPU
    // terintegrasi. Saat tersembunyi rendernya dihentikan (frameloop never).
    <Canvas
      frameloop={open ? 'always' : 'never'}
      dpr={[1, 1.5]}
      // powerPreference sama dengan kanvas lapangan: meminta 'low-power' di laptop
      // dua-GPU memaksa ANGLE membuka perangkat GPU kedua — getContext terukur
      // beberapa detik di Intel Iris.
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV, near: 0.1, far: 200 }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
    >
      <hemisphereLight args={['#e8eef7', '#5b6470', 0.9]} />
      <directionalLight position={[4, 7, 5]} intensity={1.7} />
      <directionalLight position={[-6, 3, -4]} intensity={0.5} color="#bcd3ff" />
      <Suspense fallback={null}>
        <Model c={c} />
      </Suspense>
      <FloorShadow length={length} />
      <FitCamera length={length} />
      <OrbitControls
        makeDefault
        autoRotate
        autoRotateSpeed={1}
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.48}
        target={[0, BOX.height * 0.55, 0]}
      />
    </Canvas>
  );
}

// --- separuh kiri: informasi ------------------------------------------------

function Row({ label, value, warn = false, delay = 0 }: {
  label: string;
  value: string;
  warn?: boolean;
  delay?: number;
}) {
  return (
    <div
      className="anim-rise flex items-baseline justify-between gap-6 border-b border-white/[0.06] py-1.5"
      style={{ animationDelay: `${delay}s` }}
    >
      <span className="text-[12px] text-slate-400">{label}</span>
      <span
        className={`text-right text-[13px] font-medium tabular-nums ${warn ? 'text-amber-300' : 'text-slate-50'}`}
      >
        {value}
      </span>
    </div>
  );
}

function Cell({ label, value, delay }: { label: string; value: string; delay: number }) {
  return (
    <div
      className="anim-rise rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2.5 text-center"
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="text-[24px] font-semibold leading-none tabular-nums text-slate-50">{value}</div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[12px] font-medium tracking-wide text-slate-200">
      {color && <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />}
      {children}
    </span>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
      {children}
    </div>
  );
}

export function InspectView({ c, open = true }: { c: YardContainer; open?: boolean }) {
  const select = useYard((s) => s.select);
  const line = LINES.find((l) => l.code === c.line);
  const accent = colorForLine(c.line);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select, open]);

  // Jeda bertingkat: tiap elemen menyusul 35 ms setelah sebelumnya.
  let i = 0;
  const d = () => 0.1 + 0.035 * i++;

  return (
    // Tetap terpasang setelah pertama dibuka (lihat Hud): saat tertutup hanya
    // disembunyikan, supaya kanvas 3D dan shader-nya dipakai ulang.
    <div
      aria-hidden={!open}
      inert={!open}
      className={`pointer-events-auto absolute inset-0 z-40 flex items-center justify-center p-6 transition-opacity duration-200 ${
        open ? 'opacity-100' : 'invisible pointer-events-none opacity-0'
      }`}
      style={{ background: 'rgb(6 10 18 / 0.55)', backdropFilter: open ? 'blur(5px)' : undefined }}
      // Klik pada scrim — bukan pada dialognya — menutup inspeksi.
      onClick={(e) => {
        if (e.target === e.currentTarget) select(null);
      }}
    >
    <div
      className={`hud-panel relative flex overflow-hidden rounded-2xl transition-transform duration-300 ${open ? 'scale-100' : 'scale-95'}`}
      style={{ width: 'min(1120px, 92vw)', height: 'min(680px, 84vh)' }}
      role="dialog"
      aria-label={`Container ${c.no}`}
    >
      {/* ---- kiri: informasi ---- */}
      {/* key: memilih kontainer lain mengulang animasi masuk informasinya. */}
      <section key={`${c.no}|${open}`} className="anim-in-left relative flex h-full w-1/2 flex-col overflow-y-auto px-8 py-7">
        <div className="absolute inset-y-7 left-0 w-1 rounded-r" style={{ backgroundColor: accent }} />

        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Container</div>
        <div className="mt-1 text-[30px] font-bold leading-none tracking-wide text-slate-50">{c.no}</div>
        <div className="mt-1.5 text-[13px] text-slate-300">{line?.name ?? c.line}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{c.size} FT</Badge>
          <Badge>{c.typeCode || '—'}</Badge>
          <Badge color={STATUS_COLOR[c.status]}>{STATUS_LABEL[c.status]}</Badge>
          {/* Lencana kondisi hanya kalau kategori statusnya BUKAN 'damaged' —
              dua lencana "Rusak" berdampingan terbaca seperti salah ketik. */}
          {c.damaged && c.status !== 'damaged' && (
            <Badge color={STATUS_COLOR.damaged}>{STATUS_LABEL.damaged}</Badge>
          )}
        </div>

        <GroupTitle>Yard position</GroupTitle>
        <div className="grid grid-cols-4 gap-2">
          <Cell label="Block" value={c.block} delay={d()} />
          <Cell label="Bay" value={String(c.bay + 1)} delay={d()} />
          <Cell label="Row" value={String(c.row + 1)} delay={d()} />
          <Cell label="Tier" value={String(c.tier)} delay={d()} />
        </div>

        <div className="grid grid-cols-1 gap-x-8">
          <div>
            <GroupTitle>Container</GroupTitle>
            <Row label="Type" value={ctrTypeLabel(c.typeCode)} delay={d()} />
            <Row label="ISO code" value={c.isoCode || '—'} delay={d()} />
            <Row label="Status" value={c.filled ? STATUS_LABEL.full : STATUS_LABEL.empty} delay={d()} />
            <Row label="Condition" value={c.damaged ? STATUS_LABEL.damaged : 'Good'} warn={c.damaged} delay={d()} />
            {/* GROSS kosong di database depot dan TARE sering ikut kosong, jadi
                0 berarti tidak diketahui — bukan nol kilogram. */}
            <Row label="Weight" value={c.weightKg > 0 ? `${nf(c.weightKg)} kg` : '—'} delay={d()} />
          </div>
          <div>
            <GroupTitle>Movement</GroupTitle>
            <Row label="Operator" value={line?.name ?? c.line} delay={d()} />
            <Row label="Vessel" value={c.vessel} delay={d()} />
            <Row label="Yard in" value={tanggal(c.inDate)} delay={d()} />
          </div>
        </div>

        <div className="mt-auto pt-6 text-[11px] text-slate-500">
          Esc, ✕, or click outside to return to the yard.
        </div>
      </section>

      {/* ---- kanan: kontainer fisik ---- */}
      <section className="relative h-full w-1/2 border-l border-white/10">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(55% 50% at 50% 48%, rgb(56 189 248 / 0.14), transparent 70%)',
          }}
        />
        <Stage c={c} open={open} />

        <div className="pointer-events-none absolute left-5 top-5 flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px]" style={{ backgroundColor: accent }} />
          <span className="text-[13px] font-semibold text-slate-100">Physical container</span>
          <span className="ml-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
            {c.size} ft · {ctrTypeLabel(c.typeCode).split(' ')[0]}
          </span>
        </div>
        <div className="pointer-events-none absolute bottom-5 left-5 text-[11px] text-slate-500">
          Drag to rotate · spins on its own when released
        </div>

        <button
          type="button"
          onClick={() => select(null)}
          className="absolute right-4 top-4 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[13px] text-slate-200 hover:border-white/30 hover:bg-white/10 hover:text-white"
          aria-label="Close"
          title="Close (Esc)"
        >
          ✕ Close
        </button>

        <div className="absolute inset-x-0 bottom-0 h-1" style={{ backgroundColor: STATUS_COLOR[c.status] }} />
      </section>
    </div>
    </div>
  );
}
