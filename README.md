# Container Yard 3D

Visualisasi 3D lapangan penumpukan peti kemas untuk web. Dibangun sebagai jawaban
atas masalah yang biasa muncul saat merender container yard dengan three.js:
**FPS patah-patah begitu jumlah kontainer masuk ribuan.**

Intinya bukan mesin render yang salah, melainkan cara memberi perintah ke GPU.
Proyek ini menempuh jalur yang benar sejak awal dan menampilkan angkanya di layar
supaya bisa dibuktikan sendiri.

## Menjalankan

```bash
npm install
npm run dev          # http://localhost:3000
```

Perintah lain: `npm run build`, `npm start`, `npm run lint`.

Isi lapangan dibaca dari database depot (Oracle 19c) lewat
[/api/yard](src/app/api/yard/route.ts). Kredensialnya di `.env.local`
(sudah masuk `.gitignore`):

```
DEPOT_DB_USER=...
DEPOT_DB_PASS=...
DEPOT_DB_CONNECT_STRING=host:port/service
DEPOT_DB_LOGGING=true
```

Driver `oracledb` berjalan di mode **thin** — tidak perlu Oracle Instant
Client. Lapangan bangkitan lama tetap ada di
[src/lib/yard.ts](src/lib/yard.ts) dan bisa dipanggil lewat
`/api/yard?source=demo&fill=0.68`, atau dari tombol **Demo** di panel kiri;
itu yang dipakai untuk menguji renderer pada belasan ribu kontainer, jumlah
yang tidak ada di database mana pun di sini.

## Membaca database depot

Tiga tabel. `CORE_YARD_BLOCK` adalah daftar blok resmi — ukuran, nama, dan
posisinya di peta lapangan. `YARD_ROWTIER` menyimpan slot mana ditempati
kontainer mana. `CONTAINER` menyimpan detailnya, disambung lewat `CTR_KEY`.

Bentuk lapangannya beda-beda per lingkungan — dev tiga blok dengan 211
kontainer, demo empat blok (A 19x5, B 20x6, C 16x5, D 24x6 posisi, tujuh tier)
dengan 709 kontainer. Jadi tidak ada satu pun ukuran yang boleh jadi konstanta:
alas, marka lorong, nomor slot dan row, tiang lampu, dan bentang portal RTG
semuanya diturunkan dari `slots`/`rows` tiap blok. Ganti `DEPOT_DB_CONNECT_STRING`
saja sudah cukup untuk pindah lingkungan.

**Penomoran slotnya ganjil, tapi posisinya berurutan.** `YARD_SLOT` berisi
1, 3, 5, …, 2n−1 — nol baris bernomor genap. Itu konvensi bay ISO: nomor genap
disediakan untuk posisi 40ft yang membentang di antara dua yang ganjil. Jadi
`bay = (slot−1)/2`, dan jumlah posisinya persis `CORE_YARD_BLOCK.YARD_SLOT`.

**Satu kontainer 40ft punya DUA baris di `YARD_ROWTIER`**, satu per slot yang
ditempatinya. Terukur: 478 kontainer berbaris tunggal (20ft) dan 231 berbaris
ganda (40ft) — 478 + 231x2 = 940 baris untuk 709 kontainer. Tanpa dedup, tiap
40ft digambar dua kali di dua tempat; kuerinya memakai `ROW_NUMBER()` dan
mengambil baris ber-slot terkecil, karena itu pangkal bentangannya.

Kedua fakta itu awalnya salah saya baca, dan salahnya kelihatan di layar:
petak marka jadi dua kali terlalu besar, dan di antara tiap slot bernomor
muncul petak tanpa nomor dan tanpa kontainer. Penomoran dan ukuran petak
sekarang dipisah — `slotStep` di `YardBlock` hanya mengatur angka yang
ditulis (2 untuk depot, 1 untuk demo), sementara petaknya selalu satu posisi
selebar 20ft.

**Posisi blok** diambil dari kolom `X`/`Y` `CORE_YARD_BLOCK`. Satuannya tidak
tertulis di mana pun dan nilainya terlalu renggang untuk meter — di dev, jarak
A ke B 156 satuan sementara blok A cuma 14,5 m lebarnya, yang berarti lorong
140 meter. Kemungkinan besar itu koordinat peta 2D di layar TOS-nya.

