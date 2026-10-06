import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { TopNav } from "@/components/nav/TopNav";
import { StatusBanner } from "@/components/nav/StatusBanner";
import { SearchPalette } from "@/components/nav/SearchPalette";
import { WalletModal } from "@/components/wallet/WalletModal";
import { Toaster } from "@/components/ui/Toaster";
import { WorldStage } from "@/components/world/WorldStage";
import { CinematicLayer } from "@/components/cinematic/CinematicLayer";
import { publicEnv } from "@/lib/env";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: { default: "AtlasPad — Every token is a nation", template: "%s · AtlasPad" },
  description: "Launch a token. Build a civilization. Become a citizen. A living on-chain world where every token is a nation.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "AtlasPad — Every token is a nation",
    description: "Every token is a nation. Every holder is a citizen. The market shapes the world.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#03040a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <WorldStage />
          <TopNav />
          <StatusBanner />
          <main className="relative z-10 min-h-[100dvh] pb-20 sm:pb-0">{children}</main>
          <CinematicLayer />
          <WalletModal />
          <SearchPalette />
          <Toaster />
        </Providers>
        <div className="grain" aria-hidden />
      </body>
    </html>
  );
}
