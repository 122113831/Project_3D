/** Ukuran kontainer dalam kaki. 40ft menempati dua slot TEU. */
export type ContainerSize = 20 | 40;

/**
 * Jenis kontainer. Berbeda dari status: sebuah tank bisa isi, kosong, atau
 * berisi muatan berbahaya — sama seperti box biasa.
 *
 * ISO tank hanya dibuat dalam ukuran 20ft, jadi generator tidak pernah
 * mengeluarkan tank 40ft.
 */
export type ContainerType = 'gp' | 'tank';

/**
 * Pilihan pada filter "Jenis".
 *
 * Lebih luas daripada ContainerType, dan memang harus. ContainerType adalah
 * BENTUK yang digambar — kotak atau tangki — sedangkan reefer adalah kotak yang
 * kebetulan berpendingin. Reefer tetap perlu bisa disaring sebagai jenis,
 * karena begitulah orang lapangan menyebutnya.
 */
export type TypeFilter = ContainerType | 'reefer';

export type ContainerStatus =
  | 'full'
  | 'empty'
  | 'reefer'
  | 'dangerous'
  | 'damaged';

export type YardContainer = {
  /** Nomor kontainer ISO 6346, mis. MSCU1234567 */
  no: string;
  size: ContainerSize;
  type: ContainerType;
  status: ContainerStatus;
  /** Kode shipping line */
  line: string;
  /** Kode blok, mis. A01 */
  block: string;
  /** Indeks slot TEU dalam blok (0-based). 40ft menempati bay dan bay+1. */
  bay: number;
  /** Indeks row dalam blok (0-based) */
  row: number;
  /** Tier, 1 = paling bawah */
  tier: number;
  weightKg: number;
  vessel: string;
  /** Tanggal masuk lapangan (ISO date) */
  inDate: string;
  /**
   * Isi atau kosong menurut CONTAINER.CTR_STATUS ('F' / 'E'), apa adanya.
   *
   * Terpisah dari `status` karena keduanya menjawab pertanyaan yang berbeda.
   * `status` adalah kategori turunan untuk mewarnai dan menyaring lapangan, dan
   * urutannya menang-mengalahkan: kontainer reefer yang kosong berkategori
   * 'reefer', sehingga fakta bahwa ia kosong hilang. Panel detail menampilkan
   * apa yang tercatat di tabel, bukan hasil penurunannya.
   */
  filled: boolean;
  /**
   * Rusak menurut CONTAINER.IS_DAMAGE ('Y' / 'N'), apa adanya.
   *
   * Sama alasannya dengan `filled`: kategori turunan `status` hanya menyimpan
   * SATU sifat, dan yang lebih genting menang. Kontainer rusak yang juga
   * berbahaya berkategori 'dangerous', jadi kerusakannya tidak terbaca di mana
   * pun tanpa field ini. Di database dev: 109 rusak dari 940.
   */
  damaged: boolean;
  /** Berpendingin, dari CTR_TYPE (RE/RF/RH/RT) atau digit ketiga ISO_CODE. */
  reefer: boolean;
  /** Barang berbahaya, dari DG atau IMO_CD yang terisi. */
  dangerous: boolean;
  /**
   * CONTAINER.CTR_TYPE apa adanya — GP, HC, OT, RF, TK, …
   *
   * Berbeda dari `type`, yang cuma 'gp' | 'tank'. Yang terakhir itu BENTUK
   * untuk menggambar: lapangan ini punya dua model, kotak dan tangki, jadi
   * apa pun yang bukan tangki digambar sebagai kotak. Tanpa kode aslinya, HC,
   * OT, dan RF semuanya tampil "GP (box)" di panel — dan itu keliru sebagai
   * informasi, walau benar sebagai bentuk.
   */
  typeCode: string;
  /** CONTAINER.ISO_CODE apa adanya (22G1, 42R1, 22U1, …). */
  isoCode: string;
};

/**
 * Sisi kiri/kanan sebuah blok, apa adanya dari CORE_YARD_BLOCK.
 *
 * TRUCK_LANE menentukan di sisi mana lajur layanan truk berada, SLOT_START dari
 * ujung mana penomoran slot dimulai. Keduanya CHAR(1) berisi 'L' atau 'R'.
 *
 * Pemetaan ke sumbu dunia dipilih supaya 'L' menghasilkan gambar yang PERSIS
 * sama dengan sebelum kolom ini dipakai — ketiga blok di database bernilai 'L',
 * jadi tidak ada satu pun yang bergeser. 'R' membalik ke sisi seberangnya.
 */
export type BlockSide = 'L' | 'R';