Yang dipakai karena itu adalah **susunan relatifnya**, dengan skala diturunkan
dari datanya sendiri: angka terkecil yang membuat lorong tersempit selebar
`YARD.gapZ`. Di lingkungan demo hasilnya lorong 26,8 / 27,2 / 26,0 m —
**nyaris seragam**, padahal skalanya cuma satu angka untuk keempat blok. Itu
petunjuk kuat bahwa lorong aslinya memang seragam dan skala turunan (0,2631
m/satuan) mendekati satuan sebenarnya. Kalau X/Y ternyata punya satuan pasti,
yang perlu diubah cuma fungsi `layout()` di `depot.ts`.

Beberapa kolom tidak berisi apa yang namanya janjikan, dan pemetaannya
menyesuaikan itu — semuanya diperiksa dulu, bukan diasumsikan:

| yang dibutuhkan | diambil dari | kenapa |
|---|---|---|
| shipping line | `AGENT` | `CTR_OPR` kosong seluruhnya; `AGENT` terisi 100% |
| berat | `TARE` | `GROSS` kosong seluruhnya; `TARE` pun sering kosong (118 dari 778 di demo), jadi berat 0 = **tidak diketahui**, ditampilkan "—" |
| reefer | `CTR_TYPE` RE/RF/RH/RT, cadangan digit ke-3 `ISO_CODE` | `IS_REEFER` kosong di semua lingkungan. Digit ISO saja cuma menangkap 27 dari 238 reefer di produksi — sisanya ber-ISO gaya lain (`40HC`) tapi `CTR_TYPE`-nya jelas RH/RF |
| tank | `CTR_TYPE = 'TK'` | 4 unit di lapangan |
| rusak | `IS_DAMAGE = 'Y'` | — |

Yang perlu diketahui: **86 dari 211** kontainer itu `HIST_YN = 'Y'`. Slot-nya
masih tercatat terisi, jadi semuanya ikut digambar — tapi kalau di sistem kamu
`HIST_YN = 'Y'` berarti kontainernya sudah keluar, tambahkan filternya di
`CONTAINER_SQL`. Dan tiga slot terisi menyebut `CONTAINER_KEY` yang barisnya
sudah tidak ada; join-nya inner, jadi ketiganya tidak digambar.

Ukuran 45ft (2 unit) digambar sebagai 40ft — selisih 0,9 m, jauh lebih kecil
daripada menaruhnya di slot yang salah. Kolom `TRUCK_LANE` (`'L'` untuk
ketiga blok) belum dipakai: lajur layanan masih selalu digambar di sisi +Z,
karena arti "L" terhadap blok berorientasi `HORZ_VERT = 'H'` belum jelas.
→ [depot.ts](src/lib/depot.ts)

## Angka yang terukur

Preset kepadatan **Normal**, seluruh lapangan terlihat dari jauh (semua blok
pada LOD jauh):

| | |
|---|---|
| Kontainer di lapangan | **12.480** (30 blok, 19.128 TEU) |
| Komposisi | 11.937 GP box · **543 tank** (4,4%) |
| Draw call kontainer | **90** — 30 blok x 3 kelompok (GP 20ft, GP 40ft, tank) |
| Draw call marka lajur | **1** — 30 lorong, satu tekstur di-instance |
| Triangle | ±4,0 juta |
| Draw call saat filter aktif | **tidak berubah** — filter hanya menulis ulang warna |

Preset **Stress** menaikkan isi ke 18.888 kontainer (29.355 TEU) tanpa menambah
draw call sama sekali.

Begitu kamera turun mendekat, empat blok terdekat naik ke model GLB penuh. Tiap
blok detail menukar 3 draw call dengan 9 (GP 2 + GP 2 + tank 5, sudah digabung
per material); blok terpadat pada preset Normal jadi 6,0 juta triangle, empat
blok 23,8 juta. Anggaran empat blok itulah yang menahan biayanya — bukan ambang
jaraknya; lihat keputusan nomor 2.

