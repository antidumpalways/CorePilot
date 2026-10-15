import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { elysiumTestnet } from "../lib/wagmi";
import { shortenAddress } from "../lib/format";

export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const [switchRequested, setSwitchRequested] = useState(false);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);

  async function requestElysiumNetwork() {
    setWalletMessage(null);
    setSwitchRequested(true);
    try {
      // The injected connector requests wallet_switchEthereumChain. If the wallet
      // does not know this configured chain, wagmi requests wallet_addEthereumChain.
      await switchChainAsync({ chainId: elysiumTestnet.id });
    } catch {
      setWalletMessage("Network switch not approved. Select Switch to Elysium to try again.");
    } finally {
      setSwitchRequested(false);
    }
  }

  async function connectWallet() {
    const connector = connectors[0];
    if (!connector || isPending || switchRequested) return;
    setWalletMessage(null);
    try {
      const connection = await connectAsync({ connector });
      if (connection.chainId !== elysiumTestnet.id) await requestElysiumNetwork();
    } catch {
      setWalletMessage("Wallet connection not completed. Try again in your wallet extension.");
    }
  }

  if (!isConnected) {
    const injectedConnector = connectors[0];
    return (
      <button
        type="button"
        className="cp-btn-primary"
        disabled={!injectedConnector || isPending || switchRequested}
        title={walletMessage ?? "Connect an injected wallet"}
        onClick={() => void connectWallet()}
      >
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const wrongChain = chainId !== elysiumTestnet.id;

  return <details className="group relative">
    <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-[10px] border border-line/70 bg-ink-700 px-3 font-mono text-[11px] text-paper shadow-[0_1px_0_rgba(255,255,255,.06)_inset] transition-all duration-200 hover:border-accent/50 hover:bg-ink-600 [&::-webkit-details-marker]:hidden" aria-label={`Wallet ${shortenAddress(address ?? "")}, open wallet menu`}>
      <span className={`h-1.5 w-1.5 rounded-full ${wrongChain ? "bg-warn" : "bg-long"}`} />
      {shortenAddress(address ?? "")}
      <span className="text-muted transition-transform group-open:rotate-180" aria-hidden>▾</span>
    </summary>
    <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-[14px] border border-line/70 bg-ink-700 p-2 shadow-panel">
      <div className="border-b border-line-soft px-2 py-2"><div className="cp-label">Connected wallet</div><div className="cp-mono mt-1 text-xs text-paper">{shortenAddress(address ?? "", 10, 6)}</div><div className={`mt-1 text-[11px] ${wrongChain ? "text-warn" : "text-muted"}`}>{wrongChain ? switchRequested || isSwitching ? "Confirm network in wallet…" : "Wrong network" : "Elysium testnet"}</div></div>
      {wrongChain && <button type="button" className="mt-1 block w-full rounded px-2 py-2 text-left text-xs text-warn hover:bg-ink-700" disabled={switchRequested || isSwitching} onClick={() => void requestElysiumNetwork()}>{switchRequested || isSwitching ? "Switching…" : "Switch to Elysium"}</button>}
      {wrongChain && walletMessage && <p role="alert" className="px-2 py-1 text-[11px] leading-4 text-warn">{walletMessage}</p>}
      <button type="button" className="mt-1 block w-full rounded px-2 py-2 text-left text-xs text-muted hover:bg-ink-700 hover:text-paper" onClick={() => disconnect()}>Disconnect wallet</button>
    </div>
  </details>;
}