/**
 * Dasar sebuah kolom slot yang DIKUNCI: sel (bay, row, tier) ini dan semua
 * tier di atasnya tidak boleh ditumpuki.
 *
 * Hanya dasarnya yang disimpan. Tumpukan tidak bisa melompati lubang, jadi
 * "terkunci dari tier 3 ke atas" sudah lengkap dengan satu angka; tier 4 dan 5
 * tidak perlu dicatat sendiri-sendiri.
 */
export type BlockedCell = { bay: number; row: number; tier: number };

export type YardBlock = {
  id: string;
  /** Sudut blok (slot 0, row 0) dalam koordinat dunia, satuan meter */
  originX: number;
  originZ: number;
  /** Panjang blok dalam indeks TEU. */
  slots: number;
  /**
   * Kenaikan nomor slot tiap satu posisi.
   *
   * 1 pada data demo: slot bernomor 1, 2, 3, …
   * 2 pada data depot: YARD_SLOT-nya ganjil semua — 1, 3, 5, … — karena nomor
   * genap disediakan untuk posisi 40ft yang membentang di antara dua yang
   * ganjil, konvensi bay ISO. Posisinya sendiri tetap berurutan dan selebar
   * 20ft; yang beda cuma penomorannya.
   *
   * Dipakai HANYA untuk menulis nomor. Ukuran petak marka selalu satu posisi.
   */
  slotStep: number;
  rows: number;
  tiers: number;
  /** Sudut putar blok terhadap pusatnya, radian. */
  rot: number;
  /** CORE_YARD_BLOCK.TRUCK_LANE — sisi lajur layanan truk. */
  truckLane: BlockSide;
  /** CORE_YARD_BLOCK.SLOT_START — ujung tempat penomoran slot dimulai. */
  slotStart: BlockSide;
  containers: YardContainer[];
  /** Kolom slot yang dikunci editor; dari YARD_LAYOUT, bukan dari database TOS. */
  blocked?: BlockedCell[];
  /**
   * Blok membawa jalan dua arah di lorong sampingnya sendiri. false = jalan
   * berdiri sendiri (ubin jalan), blok hanya punya lajur layanan. Kosong = true.
   */
  ownRoad?: boolean;
  /** Blok khusus reefer: punya rak listrik (reefer rack) di sisi panjangnya. */
  reefer?: boolean;
};

/** Shipping line yang benar-benar ada di data, bukan daftar tetap. */
export type YardLine = { code: string; name: string };

/** Dari mana isi lapangan berasal. */
/** Sumber lapangan: hanya database depot (sumber demo bangkitan sudah dihapus). */
export type YardSource = 'depot';

export type YardData = {
  blocks: YardBlock[];
  meta: {
    generatedAt: string;
    fill: number;
    totalContainers: number;
    totalTeu: number;
    capacityTeu: number;
    /** Luas lapangan dalam meter */
    extentX: number;
    extentZ: number;
    source: YardSource;
    /** Kontainer yang dibuang karena tidak muat di blok hasil suntingan editor. */
    droppedByLayout?: number;
    /** Kontainer yang dibuang karena posisinya bertindihan dengan kontainer lain. */
    conflicts?: number;
    /** Nomor kontainer yang dipakai lebih dari satu baris CONTAINER. */
    duplicateNumbers?: number;
    /**
     * Transform peta<->dunia lapangan ini, atau null kalau skalanya masih
     * diturunkan dari jarak antar blok (lihat DEPOT_MAP_SCALE). Kalau null,
     * posisi blok TIDAK bisa disimpan: nilainya tidak akan bulat kembali.
     */
    mapTransform?: { scale: number } | null;
    /**
     * Titik tengah lapangan di koordinat dunia. Bukan selalu (0,0): lapangan
     * dari database duduk di koordinat peta yang sebenarnya supaya posisinya
     * absolut. Kamera, aspal, dan grid editor membingkai diri ke sini.
     */
    centerX?: number;
    centerZ?: number;
    /**
     * Daftar line diturunkan dari isi lapangan, bukan konstanta: data depot
     * memakai kode agen sendiri (RCL, MSC, HDK) yang tidak ada di LINES.
     */
    lines: YardLine[];
  };
};

/**
 * Dasar pewarnaan kontainer. 'none' berarti tidak diwarnai menurut apa pun —
 * semua kontainer memakai satu warna netral.
 */
export type ColorMode = 'none' | 'line' | 'status' | 'size' | 'tier';

export type YardFilter = {
  lines: string[];
  statuses: ContainerStatus[];
  sizes: ContainerSize[];
  types: TypeFilter[];
};