Sebagai pembanding, pendekatan naif — satu `mesh` per kontainer dari model
`.glb` — menghasilkan **12.480 draw call**, dan dengan aset GLB yang dipakai di
sini (8.379 triangle per GP, 78.630 per tank) berarti **±143 juta triangle**
untuk satu frame.

> Catatan jujur: hitungan kontainer, TEU, komposisi, dan draw call di atas
> diturunkan langsung dari payload `/api/yard` dan jumlah kelompok mesh, jadi
> pasti. FPS harus diperiksa di mesin dan GPU kamu sendiri — panel kanan atas
> membaca `renderer.info` secara langsung.

## Enam keputusan yang membuatnya lancar

**1. `InstancedMesh`, dipecah per blok.**
Satu geometry + satu material + N matriks = satu draw call, mau 100 atau 100.000
kontainer. Dipecah per blok (bukan satu mesh raksasa) supaya blok di luar layar
ikut kena frustum culling. 30 blok x 2 ukuran = 60 draw call untuk seluruh
lapangan.
→ [YardContainers.tsx](src/components/three/YardContainers.tsx)

**2. Dua level detail, dengan anggaran blok — bukan sekadar ambang jarak.**
Dari ketinggian lapangan kontainer tidak bisa dibedakan dari kotak, jadi blok
yang jauh memakai geometri prosedural: `BoxGeometry` bersegmen rendah yang
vertex dindingnya digeser jadi corrugated (324 triangle), dan untuk tank sebuah
barel silinder di dalam rangka ISO (200 triangle). Blok terdekat memakai aset
GLB penuh — 8.379 triangle per GP, 78.630 per tank.

Ambang jarak saja tidak cukup, dan ini pelajaran yang mahal: blok panjangnya
256 m sementara barisnya cuma berjarak 43 m, jadi kamera setinggi 30 m di
tengah lapangan punya hampir seluruh 30 blok dalam radius 240 m — tepat 143
juta triangle yang mau dihindari. Yang mengunci biayanya adalah anggaran
**empat blok terdekat**, apa pun posisi kameranya, plus histeresis satu
peringkat supaya blok yang jaraknya nyaris sama tidak berkedip saat diorbit.

Anggaran itu harus disetel ulang tiap kali aset GP diganti, dan itu bagian yang
paling gampang terlupa: sempat dipakai aset GP 32.456 triangle, yang memaksa
angkanya turun ke dua blok.

Pertukarannya hanya membalik flag `visible` pada dua group yang matriks
instance-nya sama-sama sudah ditulis — bukan mengganti `geometry`, yang akan
memaksa `InstancedMesh` dibuat ulang dan seluruh buffer di-upload lagi persis
saat kamera sedang bergerak. Base color GLB-nya diubah jadi peta detail abu-abu
saat load supaya karat dan panelnya tetap terlihat sementara hue-nya tetap
ditentukan mode pewarnaan lewat `instanceColor`; normalisasinya dilakukan di
ruang linear, karena di ruang sRGB map yang tampak terang ternyata cuma 0,55
linear dan LOD dekat akan berkedip lebih gelap saat bertukar. Seluruhnya bisa
dimatikan lewat toggle "Model kontainer detail".
→ [geometry.ts](src/lib/geometry.ts),
[containerModel.ts](src/lib/containerModel.ts),
[lodRegistry.ts](src/components/three/lodRegistry.ts)

**2b. Aset berat diolah sekali, di luar browser.**
Tidak ada aset kontainer siap pakai yang cukup ringan untuk 12.000 instance,
jadi keduanya diolah lebih dulu oleh dua skrip di [scripts/](scripts/).

**Reefer — dipakai apa adanya.** Asetnya 3,6 KB dan cuma 144 triangle, jadi
tidak perlu diolah sama sekali. Yang perlu ditangani justru apa yang TIDAK ada
di dalamnya: tanpa material, tanpa UV, dan **tanpa atribut normal** — glTF
mewajibkan klien menghitung normal datar sendiri, dan GLTFLoader menanganinya
dengan menyalakan `flatShading` di material. Flag itu harus ikut disalin ke
material yang dibangun ulang; tanpa itu permukaannya hitam. Sumbunya juga
Z-up, beda dari dua aset lain yang memanjang pada Z, jadi rotasi orientasi
sekarang bagian dari spec tiap aset, bukan satu konstanta bersama.

