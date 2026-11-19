'use client';

import { LINES } from '@/lib/constants';
import {
  colorForLine,
  COLOR_MODE_LABEL,
  STATUS_COLOR,
  STATUS_LABEL,
  TYPE_FILTER_COLOR,
  TYPE_FILTER_LABEL,
} from '@/lib/palette';
import type {
  ColorMode,
  ContainerSize,
  ContainerStatus,
  TypeFilter,
} from '@/lib/types';
import { pickRelocation } from '@/lib/relocate';
import { useYard, type WeatherMode } from '@/store/useYard';
import { useTraffic } from '@/store/useTraffic';
import { useYardView } from '@/store/useYardView';
import { DayReplay } from './DayReplay';
import { Chip, Panel, Section, SubLabel, Toggle } from './ui';

const COLOR_MODES: ColorMode[] = ['line', 'status', 'size', 'tier'];
// Reefer TIDAK di sini. Ia jenis kontainer, bukan keadaan muatannya — dan
// renderer pun memperlakukannya begitu, dengan model 3D-nya sendiri.
const STATUSES: ContainerStatus[] = ['full', 'empty', 'dangerous', 'damaged'];
const SIZES: ContainerSize[] = [20, 40];
const TYPES: TypeFilter[] = ['gp', 'tank', 'reefer'];
const DENSITIES = [
  { label: 'Ringan', value: 0.3 },
  { label: 'Normal', value: 0.68 },
  { label: 'Padat', value: 0.88 },
  { label: 'Stress', value: 1 },
];

