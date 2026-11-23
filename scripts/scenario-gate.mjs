/**
 * Skenario lalu lintas gate lengkap untuk demo / uji:
 *
 *   Truk A — BONGKAR (R): gate in (bermuatan) → RTG STACK kontainernya ke slot
 *            kosong di tumpukan → gate out (kosong).
 *   Truk B — MUAT (D):    gate in (kosong) → RTG UNSTACK kontainer dari
 *            tumpukan ke truk → gate out (bermuatan).
 *
 * Kontainer dan slot dipilih otomatis dari lapangan yang sedang tampil
 * (GET /api/yard): B mengambil kontainer di PUNCAK tumpukan, A menaruh di
 * atas tumpukan yang belum penuh dan tidak terkunci. Nomor kontainer A dibuat
 * baru dengan check digit ISO 6346 yang sah.
 *
 * Kejadian dikirim berurutan dengan jeda pendek. Aplikasi sendiri yang
 * menahan urutannya: RTG baru bekerja setelah truk berhenti di bay, dan truk
 * baru keluar setelah RTG selesai DAN gate out tercatat.
 *
 * Database TIDAK diubah: tumpukan berubah di tampilan saja dan kembali saat
 * data lapangan dimuat ulang.
 *
 * Pemakaian:
 *   node scripts/scenario-gate.mjs                 # ke hub lokal (POST /api/yard/events)
 *   node scripts/scenario-gate.mjs --block A
 *   node scripts/scenario-gate.mjs --via mqtt      # ke broker MQTT_URL/MQTT_TOPIC di .env
 *   node scripts/scenario-gate.mjs --base http://host:3000 --gap 4
 */
import fs from 'node:fs';
import tls from 'node:tls';
import { createRequire } from 'node:module';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const BASE = arg('base', 'http://localhost:3000');
const BLOCK = (arg('block', 'C') ?? 'C').toUpperCase();
const VIA = arg('via', 'http');
const GAP = Number(arg('gap', '3')) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- ISO 6346 ---------------------------------------------------------------
const VAL = {};
for (let v = 10, i = 0; i < 26; i++, v++) {
  if (v % 11 === 0) v++;
  VAL[String.fromCharCode(65 + i)] = v;
}
const checkDigit = (s10) => {
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (/[0-9]/.test(s10[i]) ? +s10[i] : VAL[s10[i]]) * 2 ** i;
  return (sum % 11) % 10;
};

// --- lapangan ----------------------------------------------------------------
const yard = await (await fetch(`${BASE}/api/yard`, { cache: 'no-store' })).json();
const block = yard.blocks?.find((b) => b.id === BLOCK);
if (!block) throw new Error(`blok ${BLOCK} tidak ada di /api/yard`);
const all = new Set(yard.blocks.flatMap((b) => b.containers.map((c) => c.no.trim().toUpperCase())));

// Tinggi tiap tumpukan (bay,row), 40ft menempati dua bay.
const height = new Map();
const key = (bay, row) => `${bay}|${row}`;
for (const c of block.containers) {
  for (let s = 0; s < (c.size === 40 ? 2 : 1); s++) {
    const k = key(c.bay + s, c.row);
    height.set(k, Math.max(height.get(k) ?? 0, c.tier));
  }
}
const blocked = new Set((block.blocked ?? []).map((x) => `${x.bay}|${x.row}|${x.tier}`));
// Bay di tengah blok: truk butuh ruang menepi lurus di lajur layanan.
const inner = (bay) => bay >= 3 && bay <= block.slots - 4;
// Row terdekat ke lajur truk lebih dulu (lajur L = sisi row terbesar).
const rowOrder = [...Array(block.rows).keys()].sort((a, b) => (block.truckLane === 'R' ? a - b : b - a));

// B: kontainer 20ft GP di puncak tumpukan.
let pickB = null;
for (const row of rowOrder) {
  pickB = block.containers.find(
    (c) => c.row === row && c.size === 20 && c.type !== 'tank' && inner(c.bay) && height.get(key(c.bay, c.row)) === c.tier,
  );
  if (pickB) break;
}
if (!pickB) throw new Error(`blok ${BLOCK}: tidak ada kontainer 20ft di puncak tumpukan`);