Varian 40ft-nya tidak boleh dibuat dengan skala biasa: unit pendingin reefer
ukurannya sama di 20ft maupun 40ft, jadi meregangkan seluruh geometri akan
melebarkannya dua kali lipat. `rigidEnd` di spec menandai bagian ujung yang
digeser utuh; hanya badannya yang meregang (2,112x, bukan 2,012x).

**Truk — kepala GLB, chassis prosedural.** Asetnya cuma traktor Volvo FH16
tanpa chassis sama sekali: 783.090 triangle dan 33 MB. Dugaan pertama saya
salah — bukan interior kabin yang jadi beban, melainkan bodi luar (92% ada di
empat material: `plastick__dark`, `truck_paint_cab`, `cromiun`,
`plastick_gray`). Yang menahan penyederhanaan adalah vertex terpecah,
V/T = 0,95; setelah posisi yang sama digabung V/T jadi 0,54 dan sisanya
lancar. Kedua teksturnya dibuang karena cuma menutupi 8% triangle dan justru
itu yang menghalangi weld. **33 MB -> 0,72 MB, 33.418 triangle.**

Chassis-nya dibangun prosedural (456 triangle) pada KOORDINAT YANG SAMA dengan
traktor setelah diorientasi, jadi keduanya dipasang sebagai dua instanced mesh
dengan matriks identik dan selalu menyatu — tidak ada offset yang perlu
disimpan di mana pun. Angkanya diukur dari asetnya, bukan dikira-kira: rangka
traktor datar setinggi 1,11 m dari X -0,86 sampai +0,91, dan itu dudukan fifth
wheel. Dek chassis di 1,45 m menyisakan 8 cm di atas rangka, kontainer 40ft-nya
berjarak 0,20 m dari kabin, dan total rig 15,4 m.
→ [geometry.ts](src/lib/geometry.ts), [Equipment.tsx](src/components/three/Equipment.tsx)

**Tank — buang mesh kecilnya.** Aslinya 289.084 triangle, sebagian besar baut
dan gagang katup belasan sentimeter: satu mesh saja 22.842 triangle di dalam
kotak 11x14x7 cm, sementara barel tank yang sebenarnya (2,3 x 2,3 x 5,8 m)
cuma 6.160. Membuang tiap mesh berdiagonal di bawah 1 m menyisakan 78.630
triangle dengan siluet utuh. File-nya sekaligus dipadatkan per accessor —
aslinya 103 accessor menumpang tiga bufferView raksasa, jadi membuang mesh
saja tidak mengurangi satu byte pun — plus indeks diturunkan ke 16-bit.
9,74 MB -> 2,27 MB.

**GP — buang yang tidak pernah dibaca.** Aset GP-nya sendiri sudah ringan
(8.379 triangle), jadi geometrinya tidak disentuh sama sekali. Yang dibuang
cuma muatan mati: tekstur metallicRoughness dan occlusion (2,2 MB) yang tidak
pernah dibaca `MeshPhongMaterial`, plus atribut TANGENT dan dua set UV
cadangan yang toh dihapus lagi oleh renderer saat load. 7,9 MB -> 5,0 MB
dengan geometri dan UV persis sama.

`--weld=false` di situ WAJIB, dan ini jebakan yang mahal. Weld menggabungkan
vertex berposisi sama — padahal jahitan UV ada justru karena satu posisi punya
dua koordinat tekstur, dan weld cuma menyimpan salah satunya. Untuk aset ini
weld memampatkan 9.812 vertex jadi 5.994 tanpa mengubah jumlah triangle sedikit
pun, jadi tidak ada satu angka pun di ringkasan skrip yang terlihat aneh —
tapi teksturnya sudah robek di setiap jahitan.

