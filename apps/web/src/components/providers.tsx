"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { useRealtimeBridge } from "@/lib/realtime";
import { wagmiConfig } from "@/lib/wagmi";

function RealtimeBridge() {
  useRealtimeBridge();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RealtimeBridge />
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
