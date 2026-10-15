import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";

const RPC_URL =
  import.meta.env.VITE_ELYSIUM_RPC_URL ?? "https://testnet-rpc.elysium.kinetiq.xyz";

const CHAIN_ID = Number(import.meta.env.VITE_ELYSIUM_CHAIN_ID ?? 99801);

/**
 * Elysium testnet chain definition (id 99801, native HYPE).
 * Used by wagmi/viem so wallets prompt to switch to the right network.
 */
export const elysiumTestnet = defineChain({
  id: CHAIN_ID,
  name: "Elysium Testnet",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Elysium Testnet Explorer", url: "https://elysium.kinetiq.xyz/testnet-explorer" },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [elysiumTestnet],
  connectors: [injected()],
  transports: {
    [elysiumTestnet.id]: http(RPC_URL),
  },
});