```bash
node scripts/prune-glb.mjs tank_container.glb public/models/tank_container.glb   --min-diagonal=1.0 --length=6.06

node scripts/decimate-glb.mjs shipping_container.glb public/models/shipping_container.glb   --triangles=0 --weld=false --textures=baseColor,normal   --attributes=POSITION,NORMAL,TEXCOORD_0
```
→ [prune-glb.mjs](scripts/prune-glb.mjs),
[decimate-glb.mjs](scripts/decimate-glb.mjs),
[lib/glb.mjs](scripts/lib/glb.mjs)

**3. Buffer matriks dan buffer warna dipisah.**
Posisi kontainer ditulis **sekali** lalu ditandai `StaticDrawUsage`. Ganti mode
pewarnaan, filter, atau seleksi hanya menyentuh `instanceColor` — buffer yang
jauh lebih kecil. Karena itu memfilter 12.000 kontainer terasa instan.
→ [instances.ts](src/lib/instances.ts)

**4. `frameloop="demand"`.**
Ini aplikasi operasional, bukan game: layar diam sebagian besar waktu. Frame
hanya dirender saat ada yang berubah. Karena itu panel FPS menampilkan `idle`
ketika kamera tidak digerakkan — itu perilaku yang benar, bukan bug.
→ [YardScene.tsx](src/components/YardScene.tsx)

**5. Picking manual, hanya saat klik.**
Begitu sebuah objek punya event handler R3F, R3F ikut me-raycast objek itu pada
**setiap** `pointermove` untuk mengurus hover — dan `InstancedMesh.raycast`
menguji seluruh instance satu per satu. Menggerakkan mouse saja sudah cukup
membuat patah. Jadi raycast dilakukan sendiri, sekali, pada `pointerup`.
→ [Picking.tsx](src/components/three/Picking.tsx),
[pickRegistry.ts](src/components/three/pickRegistry.ts)

**6. Label dibatasi keras.**
Membuat label untuk semua kontainer adalah cara tercepat membunuh halaman ini —
20.000 elemen DOM jauh lebih berat daripada 20.000 kotak di GPU. Nomor kontainer
hanya muncul saat kamera dalam radius 85 m, maksimal 24 buah. Nomor blok memakai
trik lain: semua teks dilukis ke satu atlas canvas dan seluruh quad-nya digabung
jadi satu geometry — 1 draw call untuk 30 label.
→ [NearbyLabels.tsx](src/components/three/NearbyLabels.tsx),
[BlockLabels.tsx](src/components/three/BlockLabels.tsx)

Tambahan kecil yang ikut menentukan: `dpr` dibatasi `[1, 1.5]`, hanya dua lampu
(tiang lampu di lapangan murni geometri, bukan light), bayangan mati secara
default, dan seluruh alat berat (RTG, truk, tiang) digabung jadi satu geometry
lalu di-instance — 1 draw call per jenis, bukan ratusan. RTG-nya 632 triangle
per unit dan butuh dua draw call, bukan satu: spreader oranye harus jadi mesh
sendiri karena satu `InstancedMesh` cuma bisa punya satu material.

## Isi proyek

```
src/
  app/
    api/yard/route.ts     sumber data — titik sambung ke TOS
    page.tsx              scene + HUD
  components/
    YardScene.tsx         Canvas R3F, setelan renderer
    SceneLoader.tsx       dynamic import (WebGL tidak boleh SSR)
    three/
      YardContainers.tsx  <- inti: InstancedMesh per blok
      Ground.tsx          aspal + marka slot (instanced)
      Equipment.tsx       RTG + spreader, truk, tiang lampu (merged + instanced)
      BlockLabels.tsx     atlas teks: kode blok + nomor slot & row, 1 draw call
      NearbyLabels.tsx    LOD label nomor kontainer
      lodRegistry.ts      anggaran + pergantian LOD per blok
      Picking.tsx         raycast manual saat klik
      Selection.tsx       kotak sorot + tiang penanda
      CameraRig.tsx       OrbitControls + animasi terbang ke kontainer
      PerfProbe.tsx       pembaca renderer.info
    hud/                  panel statistik, filter, pencarian, detail
  lib/
    constants.ts          dimensi lapangan (semua dalam meter)
    yard.ts               rumus tata letak blok/bay/row/tier + generator
    geometry.ts           geometri kontainer (LOD jauh), RTG, truk, tekstur marka
    containerModel.ts     pembaca aset GLB kontainer & tank (LOD dekat)
    depot.ts              koneksi Oracle + pemetaan ke YardData
    instances.ts          penulis buffer matriks & warna
    iso6346.ts            check digit nomor kontainer
    palette.ts            warna per line / status / ukuran / tier
  store/useYard.ts        state global (zustand)
scripts/
  lib/glb.mjs             baca/tulis GLB, dipakai kedua skrip di bawah
  prune-glb.mjs           buang mesh kecil dari GLB
  decimate-glb.mjs        sederhanakan mesh + kecilkan tekstur
public/models/
  shipping_container.glb  aset GP hasil olahan, 5,0 MB, dimuat lazy
  reefer_container.glb    aset reefer, 0,3 MB
  truck_tractor.glb       kepala traktor hasil olahan, 0,7 MB
  tank_container.glb      aset tank hasil olahan, 2,3 MB
```