// A: slot kosong di atas tumpukan yang belum penuh, jauh dari bay B (RTG bergeser).
let slotA = null;
for (const row of rowOrder) {
  for (let bay = block.slots - 4; bay >= 3 && !slotA; bay--) {
    if (Math.abs(bay - pickB.bay) < 3) continue;
    const h = height.get(key(bay, row)) ?? 0;
    const tier = h + 1;
    if (tier > Math.min(block.tiers, 4) || blocked.has(`${bay}|${row}|${tier}`)) continue;
    slotA = { bay, row, tier };
  }
  if (slotA) break;
}
if (!slotA) throw new Error(`blok ${BLOCK}: tidak ada slot kosong untuk stack`);

let noA;
do {
  const s10 = 'MSKU' + String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  noA = s10 + checkDigit(s10);
} while (all.has(noA));

const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const A = {
  jobNo: `SCN-${stamp}-A`, ctrNo: noA, truckNo: 'L 1001 SC', flow: 'R', gateNo: 1,
  block: BLOCK, slot: slotA.bay * 2 + 1, row: slotA.row + 1, tier: slotA.tier, note: 'skenario yard_3d',
};
const B = {
  jobNo: `SCN-${stamp}-B`, ctrNo: pickB.no, truckNo: 'L 1002 SC', flow: 'D', gateNo: 1,
  block: BLOCK, slot: pickB.bay * 2 + 1, row: pickB.row + 1, tier: pickB.tier, note: 'skenario yard_3d',
};
console.log(`Truk A (bongkar/stack)  ${A.truckNo}  ${A.ctrNo} → ${BLOCK} bay ${slotA.bay + 1} row ${A.row} tier ${A.tier}`);
console.log(`Truk B (muat/unstack)   ${B.truckNo}  ${B.ctrNo} ← ${BLOCK} bay ${pickB.bay + 1} row ${B.row} tier ${B.tier}`);

// --- pengirim -----------------------------------------------------------------
let send;
let close = () => {};
if (VIA === 'mqtt') {
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
  const mqtt = createRequire(process.cwd() + '/package.json')('mqtt');
  const caFile = process.env.MQTT_CA_FILE;
  const client = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: 'yard3d-scenario-' + Math.random().toString(16).slice(2, 8),
    ...(caFile ? { ca: [...tls.rootCertificates, fs.readFileSync(caFile, 'utf8')] } : {}),
    clean: true,
    reconnectPeriod: 0,
  });
  await new Promise((r, j) => {
    client.on('connect', r);
    client.on('error', j);
  });
  const topic = process.env.MQTT_TOPIC || 'yard/gate/#';
  send = (msg) =>
    new Promise((r, j) => client.publish(topic, JSON.stringify(msg), { qos: 1, retain: false }, (e) => (e ? j(e) : r())));
  close = () => client.end(true);
} else {
  send = async (msg) => {
    const res = await fetch(`${BASE}/api/yard/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.EVENTS_SECRET ? { 'x-events-secret': process.env.EVENTS_SECRET } : {}) },
      body: JSON.stringify(msg),
    });
    if (!res.ok) throw new Error(`POST ${res.status}: ${await res.text()}`);
  };
}

const steps = [
  ['GATE_IN', A, 'gateInAt'],
  ['GATE_IN', B, 'gateInAt'],
  ['HANDLED', A, 'handledAt'],
  ['HANDLED', B, 'handledAt'],
  ['GATE_OUT', A, 'gateOutAt'],
  ['GATE_OUT', B, 'gateOutAt'],
];
for (const [event, base, at] of steps) {
  await send({ ...base, event, [at]: new Date().toISOString() });
  console.log(`${new Date().toISOString().slice(11, 19)}  ${event.padEnd(8)} ${base.truckNo}  ${base.ctrNo}`);
  await sleep(GAP);
}
close();
console.log(`Terkirim via ${VIA}. Truk keluar setelah RTG selesai — lihat di lapangan blok ${BLOCK}.`);
