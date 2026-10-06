import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { network, publicEnv } from "./env";

const metadata = {
  name: "AtlasPad",
  description: "Every token is a nation. Every holder is a citizen.",
  url: publicEnv.siteUrl,
  icons: [`${publicEnv.siteUrl}/icon.svg`],
};

/**
 * Wallets: any injected browser wallet (discovered via EIP-6963), WalletConnect (Robinhood Wallet and other
 * mobile wallets) when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set, and Coinbase Wallet.
 */
export const wagmiConfig = createConfig({
  chains: [network.chain],
  transports: { [network.chain.id]: http(network.rpcUrl) },
  connectors: [
    injected({ shimDisconnect: true }),
    ...(publicEnv.walletConnectProjectId
      ? [walletConnect({ projectId: publicEnv.walletConnectProjectId, metadata, showQrModal: true })]
      : []),
    coinbaseWallet({ appName: metadata.name, appLogoUrl: metadata.icons[0] }),
  ],
  multiInjectedProviderDiscovery: true,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