Kedua skrip dijalankan manual saat aset diganti, bukan bagian dari `npm run
build` — hasilnya di-commit apa adanya.

## Tata letak lapangan

Semua ukuran dalam meter, 1 unit three.js = 1 meter. Rumus posisi ada di satu
tempat saja — `containerPosition()` di [yard.ts](src/lib/yard.ts) — dipakai
bersama oleh renderer, penanda seleksi, dan kamera.

- 30 blok (3 kolom x 10 baris), lapangan 816 x 408 m
- Per blok: 40 slot TEU x 6 row x 5 tier
- Lorong 26 m antar baris blok berisi lajur layanan truk di bawah kantilever
  RTG, dua rel RTG, dan jalan dua arah — semuanya satu tekstur yang di-repeat
- Nomor slot dicat di lajur layanan sisi +Z blok — pita selebar 4,2 m, sisi
  yang dilihat sopir truk saat mengantre. Penomorannya ganjil 1, 3, 5, …
  mengikuti konvensi ISO sekaligus `YARD_SLOT` di database
- Portal RTG bersih dari tanah sampai girder: apa pun yang membentang di atas
  blok pada ketinggian sedang akan menembus tumpukan tier 5 (puncaknya 13,07 m),
  dan spreader digantung di 14,6 m supaya tetap bebas di bay mana pun
- Kontainer 20ft menempati 1 slot, 40ft menempati 2 slot berurutan
- ISO tank hanya ada dalam 20ft dan tidak ditumpuk lebih dari 3 tinggi
- Satu tumpukan selalu berisi kontainer berukuran sama, seperti di lapangan asli
- Nomor kontainer memakai check digit ISO 6346 yang valid

Ubah `YARD` di [constants.ts](src/lib/constants.ts) untuk menyesuaikan bentuk
lapangan dengan terminal yang sebenarnya.

### Mengunci slot

Di editor ("Sunting lapangan"), kontainer disembunyikan dan tiap blok digambar
sebagai kisi sel slot × row × tier — yang terlihat wadahnya, bukan isinya. Sel
abu-abu berarti sudah berisi kontainer. Tombol **Kunci slot** (di palet bawah
atau panel kanan) lalu mengubah klik pada sel menjadi kunci:

- klik sel bebas → slot itu dikunci **dari tier tersebut sampai tier teratas**
  (tumpukan tidak bisa melompati lubang, jadi mengunci slot 1 tier 1 berarti
  seluruh kolom slot 1 tertutup);
- klik sel merah → seluruh kolomnya dibuka lagi;
- "buka semua" di panel membuka satu blok sekaligus.

Di lapangan **database**, mengunci = **menghapus baris YARD_ROWTIER** sel itu
sampai tier teratas, dan membuka = **menyisipkannya kembali** (SITE_ID, STATUS,
PCH disalin dari baris tetangga; ID baru dari `SEQ_ID`). Menu stack/unstack
TOS memilih tempat dari tabel itu, jadi slot yang barisnya hilang tidak bisa
ditumpuki — tanpa perubahan apa pun di TOS. Hanya baris kosong yang dihapus:
kunci ditolak kalau di tier itu atau di atasnya masih ada kontainer, termasuk
40ft dari slot sebelahnya. Sebaliknya, aplikasi ini membaca kunci dari baris
yang hilang, jadi baris yang dihapus lewat jalur lain juga tampil terkunci.
Endpointnya `POST /api/yard/slots`, lewat saklar `DEPOT_DB_WRITE`. Di lapangan
**demo**, yang tidak punya tabel, kunci disimpan di YARD_LAYOUT.

