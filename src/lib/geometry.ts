import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GATE,
  ROAD,
  ROAD_ARMS,
  roadTileParts,
  type RoadKind,
  BOX,
  LANE,
  LANE_RAIL_NEAR,
  PITCH,
  RTG,
  RTG_RAIL_Z,
} from './constants';

/**
 * Geometri kontainer ISO dengan dinding bergelombang.
 *
 * Ini inti dari trik performanya: dinding corrugated dibuat dengan menggeser
 * vertex sebuah BoxGeometry bersegmen rendah (26x2x1 ≈ 300 triangle), bukan
 * dengan memakai model GLB detail yang bisa 10.000+ triangle per kontainer.
 * Hasil visualnya nyaris sama pada jarak pandang lapangan, tetapi 30.000
 * kontainer jadi ~9 juta triangle, bukan 300 juta.
 */
export function createContainerGeometry(length: number) {
  const geo = new THREE.BoxGeometry(length, BOX.height, BOX.width, 26, 2, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const amp = 0.05;
  const freq = (Math.PI * 2 * Math.round(length / 0.9)) / length;

  for (let i = 0; i < pos.count; i++) {
    const nz = nrm.getZ(i);
    const ny = nrm.getY(i);
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Dinding samping: gelombang sepanjang badan kontainer.
    if (Math.abs(nz) > 0.9 && Math.abs(y) < BOX.height / 2 - 0.001) {
      pos.setZ(i, pos.getZ(i) + Math.sin(x * freq) * amp * Math.sign(nz));
    }
    // Atap sedikit bergelombang supaya pantulan cahaya tidak rata.
    if (ny > 0.9) {
      pos.setY(i, pos.getY(i) + Math.sin(x * freq) * amp * 0.5);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Reefer untuk LOD jauh: kotak kontainer biasa plus panel unit mesin di satu
 * ujung.
 *
 * Panelnya cuma 12 segitiga, tapi itu yang membuat reefer bisa dibedakan dari
 * kontainer biasa saat kamera masih jauh — di jarak itu tekstur tidak dipakai,
 * jadi bentuk adalah satu-satunya petunjuk yang tersisa. Aset GLB-nya sendiri
 * membawa unit pendingin di tekstur, bukan geometri, jadi saat LOD bertukar
 * panel ini hilang; selisihnya 0,16 m pada kontainer 6 m.
 */
export function createReeferGeometry(length: number) {
  const body = createContainerGeometry(length);
  // Menonjol 0,16 m keluar ujung. Masih di dalam kelonggaran slot (0,34 m
  // untuk 20ft), jadi tidak menyentuh kontainer di slot sebelahnya.
  const unit = box(0.22, BOX.height * 0.72, BOX.width * 0.88, -length / 2 - 0.05, 0, 0);
  const geo = mergeGeometries([body, unit], false)!;
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Tank container untuk LOD jauh — barel silinder di dalam rangka ISO.
 *
 * Aset GLB tank-nya 78.630 segitiga; ini 200. Yang harus benar dari jarak
 * lapangan cuma siluetnya: barel bulat di dalam rangka terbuka, jelas berbeda
 * dari kotak, dan menempati kotak ISO yang sama persis.
 */
export function createTankGeometry() {
  const L = BOX.len20;
  const H = BOX.height;
  const W = BOX.width;
  const bar = 0.14;
  const parts: THREE.BufferGeometry[] = [];

  // Barel. Diameternya diambil dari aset GLB: 2,32 m di dalam rangka 2,44 m.
  const barrel = new THREE.CylinderGeometry(1.14, 1.14, L - 0.6, 14, 1);
  barrel.rotateZ(Math.PI / 2);
  parts.push(barrel);

  const endX = L / 2 - bar / 2;
  const sideZ = W / 2 - bar / 2;
  const topY = H / 2 - bar / 2;

  // Dua bingkai ujung: empat tiang sudut plus rel atas dan bawah.
  for (const sx of [-endX, endX]) {
    for (const sz of [-sideZ, sideZ]) parts.push(box(bar, H, bar, sx, 0, sz));
    for (const sy of [-topY, topY]) parts.push(box(bar, bar, W, sx, sy, 0));
  }
  // Rel memanjang yang menyambung kedua bingkai.
  for (const sz of [-sideZ, sideZ]) {
    for (const sy of [-topY, topY]) parts.push(box(L, bar, bar, 0, sy, sz));
  }

  const geo = mergeGeometries(parts, false)!;
  geo.computeBoundingSphere();
  return geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/**
 * RTG (Rubber Tyred Gantry) sebagai SATU geometry hasil merge.
 *
 * Kalau tiap balok jadi mesh sendiri, 24 RTG = ~350 draw call — lebih mahal
 * daripada seluruh kontainernya. Digabung lalu di-instance: 1 draw call.
 */
/**
 * Tinggi spreader tergantung.
 *
 * Harus bebas di atas tumpukan tertinggi: tier 5 puncaknya di
 * 4 x PITCH.tier + BOX.height = 13,07 m. RTG diletakkan di bay acak, jadi
 * spreader yang menggantung lebih rendah cepat atau lambat pasti menembus
 * sebuah tumpukan penuh.
 */
const SPREADER_Y = RTG.height - 6.4;
/** Posisi trolley pada sumbu Z: tepat di atas sumbu blok, bukan sumbu portal. */
const TROLLEY_Z = -RTG.offsetZ;
const TROLLEY_Y = RTG.height + 3.05;

/**
 * RTG (Rubber Tyred Gantry) sebagai SATU geometry hasil merge.
 *
 * Kalau tiap balok jadi mesh sendiri, 30 RTG = ~700 draw call — lebih mahal
 * daripada seluruh kontainernya. Digabung lalu di-instance: 1 draw call untuk
 * ~600 segitiga per unit.
 *
 * Susunannya mengikuti RTG sungguhan: dua girder membentang MELINTANG blok
 * (sumbu Z) di atas masing-masing baris kaki, dan trolley berjalan di atas
 * girder itu untuk memilih row. Yang berjalan pada sumbu X adalah seluruh
 * portalnya, di atas delapan roda karet.
 */
export function createRtgGeometry() {
  const { span, height, legX } = RTG;
  const legW = 1.05;
  const parts: THREE.BufferGeometry[] = [];

  // Roda: sumbunya melintang (Z), karena RTG berjalan pada sumbu X.
  const wheel = (x: number, z: number) => {
    const g = new THREE.CylinderGeometry(0.78, 0.78, 0.52, 10);
    g.rotateX(Math.PI / 2);
    g.translate(x, 0.78, z);
    return g;
  };

  for (const sx of [-legX, legX]) {
    for (const sz of [-RTG_RAIL_Z, RTG_RAIL_Z]) {
      // Bogie + sepasang roda per sudut.
      parts.push(box(4.4, 1.0, 1.5, sx, 1.85, sz));
      parts.push(wheel(sx - 1.45, sz), wheel(sx + 1.45, sz));
      parts.push(box(legW, height - 2.4, legW, sx, 2.4 + (height - 2.4) / 2, sz));
    }
    // Girder utama tempat trolley berjalan. Tidak ada palang melintang di
    // bawahnya: apa pun yang membentang di atas blok pada ketinggian sedang
    // akan menembus tumpukan tier 5 yang puncaknya 13,07 m.
    parts.push(box(1.5, 2.3, span, sx, height + 1.15, 0));
  }

  for (const sz of [-RTG_RAIL_Z, RTG_RAIL_Z]) {
    // Rangka portal: pengikat atas dan sill bawah antara dua kaki sejajar X.
    parts.push(box(legX * 2, 1.1, 1.1, 0, height + 1.15, sz));
    parts.push(box(legX * 2, 0.9, 0.9, 0, 2.7, sz));
  }
  // Pengikat tengah antara kedua girder.
  parts.push(box(legX * 2, 0.8, 0.9, 0, height + 1.15, 0));

  // Trolley di atas girder, plus empat tali hoist ke spreader.
  parts.push(box(4.2, 1.5, 6.4, 0, TROLLEY_Y, TROLLEY_Z));
  const ropeLen = TROLLEY_Y - 0.75 - SPREADER_Y;
  for (const rx of [-2.2, 2.2]) {
    for (const rz of [TROLLEY_Z - 1.05, TROLLEY_Z + 1.05]) {
      parts.push(box(0.14, ropeLen, 0.14, rx, SPREADER_Y + ropeLen / 2, rz));
    }
  }

  // Rumah mesin + kabin operator, menggantung di satu sisi portal.
  parts.push(box(3.0, 2.2, 2.6, 0, height - 1.6, RTG_RAIL_Z - 3.0));

  return mergeGeometries(parts, false)!;
}

/**
 * Spreader RTG — geometry terpisah supaya bisa diberi warna oranye sendiri.
 *
 * Satu instanced mesh tidak bisa punya dua material, jadi bagian yang warnanya
 * beda harus jadi mesh sendiri. Tambahan satu draw call untuk SELURUH RTG,
 * dan posisinya memakai konstanta yang sama dengan tali hoist-nya.
 */
export function createRtgSpreaderGeometry() {
  const y = SPREADER_Y;
  // Dibangun di z=0, bukan di TROLLEY_Z: penempatannya yang menaruh spreader
  // di bawah trolley, karena trolley bergeser saat portal RTG diskalakan
  // mengikuti lebar blok.
  const z = 0;
  return mergeGeometries(
    [
      box(BOX.len40, 0.5, 0.42, 0, y, z - 1.05),
      box(BOX.len40, 0.5, 0.42, 0, y, z + 1.05),
      box(0.9, 0.46, 2.6, -BOX.len40 / 2 + 0.45, y, z),
      box(0.9, 0.46, 2.6, BOX.len40 / 2 - 0.45, y, z),
      // Kepala spreader, tempat tali bertemu.
      box(2.6, 0.75, 2.1, 0, y + 0.45, z),
    ],
    false,
  )!;
}

/** Tiang lampu lapangan — juga digabung supaya bisa di-instance. */
export function createLampGeometry() {
  const h = 34;
  const parts = [
    box(1.4, 1, 1.4, 0, 0.5, 0),
    box(0.8, h, 0.8, 0, h / 2, 0),
    box(5, 0.6, 3.2, 0, h + 0.3, 0),
  ];
  return mergeGeometries(parts, false)!;
}

/**
 * Chassis peti kemas 40ft, disambungkan ke traktor GLB.
 *
 * Asetnya cuma kepala traktor — tidak ada chassis sama sekali. Geometri ini
 * dibangun pada KOORDINAT YANG SAMA dengan traktor setelah diorientasi, jadi
 * keduanya bisa dipasang sebagai dua instanced mesh dengan matriks yang persis
 * sama dan tetap menyatu.
 *
 * Angka-angka di bawah diukur dari asetnya sendiri, bukan dikira-kira:
 * setelah rotateY(-90°) traktor membentang X -1,45 (buritan) sampai +4,46
 * (moncong), dengan rangka DATAR setinggi 1,11 m dari X -0,86 sampai +0,91.
 * Rangka itulah dudukan fifth wheel, jadi kingpin ditaruh di tengahnya.
 */
export function createChassisGeometry() {
  const parts: THREE.BufferGeometry[] = [];

  /** Kingpin: titik putar tempat chassis bertumpu pada traktor. */
  const KINGPIN_X = 0.15;
  /** Puncak rangka traktor, terukur dari asetnya. Semua struktur chassis di
   *  belakang moncong harus berada DI ATAS ini, kecuali pelat kingpin yang
   *  memang duduk padanya. */
  const FIFTH_WHEEL_Y = 1.11;
  /** Tinggi dek tempat kontainer duduk. */
  const DECK_Y = 1.45;
  /** Muka depan kontainer; kabin mulai di X 1,50, jadi ini menyisakan 0,2 m. */
  const FRONT_X = 1.30;
  const REAR_X = FRONT_X - BOX.len40;
  const RAIL_Z = 0.46;
  const OUTER_Z = BOX.width / 2;
  const spanX = FRONT_X - REAR_X;
  const midX = (FRONT_X + REAR_X) / 2;

  // Dua rel memanjang. Sisi bawahnya di 1,19 m — bebas 8 cm di atas rangka
  // traktor, jadi chassis tidak menembus kepala truknya.
  for (const sz of [-RAIL_Z, RAIL_Z]) {
    parts.push(box(spanX, 0.26, 0.16, midX, DECK_Y - 0.13, sz));
  }
  // Palang melintang tiap ~2 m, selebar kontainer.
  const cross = Math.round(spanX / 2);
  for (let i = 0; i <= cross; i++) {
    parts.push(box(0.14, 0.16, OUTER_Z * 2, REAR_X + (i * spanX) / cross, DECK_Y - 0.19, 0));
  }
  // Rel tepi setinggi dek, tempat kontainer benar-benar duduk.
  for (const sz of [-OUTER_Z + 0.06, OUTER_Z - 0.06]) {
    parts.push(box(spanX, 0.1, 0.12, midX, DECK_Y - 0.05, sz));
  }
  // Twist lock di empat sudut kontainer.
  for (const sx of [FRONT_X - 0.15, REAR_X + 0.15]) {
    for (const sz of [-OUTER_Z + 0.1, OUTER_Z - 0.1]) {
      parts.push(box(0.22, 0.14, 0.22, sx, DECK_Y + 0.05, sz));
    }
  }

  // Leher angsa: turun dari dek ke pelat kingpin. Bagian terendahnya tepat di
  // atas fifth wheel, bukan menembusnya.
  parts.push(box(1.4, 0.14, 0.86, KINGPIN_X + 0.6, FIFTH_WHEEL_Y + 0.14, 0));
  parts.push(box(0.66, 0.06, 0.66, KINGPIN_X, FIFTH_WHEEL_Y + 0.03, 0));

  // Bogie dua gandar di buritan, roda ganda disederhanakan jadi satu lebar.
  const wheel = (x: number, z: number) => {
    const g = new THREE.CylinderGeometry(0.52, 0.52, 0.34, 12);
    g.rotateX(Math.PI / 2);
    g.translate(x, 0.52, z);
    return g;
  };
  for (const ax of [REAR_X + 1.2, REAR_X + 2.6]) {
    parts.push(box(0.18, 0.18, OUTER_Z * 1.7, ax, 0.52, 0));
    for (const sz of [-OUTER_Z + 0.22, OUTER_Z - 0.22]) parts.push(wheel(ax, sz));
  }
  // Kaki penopang, terangkat karena sedang tersambung. Ditaruh di belakang
  // buritan traktor (X -1,45) supaya tidak beradu dengannya.
  for (const sz of [-0.55, 0.55]) {
    parts.push(box(0.16, 0.42, 0.16, -2.4, DECK_Y - 0.42, sz));
  }
  // Pelindung kolong di buritan.
  parts.push(box(0.12, 0.5, OUTER_Z * 1.9, REAR_X + 0.1, 0.62, 0));

  const geo = mergeGeometries(parts, false)!;
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Kontainer 40ft yang sedang diangkut, duduk di atas dek chassis.
 *
 * Dibangun terpisah supaya truk bisa digambar bermuatan maupun kosong tanpa
 * dua geometri chassis yang berbeda.
 */
export function createChassisLoadGeometry() {
  const g = createContainerGeometry(BOX.len40);
  g.translate(1.3 - BOX.len40 / 2, 1.45 + BOX.height / 2, 0);
  g.computeBoundingSphere();
  return g;
}

/**
 * Tekstur marka slot di aspal, dibuat sekali di canvas lalu di-repeat.
 * Satu tekstur dipakai semua blok — tidak ada biaya per blok.
 */
export function createSlotMarkingTexture(anisotropy = 4) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#96978f';
  ctx.fillRect(0, 0, size, size);
  // Kuning, seperti marka slot di terminal sungguhan.
  ctx.strokeStyle = 'rgba(226, 196, 62, 0.8)';
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, size - 6, size - 6);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(10, 10, size - 20, size - 20);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Marka lorong antar-baris-blok: lajur layanan truk, rel RTG, dan jalan dua
 * arah — dilukis sekali ke canvas lalu di-repeat sepanjang blok.
 *
 * Dibuat sebagai tekstur, bukan geometri: marka garis putus-putus butuh
 * ratusan quad per lorong kalau digambar sebagai mesh, sementara sebagai
 * tekstur seluruh 30 lorong tetap 1 draw call dengan satu gambar 256x512.
 *
 * Orientasi canvas (sudah diverifikasi dari UV PlaneGeometry yang dirotasi
 * -90° pada X, sama seperti alas blok): kolom kiri = -X, dan BARIS ATAS =
 * Z paling negatif, yaitu tepi blok. Jadi baris canvas bisa dipetakan
 * langsung dari jarak relatif terhadap tepi blok.
 */
export function createLaneTexture(anisotropy = 4) {
  const W = 256;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  /** meter melintang lorong -> baris canvas */
  const z = (m: number) => (m / LANE.width) * H;
  /** meter sepanjang lorong -> kolom canvas */
  const x = (m: number) => (m / LANE.tile) * W;

  const band = (center: number, thickness: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, z(center - thickness / 2), W, z(thickness));
  };

  const dashed = (center: number, thickness: number, color: string) => {
    ctx.fillStyle = color;
    const period = 4;
    for (let m = 0; m < LANE.tile; m += period) {
      ctx.fillRect(x(m), z(center - thickness / 2), x(period * 0.55), z(thickness));
    }
  };

  ctx.fillStyle = '#82837d';
  ctx.fillRect(0, 0, W, H);

  // Strip keselamatan bergaris miring, menempel di kaki tumpukan.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, z(0.55));
  ctx.clip();
  ctx.fillStyle = '#8a7420';
  ctx.fillRect(0, 0, W, z(0.55));
  ctx.strokeStyle = '#2b2f36';
  ctx.lineWidth = z(0.16);
  for (let m = -1; m < LANE.tile + 1; m += 0.8) {
    ctx.beginPath();
    ctx.moveTo(x(m), 0);
    ctx.lineTo(x(m + 0.6), z(0.55));
    ctx.stroke();
  }
  ctx.restore();

  // Lajur layanan truk, di bawah kantilever RTG. Pita ini juga dipakai nomor
  // slot (lihat BlockLabels), jadi dibiarkan sepolos mungkin.
  band(LANE.service.from, 0.18, '#e8c33a');
  band(LANE.service.to, 0.18, '#e8c33a');

  // Rel RTG blok INI saja: garis kuning ganda, tepat di bawah roda.
  //
  // Rel di seberang lorong sengaja tidak digambar. Rel itu milik RTG blok
  // berikutnya, dan tiap blok sudah menggambar strip lorongnya sendiri —
  // menggambarnya di sini berarti satu rel yang sama muncul dua kali, atau
  // muncul sama sekali di lorong yang di seberangnya memang tidak ada blok.
  band(LANE_RAIL_NEAR - 0.32, 0.16, '#e8c33a');
  band(LANE_RAIL_NEAR + 0.32, 0.16, '#e8c33a');

  // Sisa lorong DI LUAR jalan dikembalikan ke warna aspal apron.
  //
  // Sisa itu dulu berisi rel RTG blok seberang. Setelah rel itu tidak lagi
  // digambar, yang tertinggal cuma pita aspal lebih gelap selebar 3,8 m tanpa
  // satu pun marka — terbaca sebagai jalan yang tidak selesai. Dengan warna
  // apron, strip lorong berakhir tepat di tepi luar jalan dan tidak ada
  // kelebihan yang tersisa.
  //
  // Lebar lorong sendiri TIDAK diubah. Jarak antar blok diturunkan dari
  // YARD.gapZ, dan DEPOT_MAP_SCALE dipaku memakai angka itu; mengubahnya akan
  // menggeser ketiga blok yang sekarang tergambar benar.
  ctx.fillStyle = '#8e9089';
  ctx.fillRect(0, z(LANE.road.to), W, z(LANE.width - LANE.road.to));

  // Jalan dua arah, dengan marka tepi di KEDUA sisi.
  //
  // Dulu hanya sisi dalam yang digaris, dengan alasan perubahan warna aspal di
  // sisi luar sudah cukup menandai batas lorong. Alasan itu gugur begitu ubin
  // jalan bisa disambungkan ke ujung lorong: ubin punya garis di kedua tepinya,
  // jadi garis luar yang hilang di sini terbaca sebagai marka yang putus tepat
  // di sambungan.
  //
  // Garisnya ditaruh DI DALAM badan jalan, bukan dipusatkan pada garis tepi —
  // sama seperti roadTileParts menyisipkannya ke dalam. Kalau dipusatkan,
  // separuh tebalnya jatuh di luar badan jalan dan sambungannya meleset
  // setengah tebal garis dari marka ubin.
  const mid = (LANE.road.from + LANE.road.to) / 2;
  ctx.fillStyle = '#e8c33a';
  ctx.fillRect(0, z(LANE.road.from), W, z(ROAD.line));
  ctx.fillRect(0, z(LANE.road.to - ROAD.line), W, z(ROAD.line));
  dashed(mid, 0.16, '#e8e6dc');

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Ukuran alas blok (dipakai untuk plane marka dan area aspal). */
export const blockFootprint = (slots: number, rows: number) => ({
  length: slots * PITCH.teu,
  width: rows * PITCH.row,
});

/**
 * Tekstur satu ubin jalan: lurus, belokan, pertigaan, atau perempatan.
 *
 * Marka tepinya tidak digambar garis per garis. Seluruh badan jalan dicat warna
 * garis dulu, lalu bagian dalamnya ditimpa aspal — yang tersisa persis
 * KELILINGNYA, berapa pun bentuknya. Itu sebabnya belokan mendapat garis yang
 * membelok dan perempatan mendapat empat sudut yang benar tanpa satu pun kasus
 * khusus. Ujung tiap lengan sengaja dilebihkan melewati tepi ubin supaya
 * tutupnya terpotong keluar kanvas; kalau tidak, akan ada garis melintang di
 * batas antar-ubin.
 *
 * Sistem koordinat kanvas sama dengan pandangan dari atas: x ke kanan = +X
 * dunia, y ke bawah = +Z dunia. Jadi E/W/N/S di ROAD_ARMS bisa dibaca apa
 * adanya.
 */
export function createRoadTileTexture(kind: RoadKind, anisotropy = 4) {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;

  /** meter -> piksel */
  const px = (m: number) => (m / ROAD.tile) * S;
  const c = S / 2;
  const dash = px(0.18);

  const ASPAL = '#82837d';
  const TEPI = '#e8c33a';
  const TENGAH = '#e8e6dc';

  const arms = ROAD_ARMS[kind];
  const has = (d: 'E' | 'W' | 'N' | 'S') => arms.includes(d);
  const parts = roadTileParts(kind);
  const box = (r: { x: number; y: number; w: number; h: number }) =>
    ctx.fillRect(px(r.x), px(r.y), px(r.w), px(r.h));

  // Di luar badan jalan ubin dibiarkan TEMBUS PANDANG, tidak dicat.
  //
  // Ubin sering ditaruh menimpa lorong samping blok supaya jalannya menyambung.
  // Kalau sisanya dicat warna bahu, cat itu akan menutupi rel RTG, lajur
  // layanan, dan nomor slot di bawahnya — jalan yang menyambung dibayar dengan
  // marka blok yang hilang.
  ctx.clearRect(0, 0, S, S);

  ctx.fillStyle = TEPI;
  for (const r of parts.outer) box(r);
  ctx.fillStyle = ASPAL;
  for (const r of parts.inner) box(r);

  // Marka tengah putus-putus, berjangkar pada titik nol ubin supaya polanya
  // menyambung mulus ke ubin sebelahnya.
  const period = 4;
  const mark = period * 0.55;
  ctx.fillStyle = TENGAH;
  if (has('E') || has('W')) {
    for (let m = 0; m < ROAD.tile; m += period) {
      ctx.fillRect(px(m), c - dash / 2, px(mark), dash);
    }
  }
  if (has('N') || has('S')) {
    for (let m = 0; m < ROAD.tile; m += period) {
      ctx.fillRect(c - dash / 2, px(m), dash, px(mark));
    }
  }

  // Di persimpangan tidak ada marka tengah — sama seperti di jalan sungguhan.
  // Kotaknya dikecilkan setebal garis supaya keliling yang baru saja dibentuk
  // tidak ikut terhapus.
  if (parts.junction) {
    ctx.fillStyle = ASPAL;
    box(parts.junction);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = anisotropy;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Potongan jalan lurus bisa lebih panjang atau lebih pendek dari satu ubin,
  // dan UV-nya diskalakan mengikuti panjang itu. Tanpa RepeatWrapping, sisa di
  // luar 0..1 akan menjadi rentangan piksel tepi, bukan pola marka yang
  // menyambung.
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Rangka gate: tiang, kanopi, dan pos petugas di antara lajur.
 *
 * Papan namanya dipisah ke geometri sendiri karena warnanya berbeda antara
 * gate masuk dan keluar, dan satu InstancedMesh hanya bisa punya satu material
 * — pemisahan yang sama seperti RTG dengan spreader-nya.
 */
export function createGateGeometry(booths: 'all' | 'center' = 'all') {
  const { depth, span, clear, lanes } = GATE;
  const post = 0.7;
  const parts = [
    // Kanopi.
    box(depth, 0.5, span, 0, clear + 0.25, 0),
    // Empat tiang sudut.
    box(post, clear, post, -depth / 2 + post, clear / 2, -span / 2 + post),
    box(post, clear, post, depth / 2 - post, clear / 2, -span / 2 + post),
    box(post, clear, post, -depth / 2 + post, clear / 2, span / 2 - post),
    box(post, clear, post, depth / 2 - post, clear / 2, span / 2 - post),
  ];

  // Pos petugas di pembatas antar lajur.
  //
  // 'all' memasang satu di tiap pembatas — dipakai gate satu arah, yang seluruh
  // lajurnya searah dan tiap lajur perlu petugasnya sendiri.
  //
  // 'center' hanya memasang yang di tengah. Itu untuk gate dua arus: yang benar
  // -benar perlu dipisahkan di sana cuma arus masuk dari arus keluar, dan pos
  // di kiri-kanan hanya mempersempit lajur tanpa memisahkan apa pun.
  const pitch = span / lanes;
  for (let i = 1; i < lanes; i++) {
    const z = -span / 2 + i * pitch;
    if (booths === 'center' && Math.abs(z) > 1e-6) continue;
    parts.push(box(3.2, 2.9, 1.5, 0, 1.45, z));
  }
  return mergeGeometries(parts, false)!;
}

/**
 * Papan nama di atas kanopi, menghadap arah datangnya truk.
 *
 * `side` menentukan bagian mana yang ditandai: 'in' separuh -Z, 'out' separuh
 * +Z, 'full' seluruh bentang. Gate dua arus memakai dua papan setengah dengan
 * warna berbeda; gate satu arah memakai satu papan penuh.
 */
export function createGateSignGeometry(side: 'full' | 'in' | 'out' = 'full') {
  const { depth, span, clear } = GATE;
  const half = span / 2;
  const z0 = side === 'out' ? 0 : -half;
  const z1 = side === 'in' ? 0 : half;
  const len = (z1 - z0) * 0.86;
  const mid = (z0 + z1) / 2;
  return mergeGeometries(
    [
      box(0.4, 1.6, len, -depth / 2 + 0.2, clear + 1.3, mid),
      box(0.4, 1.6, len, depth / 2 - 0.2, clear + 1.3, mid),
    ],
    false,
  )!;
}