export function ControlPanel() {
  const colorMode = useYard((s) => s.colorMode);
  const setColorMode = useYard((s) => s.setColorMode);
  const filter = useYard((s) => s.filter);
  const toggleLine = useYard((s) => s.toggleLine);
  const toggleStatus = useYard((s) => s.toggleStatus);
  const toggleSize = useYard((s) => s.toggleSize);
  const toggleType = useYard((s) => s.toggleType);
  const resetFilter = useYard((s) => s.resetFilter);
  const options = useYard((s) => s.options);
  const setOption = useYard((s) => s.setOption);
  const fill = useYard((s) => s.fill);
  const load = useYard((s) => s.load);
  const loading = useYard((s) => s.loading);
  const source = useYard((s) => s.source);
  const data = useYardView();

  // Daftar line diambil dari isi lapangan. Data depot memakai kode agennya
  // sendiri (RCL, MSC, HDK) yang tidak ada di konstanta LINES.
  const lines = data?.meta.lines ?? LINES.map((l) => ({ code: l.code, name: l.name }));

  const hasFilter =
    filter.lines.length > 0 ||
    filter.statuses.length > 0 ||
    filter.sizes.length > 0 ||
    filter.types.length > 0;

  return (
    <Panel className="hud-scroll pointer-events-auto min-h-0 w-[248px] overflow-y-auto overscroll-contain">
      <Section title="Pewarnaan">
        <div className="grid grid-cols-2 gap-1">
          {COLOR_MODES.map((m) => (
            // Menekan pilihan yang sedang aktif akan mematikannya. Sebelumnya
            // salah satu selalu harus terpilih, jadi tidak ada cara melihat
            // lapangan tanpa pewarnaan sama sekali.
            <Chip
              key={m}
              active={colorMode === m}
              onClick={() => setColorMode(colorMode === m ? 'none' : m)}
            >
              {COLOR_MODE_LABEL[m]}
            </Chip>
          ))}
        </div>
      </Section>

      {/* Keempat deret chip ini satu hal yang sama — menyaring apa yang tampil —
          jadi keempatnya satu section dengan label kecil sendiri-sendiri.
          Sebelumnya ukuran dan jenis menumpang di bawah judul "Status" tanpa
          keterangan, dan terbaca seolah status juga. */}
      <Section title="Filter">
        <SubLabel>Shipping line</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {lines.map((l) => (
            <Chip
              key={l.code}
              title={l.name}
              color={colorForLine(l.code)}
              active={filter.lines.includes(l.code)}
              onClick={() => toggleLine(l.code)}
            >
              {l.code}
            </Chip>
          ))}
        </div>

        <SubLabel>Status</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {STATUSES.map((s) => (
            <Chip
              key={s}
              // Label terpanjang ("Dangerous goods") dipotong oleh lebar chip;
              // judulnya menyimpan yang utuh.
              title={STATUS_LABEL[s]}
              color={STATUS_COLOR[s]}
              active={filter.statuses.includes(s)}
              onClick={() => toggleStatus(s)}
            >
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>

        <SubLabel>Ukuran</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {SIZES.map((s) => (
            <Chip key={s} active={filter.sizes.includes(s)} onClick={() => toggleSize(s)}>
              {s} ft
            </Chip>
          ))}
        </div>

        <SubLabel>Jenis</SubLabel>
        <div className="grid grid-cols-2 gap-1">
          {TYPES.map((t) => (
            <Chip
              key={t}
              color={TYPE_FILTER_COLOR[t]}
              active={filter.types.includes(t)}
              onClick={() => toggleType(t)}
            >
              {TYPE_FILTER_LABEL[t]}
            </Chip>
          ))}
        </div>

        {hasFilter && (
          <button
            type="button"
            onClick={resetFilter}
            className="mt-2.5 w-full rounded-md border border-white/10 py-1 text-[11px] text-slate-300 hover:border-white/25 hover:text-slate-100"
          >
            Hapus semua filter
          </button>
        )}
      </Section>

      <Section title="Sumber data">
        <div className="grid grid-cols-2 gap-1">
          <Chip
            active={source === 'depot'}
            title="Baca YARD_ROWTIER + CONTAINER dari Oracle"
            onClick={() => void load({ source: 'depot' })}
          >
            Database
          </Chip>
          <Chip
            active={source === 'demo'}
            title="Lapangan bangkitan untuk menguji renderer pada belasan ribu kontainer"
            onClick={() => void load({ source: 'demo' })}
          >
            Demo
          </Chip>
        </div>

        {source === 'demo' && (
          <>
            <div className="mt-1.5 grid grid-cols-4 gap-1">
              {DENSITIES.map((d) => (
                <Chip
                  key={d.label}
                  active={Math.abs(fill - d.value) < 0.01}
                  onClick={() => void load({ fill: d.value, source: 'demo' })}
                >
                  {d.label}
                </Chip>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {loading ? 'Membangun ulang lapangan…' : 'Tingkat isi lapangan bangkitan.'}
            </div>
          </>
        )}

        {source === 'depot' && (
          <div className="mt-1 text-[10px] text-slate-500">
            {loading
              ? 'Membaca database depot…'
              : `${data?.meta.totalContainers ?? 0} kontainer di ${data?.blocks.length ?? 0} blok`}
          </div>
        )}

        {/*
          Cacat data ditampilkan, bukan disembunyikan. Kalau lapangan menggambar
          lebih sedikit kontainer daripada isi database, alasannya harus terbaca
          di layar — bukan cuma di log server.
        */}
        {source === 'depot' && !loading && (data?.meta.conflicts ?? 0) > 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-amber-400/80">
            {data?.meta.conflicts} kontainer bertindihan posisinya di database dan tidak digambar.
          </div>
        )}
        {source === 'depot' && !loading && (data?.meta.duplicateNumbers ?? 0) > 0 && (
          <div className="mt-1 text-[10px] leading-relaxed text-amber-400/80">
            {data?.meta.duplicateNumbers} nomor kontainer dipakai lebih dari satu unit.
          </div>
        )}
      </Section>

      <TrafficSection />

      <Section title="Opsi tampilan">
        <Toggle checked={options.labels} onChange={(v) => setOption('labels', v)}>
          Nomor kontainer (saat dekat)
        </Toggle>
        <Toggle checked={options.adaptive} onChange={(v) => setOption('adaptive', v)}>
          Kualitas adaptif <span className="text-slate-500">(kejar 60 fps)</span>
        </Toggle>
        <Toggle checked={options.detail} onChange={(v) => setOption('detail', v)}>
          Model kontainer detail <span className="text-slate-500">(saat dekat)</span>
        </Toggle>
        {options.detail && (
          <Toggle
            checked={options.containerStyle === 'real'}
            onChange={(v) => setOption('containerStyle', v ? 'real' : 'asset')}
          >
            Kontainer realistis <span className="text-slate-500">(GP Maersk + reefer · matikan = aset lama)</span>
          </Toggle>
        )}
        <Toggle checked={options.rtg} onChange={(v) => setOption('rtg', v)}>
          RTG crane
        </Toggle>
        <Toggle checked={options.lamps} onChange={(v) => setOption('lamps', v)}>
          Tiang lampu
        </Toggle>
        <Toggle checked={options.trucks} onChange={(v) => setOption('trucks', v)}>
          Truk
        </Toggle>
        <Toggle checked={options.shadows} onChange={(v) => setOption('shadows', v)}>
          Bayangan <span className="text-slate-500">(berat)</span>
        </Toggle>
        <Toggle checked={options.blockInfo} onChange={(v) => setOption('blockInfo', v)}>
          Kapasitas blok <span className="text-slate-500">(% terisi · sisa box)</span>
        </Toggle>
        <Toggle checked={options.alerts} onChange={(v) => setOption('alerts', v)}>
          Peringatan <span className="text-slate-500">(bahaya · rusak · lewat batas)</span>
        </Toggle>
        <Toggle checked={options.view2d} onChange={(v) => setOption('view2d', v)}>
          Denah 2D <span className="text-slate-500">(dari atas)</span>
        </Toggle>
        <Toggle checked={options.tour} onChange={(v) => setOption('tour', v)}>
          Mode tur <span className="text-slate-500">(kamera berkeliling)</span>
        </Toggle>
        <Toggle checked={options.kiosk} onChange={(v) => setOption('kiosk', v)}>
          Layar monitor <span className="text-slate-500">(kiosk · Esc keluar)</span>
        </Toggle>
        <Toggle checked={options.autoSky} onChange={(v) => setOption('autoSky', v)}>
          Ikuti jam <span className="text-slate-500">(pagi · senja · malam)</span>
        </Toggle>
        {/* Dengan "Ikuti jam", malam ditentukan matahari — saklarnya dikunci. */}
        <div className={options.autoSky ? 'pointer-events-none opacity-40' : ''}>
          <Toggle checked={options.night} onChange={(v) => setOption('night', v)}>
            Malam <span className="text-slate-500">(lampu tiang menyala)</span>
          </Toggle>
        </div>
        <SubLabel>Cuaca</SubLabel>
        <div className="grid grid-cols-4 gap-1">
          {WEATHER.map((w) => (
            <Chip key={w.v} active={options.weather === w.v} onClick={() => setOption('weather', w.v)} title={w.title}>
              {w.label}
            </Chip>
          ))}
        </div>
      </Section>
    </Panel>
  );
}

const SPEEDS = [1, 2, 4, 8];

const WEATHER: { v: WeatherMode; label: string; title: string }[] = [
  { v: 'off', label: 'Cerah', title: 'Tanpa efek cuaca' },
  { v: 'live', label: 'Langsung', title: 'Cuaca sekarang di lokasi depot (Open-Meteo, tiap 10 menit)' },
  { v: 'rain', label: 'Hujan', title: 'Paksa hujan — untuk demo' },
  { v: 'fog', label: 'Kabut', title: 'Paksa kabut tebal — untuk demo' },
];

/**
 * Kendali lalu lintas truk gate.
 *
 * Untuk sementara kejadiannya datang dari pemutar ulang GATE_HIST. Saat
 * jembatan HiveMQ tersambung, kejadian yang sama masuk lewat pintu yang sama
 * (useTraffic.ingest) dan bagian ini cukup menampilkan keadaannya.
 */
function TrafficSection() {
  const trips = useTraffic((s) => s.trips);
  const replaying = useTraffic((s) => s.replaying);
  const speed = useTraffic((s) => s.speed);
  const setSpeed = useTraffic((s) => s.setSpeed);
  const showNetwork = useTraffic((s) => s.showNetwork);
  const setShowNetwork = useTraffic((s) => s.setShowNetwork);
  const replay = useTraffic((s) => s.replay);
  const stop = useTraffic((s) => s.stop);
  const note = useTraffic((s) => s.note);
  const diag = useTraffic((s) => s.diag);
  const skipped = useTraffic((s) => s.skipped);
  const followRtg = useTraffic((s) => s.followRtg);
  const setFollowRtg = useTraffic((s) => s.setFollowRtg);
  const rtgBusy = useTraffic((s) => s.busyRtg.length);

  /**
   * Relokasi contoh: satu kontainer teratas dipindah RTG ke tumpukan lain di
   * blok yang sama — lewat pintu yang sama dengan kejadian SHIFT dari broker.
   */
  const demoShift = () => {
    const data = useYard.getState().data;
    const blocks = [...(data?.blocks ?? [])].sort(() => Math.random() - 0.5);
    for (const b of blocks) {
      const r = pickRelocation(b);
      if (!r) continue;
      useTraffic.getState().ingest({
        kind: 'SHIFT',
        jobNo: '',
        ctrNo: r.c.no,
        truckNo: '',
        flow: 'R',
        position: { block: b.id, slot: r.to.bay * 2 + 1, row: r.to.row + 1, tier: r.to.tier },
      });
      return;
    }
    useTraffic.setState({ note: 'Tidak ada relokasi yang sah di lapangan ini.' });
  };

  const active = Object.keys(trips).length;
  const skippedList = Object.values(skipped);
  // Alasan dikelompokkan, supaya sepuluh kontainer yang sudah keluar terbaca
  // sebagai satu baris, bukan sepuluh.
  const reasons = new Map<string, number>();
  for (const r of skippedList) {
    const key = r.endsWith('tidak ada di lapangan') ? 'kontainer sudah tidak di lapangan' : r;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  return (
    <Section title="Lalu lintas gate">
      <div className="grid grid-cols-2 gap-1">
        <Chip active={replaying} onClick={() => void replay(20)} title="Putar ulang 20 perjalanan terakhir dari GATE_HIST">
          Putar ulang
        </Chip>
        <Chip active={false} onClick={stop}>
          Hentikan
        </Chip>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1">
        {SPEEDS.map((v) => (
          <Chip key={v} active={speed === v} onClick={() => setSpeed(v)}>
            {v}×
          </Chip>
        ))}
      </div>
      <DayReplay />
      <div className="mt-1.5 grid grid-cols-2 gap-1">
        <Chip active={false} onClick={demoShift} title="RTG memindah satu kontainer ke tumpukan lain di blok yang sama">
          Contoh relokasi
        </Chip>
        <Chip
          active={followRtg}
          onClick={() => setFollowRtg(!followRtg)}
          title="Kamera mengikuti RTG yang sedang bekerja"
        >
          Ikuti RTG{rtgBusy ? ` · ${rtgBusy}` : ''}
        </Chip>
      </div>
      <div className="mt-1.5">
        <Toggle checked={showNetwork} onChange={setShowNetwork}>
          Jaringan jalan
        </Toggle>
      </div>

      <div className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-slate-500">
        <div>
          {active} truk di lapangan
          {diag && ` · ${diag.gatesIn} gate masuk · ${diag.gatesOut} gate keluar`}
        </div>
        {note && <div>{note}</div>}
        {diag && diag.gatesIn === 0 && (
          <div className="text-amber-400/80">
            Tata letak belum punya gate — taruh gate di jalan lewat Sunting lapangan.
          </div>
        )}
        {diag && diag.unreachable.length > 0 && diag.gatesIn > 0 && (
          <div className="text-amber-400/80">
            Tidak tersambung jalan ke gate: blok {diag.unreachable.join(', ')}
          </div>
        )}
        {[...reasons].map(([r, n]) => (
          <div key={r} className="text-amber-400/70">
            {n} dilewati: {r}
          </div>
        ))}
      </div>
    </Section>
  );
}