Animasi truk ikut menghormatinya: bongkar (receiving) yang tujuannya slot
terkunci ditolak sebelum truk berangkat, dengan alasannya di panel lalu lintas.

Slot terkunci dikeluarkan dari kapasitas: okupansi
di bar atas, papan kapasitas tiap blok (🔒 n), dan "sisa box" ikut turun. Di
luar editor sel terkunci tetap tampak sebagai kotak merah redup. Logikanya di
[slots.ts](src/lib/slots.ts) dan diuji di `tests/slots.test.ts`.

### Mengubah ukuran blok

Mengetik slot/row/tier di panel properti hanya mengubah tampilan. Begitu
angkanya berbeda dari database, dua tombol muncul di bawahnya:

- **Geser yang terdampak** — blok tumbuh dari sudut asalnya (+slot ke ujung,
  +row ke sisi), jadi semua jalan, alat, dan blok lain yang pusatnya berada di
  luar tepi lama pada arah itu didorong sejauh pertumbuhannya. Yang bergeser
  tetap saling tersambung karena bergeser bersama; jalan sejajar yang
  melintasi tepi lama disambung dengan ubin lurus sepanjang celahnya. Tidak
  dilakukan otomatis — labelnya menyebut berapa jalan/alat/blok yang akan
  pindah — karena blok lain yang bergeser posisinya tersimpan ke
  CORE_YARD_BLOCK. Logikanya di [shift.ts](src/lib/shift.ts).
- **Simpan ukuran ke database** — CORE_YARD_BLOCK diperbarui, baris
  YARD_ROWTIER di luar ukuran baru dihapus (hanya yang kosong; mengecilkan
  ditolak kalau ada kontainer di luar ukuran baru), dan baris untuk daerah
  baru disisipkan. Slot yang sedang dikunci tidak ikut terbuka. Endpointnya
  `POST /api/yard/block/resize`.

Urutan yang disarankan: ubah angka → geser terdampak → simpan ukuran.

### Pemeriksaan tata letak

Bagian **Pemeriksaan** di panel editor mendaftar yang perlu dibetulkan: blok
bertindihan, ubin jalan tertimpa blok, alat di dalam blok, gate yang tidak
menempel jalan, belum ada gate masuk/keluar, dan blok yang tidak tersambung
jalan ke gate. Klik satu baris untuk menerbangkan kamera ke lokasinya. Aturannya
di [validate.ts](src/lib/validate.ts), diuji di `tests/validate.test.ts`.

## Cara pakai

- Drag = orbit, scroll = zoom, klik kanan drag = geser
- Klik kontainer untuk melihat detailnya
- Ketik nomor kontainer di kotak pencarian, tekan Enter — kamera terbang ke sana
- Panel kiri: mode pewarnaan, filter shipping line / status / ukuran, kepadatan
  lapangan, dan opsi tampilan

## Aliran langsung: gate in → ditangani → gate out

Truk gate dianimasikan dari KEJADIAN, bukan dari posisi yang dilacak: masuk
lewat gerbang, menunggu di dalam gerbang sampai slotnya diketahui, menepi di
lajur layanan bay tujuannya, dilayani RTG (portal berjalan, spreader turun,
kontainer berpindah), lalu keluar lewat gerbang. Tumpukan ditambal setempat
pada saat spreader mengangkat/melepas kontainer — tanpa memuat ulang lapangan.

Jaringan jalannya dibangun ulang dari tata letak setiap kali tata letak berubah
([src/lib/roadGraph.ts](src/lib/roadGraph.ts)); tambah jalan atau blok baru,
truk berikutnya langsung memakainya.

Tiga sumber kejadian masuk lewat SATU pintu (`useTraffic.ingest`):

