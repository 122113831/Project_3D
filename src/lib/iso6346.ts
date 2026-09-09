/**
 * Check digit ISO 6346 — supaya nomor kontainer dummy tetap valid saat
 * diuji dengan validator asli.
 *
 * Nilai huruf melompati kelipatan 11: A=10, B=12, ..., K=21, L=23, ...
 */
const LETTER_VALUE: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let v = 10;
  for (let i = 0; i < 26; i++) {
    if (v % 11 === 0) v++;
    map[String.fromCharCode(65 + i)] = v;
    v++;
  }
  return map;
})();

/** `prefix` = 4 huruf (owner code + kategori U), `serial` = 6 digit. */
export function checkDigit(prefix: string, serial: string): number {
  const code = prefix + serial;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = code[i];
    const value = i < 4 ? LETTER_VALUE[ch] : Number(ch);
    sum += value * (1 << i);
  }
  return (sum % 11) % 10;
}

export function containerNumber(prefix: string, serialNumber: number): string {
  const serial = String(serialNumber % 1_000_000).padStart(6, '0');
  return `${prefix}${serial}${checkDigit(prefix, serial)}`;
}
