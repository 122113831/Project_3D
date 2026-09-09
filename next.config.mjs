/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // three.js dan ekosistem R3F dikirim sebagai ESM modern; transpile agar aman
  // di semua target build.
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],
  // oracledb dipakai dengan require() asli, tidak di-bundle.
  //
  // Bukan sekadar rapi-rapi: kalau di-bundle, webpack bisa memuat modulnya dua
  // kali — sekali lewat depot.ts, sekali lewat depotWrite.ts — dan konstanta
  // tipe seperti oracledb.STRING dari salinan yang satu tidak dikenali oleh
  // koneksi dari salinan yang lain. Gejalanya persis: executeMany menolak
  // dengan NJS-012 "invalid bind data type" padahal kueri yang sama jalan
  // mulus di luar Next.
  serverExternalPackages: ['oracledb'],
};

export default nextConfig;