| sumber | cara |
|---|---|
| HiveMQ | server berlangganan `MQTT_TOPIC` di `MQTT_URL` (lihat `.env.example`); kredensial tetap di server |
| HTTP | `POST /api/yard/events` — satu objek atau daftar; header `x-events-secret` kalau `EVENTS_SECRET` diisi |
| pemutar ulang | tombol **Putar ulang** di HUD memutar `GATE_HIST` terakhir sebagai aliran tiruan |

Peramban menerima semuanya lewat SSE `GET /api/yard/events`, dan saat tersambung
menarik dulu perjalanan yang sudah gate in tapi belum gate out (`/api/yard/trips?open=1`).

Bentuk pesan yang diterima ([src/lib/liveEvents.ts](src/lib/liveEvents.ts)) —
satu baris `GATE_HIST` apa adanya sudah cukup; jenis kejadiannya diturunkan
dari kolom waktu yang terisi paling akhir:

```json
{ "JOB_NO": "26003277", "CTR_NO": "PASK3928749", "TRUCK_NO": "BK0394KK",
  "RECEIV_DELIV": "R", "GATI_NO": 1, "GATI_DT": "2026-10-08T22:47:00Z",
  "STACK_ON_YARD": null, "GATO_DT": null }
```

atau bentuk ringkas `{ "event": "GATE_IN" | "HANDLED" | "GATE_OUT", "ctrNo", "truckNo", "jobNo", "flow": "R"|"D", "gateNo" }`.
Kalau pesan tidak membawa posisi, peramban bertanya `GET /api/yard/container?no=…`
saat kejadian "ditangani" datang.

Uji cepat tanpa broker:

```bash
curl -X POST localhost:3000/api/yard/events -H "Content-Type: application/json" \
  -d '{"event":"GATE_IN","jobNo":"UJI1","ctrNo":"RCLU1231243","truckNo":"B 1 UJI","flow":"D","gateNo":1}'
```

Panel kanan HUD menampilkan status koneksi, kartu truk yang diklik (dengan
kamera pengikut dan jejak rute), indikator KPI (`GET /api/yard/kpi`), dan
minimap. Uji otomatis untuk graf jalan, penjepret jalan, dan penormal pesan:
`npm test`.

## Menyambung ke data TOS

Ganti isi handler di [src/app/api/yard/route.ts](src/app/api/yard/route.ts).
Selama bentuk `YardData` tetap sama, tidak ada komponen 3D yang perlu diubah:

```ts
const rows = await query(`
  SELECT container_no, iso_size, status, line_code,
         block_code, bay_no, row_no, tier_no, gross_weight, vessel, in_date
    FROM yard_inventory
   WHERE terminal = :terminal AND status <> 'GATE_OUT'
`, { terminal });

return NextResponse.json(toYardData(rows));
```

Untuk Oracle, tambahkan `oracledb` lalu daftarkan di `next.config.mjs`:
`serverExternalPackages: ['oracledb']` — polanya sama seperti proyek `Dermaga_3D`.

## Yang perlu diperhatikan sebelum dipakai produksi

- **Ukuran payload.** 19.000 kontainer sebagai JSON sekitar 3 MB (±600 KB setelah
  gzip). Kalau jaringan terminal terasa lambat, kirim kolumnar (array paralel per
  field) atau `ArrayBuffer`, bukan array of object. Ini bottleneck jaringan, bukan
  bottleneck render — jangan salah obat.
- **Bayangan.** Satu shadow map untuk lapangan seluas 816 x 408 m menghasilkan
  bayangan kasar dan mahal, jadi default-nya mati. Kalau memang dibutuhkan, pakai
  cascaded shadow map atau batasi shadow camera ke area sekitar kamera.
- **Pembaruan realtime.** Struktur saat ini menulis matriks sekali. Untuk yard
  yang berubah live, jangan tulis ulang seluruh buffer — perbarui hanya instance
  yang berpindah lalu set `instanceMatrix.needsUpdate`. Pemecahan per blok yang
  sudah ada membuat upload ulang terbatas pada blok yang berubah saja.
- Data lapangan masih dibangkitkan, belum data asli.
