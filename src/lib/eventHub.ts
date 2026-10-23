import mqtt, { type MqttClient } from 'mqtt';
import { normalizeEvent, type LiveEvent } from './liveEvents';

/**
 * Hub kejadian di SERVER: satu tempat semua kejadian masuk, lalu disiarkan ke
 * setiap peramban yang sedang terhubung lewat SSE (/api/yard/events).
 *
 * Dua sumber mengisi hub ini, dan peramban tidak perlu tahu mana yang bicara:
 *
 *   - HiveMQ: server berlangganan satu topik (MQTT_URL + MQTT_TOPIC di .env).
 *     Satu koneksi ke broker berapa pun penontonnya, dan kredensial broker
 *     tetap di server — tidak pernah terkirim ke peramban.
 *   - HTTP: POST /api/yard/events, untuk aplikasi lain (webaccess) atau untuk
 *     menguji tanpa broker.
 *
 * Disimpan di globalThis, bukan module scope: Next.js dev me-reload modul tiap
 * berkas berubah, dan tanpa ini tiap reload membuka koneksi broker baru sambil
 * melupakan yang lama.
 */

type Listener = (e: LiveEvent) => void;

export type HubStatus = {
  mqtt: 'off' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  mqttUrl: string | null;
  topic: string | null;
  listeners: number;
  received: number;
  lastAt: string | null;
  lastError: string | null;
};

type Hub = {
  listeners: Set<Listener>;
  client: MqttClient | null;
  status: HubStatus;
  /** Beberapa kejadian terakhir, untuk peramban yang baru terhubung. */
  recent: LiveEvent[];
};

const g = globalThis as unknown as { yardEventHub?: Hub };

function hub(): Hub {
  if (!g.yardEventHub) {
    g.yardEventHub = {
      listeners: new Set(),
      client: null,
      status: {
        mqtt: 'off',
        mqttUrl: null,
        topic: null,
        listeners: 0,
        received: 0,
        lastAt: null,
        lastError: null,
      },
      recent: [],
    };
  }
  return g.yardEventHub;
}

const RECENT_MAX = 50;

/** Menyiarkan satu kejadian ke semua peramban yang terhubung. */
export function publish(e: LiveEvent) {
  const h = hub();
  h.status.received++;
  h.status.lastAt = new Date().toISOString();
  h.recent.push(e);
  if (h.recent.length > RECENT_MAX) h.recent.splice(0, h.recent.length - RECENT_MAX);
  for (const l of h.listeners) {
    try {
      l(e);
    } catch {
      // Satu peramban yang koneksinya sudah mati tidak boleh menghentikan
      // siaran ke yang lain.
    }
  }
}

export function subscribe(l: Listener) {
  const h = hub();
  h.listeners.add(l);
  h.status.listeners = h.listeners.size;
  ensureMqtt();
  return () => {
    h.listeners.delete(l);
    h.status.listeners = h.listeners.size;
  };
}

export const hubStatus = (): HubStatus => ({ ...hub().status });
export const recentEvents = (): LiveEvent[] => [...hub().recent];

/**
 * Menyambung ke broker HiveMQ saat pertama kali ada yang mendengarkan — bukan
 * saat modul dimuat. Tanpa MQTT_URL hub tetap hidup untuk kiriman HTTP saja.
 *
 * Variabel .env:
 *   MQTT_URL       mis. mqtts://xxxx.s1.eu.hivemq.cloud:8883 atau mqtt://host:1883
 *   MQTT_TOPIC     mis. depot/gate/#        (default: yard/gate/#)
 *   MQTT_USERNAME, MQTT_PASSWORD           (opsional)
 *   MQTT_CLIENT_ID                          (opsional; default yard3d-<acak>)
 */
function ensureMqtt() {
  const h = hub();
  if (h.client) return;
  const url = process.env.MQTT_URL;
  if (!url) return;
  const topic = process.env.MQTT_TOPIC || 'yard/gate/#';

  h.status.mqtt = 'connecting';
  h.status.mqttUrl = url.replace(/\/\/[^@]*@/, '//***@');
  h.status.topic = topic;

  const client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: process.env.MQTT_CLIENT_ID || `yard3d-${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    reconnectPeriod: 3000,
    connectTimeout: 10_000,
  });
  h.client = client;

  client.on('connect', () => {
    h.status.mqtt = 'connected';
    h.status.lastError = null;
    client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        h.status.mqtt = 'error';
        h.status.lastError = `subscribe ${topic}: ${err.message}`;
      }
    });
  });
  client.on('reconnect', () => {
    h.status.mqtt = 'reconnecting';
  });
  client.on('error', (err) => {
    h.status.mqtt = 'error';
    h.status.lastError = err.message;
  });
  client.on('close', () => {
    if (h.status.mqtt === 'connected') h.status.mqtt = 'reconnecting';
  });
  client.on('message', (_t, payload) => {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString('utf8'));
    } catch {
      h.status.lastError = 'pesan bukan JSON';
      return;
    }
    // Satu pesan boleh berisi satu kejadian atau sekumpulan kejadian.
    const items = Array.isArray(raw) ? raw : [raw];
    for (const it of items) {
      const e = normalizeEvent(it);
      if (e) publish(e);
      else h.status.lastError = 'pesan tanpa nomor kontainer diabaikan';
    }
  });
}
