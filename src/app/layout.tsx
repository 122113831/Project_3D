import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Container Yard 3D',
  description:
    '3D visualization of a container storage yard: tens of thousands of containers rendered in a few draw calls with InstancedMesh. Built with Next.js and React Three Fiber.',
};

export const viewport: Viewport = {
  themeColor: '#a7c8e7',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: ekstensi browser sering menyuntik atribut ke
    // <html>/<body> sebelum React hydrate.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Huruf HUD (Geist). Dimuat peramban saat jalan — bukan next/font —
            supaya build tidak bergantung pada unduhan dari Google. Kalau gagal
            dimuat, HUD jatuh ke huruf sistem. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="hud-root" suppressHydrationWarning>{children}</body>
    </html>
  );
}
