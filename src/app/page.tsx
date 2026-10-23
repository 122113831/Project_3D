import { Hud } from '@/components/hud/Hud';
import { LayoutSync } from '@/components/LayoutSync';
import { LiveFeed } from '@/components/LiveFeed';
import { SceneLoader } from '@/components/SceneLoader';

export default function Page() {
  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      <SceneLoader />
      <Hud />
      {/* Tidak menggambar apa pun: menyelaraskan tata letak editor dengan tabel
          YARD_LAYOUT supaya sama di semua PC. */}
      <LayoutSync />
      {/* Aliran kejadian gate (HiveMQ / HTTP) ke animasi truk. */}
      <LiveFeed />
    </main>
  );
}
