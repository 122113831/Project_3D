import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Container Yard 3D',
  description:
    'Visualisasi 3D lapangan penumpukan peti kemas: puluhan ribu kontainer dirender dalam beberapa draw call dengan InstancedMesh. Dibangun dengan Next.js dan React Three Fiber.',
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
    <html lang="id" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
